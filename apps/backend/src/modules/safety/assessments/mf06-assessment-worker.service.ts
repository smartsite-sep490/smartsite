import type { DataSource, EntityManager } from 'typeorm';
import type { Mf06JobClaim, Mf06JobLeaseService } from './mf06-job-lease.service.js';
import type { Mf06AssessmentStoreResult } from './mf06-assessment-store.service.js';

export interface Mf06AssessmentWorkPort {
  /** Potential resolver I/O, outside the final database transaction. */
  prepare(claim: Mf06JobClaim, signal: AbortSignal): Promise<unknown>;
  /** Revalidate current authoritative data and append on this same manager; no remote I/O. */
  finalize(
    manager: EntityManager,
    claim: Mf06JobClaim,
    prepared: unknown,
    signal: AbortSignal,
  ): Promise<Mf06AssessmentStoreResult>;
}
export interface Mf06WorkerOptions {
  enabled: boolean;
  resolverTimeoutMs: number;
  drainTimeoutMs: number;
  maxDatabaseAttempts: number;
}
export type Mf06WorkerResult = 'IDLE' | 'COMPLETED' | 'RETRY' | 'STALE' | 'FAILED' | 'CANCELLED';
export class Mf06RetryableWorkError extends Error {
  constructor(readonly code: 'RESOLVER_UNAVAILABLE' | 'DATABASE_UNAVAILABLE') {
    super(code);
  }
}
/** Private caller-driven orchestration. No scheduler, model adapter or runtime provider. */
export class Mf06AssessmentWorker {
  private readonly settings: Readonly<Mf06WorkerOptions>;
  private active: Promise<Mf06WorkerResult> | undefined;
  private controller: AbortController | undefined;
  private draining = false;
  constructor(
    private readonly db: DataSource,
    private readonly leases: Pick<Mf06JobLeaseService, 'claim' | 'retry' | 'fail' | 'cancel'>,
    private readonly work: Mf06AssessmentWorkPort,
    options: Mf06WorkerOptions,
  ) {
    if (
      !options ||
      typeof options.enabled !== 'boolean' ||
      ![options.resolverTimeoutMs, options.drainTimeoutMs, options.maxDatabaseAttempts].every(
        Number.isSafeInteger,
      ) ||
      options.resolverTimeoutMs < 1 ||
      options.resolverTimeoutMs > 30000 ||
      options.drainTimeoutMs < 1 ||
      options.drainTimeoutMs > 30000 ||
      options.maxDatabaseAttempts < 1 ||
      options.maxDatabaseAttempts > 3
    )
      throw new Error('MF06_INVALID_WORKER_OPTIONS');
    this.settings = Object.freeze({ ...options });
  }
  runOnce(signal?: AbortSignal): Promise<Mf06WorkerResult> {
    if (!this.settings.enabled || signal?.aborted || this.draining || this.active)
      return Promise.resolve('IDLE');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.controller = controller;
    const active = this.execute(controller).finally(() => {
      signal?.removeEventListener('abort', abort);
      this.controller = undefined;
      this.active = undefined;
    });
    this.active = active;
    return active;
  }
  async drain(): Promise<void> {
    this.draining = true;
    this.controller?.abort();
    const active = this.active;
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('MF06_DRAIN_TIMEOUT')),
            this.settings.drainTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async execute(controller: AbortController): Promise<Mf06WorkerResult> {
    const signal = controller.signal;
    const claim = await this.leases.claim(signal);
    if (!claim) return 'IDLE';
    if (signal.aborted) return this.leases.cancel(claim);
    // Local time bounds resource use; final authorization still requires the database lease CAS.
    const expiresAt = Math.min(Date.parse(claim.leaseExpiresAt), Date.parse(claim.deadlineAt));
    const remaining = () => expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remaining() <= 0) return 'STALE';
    const timeout = new AbortController();
    const preparationSignal = AbortSignal.any([signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(),
      Math.min(this.settings.resolverTimeoutMs, remaining()),
    );
    let prepared: unknown;
    try {
      prepared = await abortRace(() => {
        if (remaining() <= 0) timeout.abort();
        preparationSignal.throwIfAborted();
        return this.work.prepare(claim, preparationSignal);
      }, preparationSignal);
    } catch (error) {
      if (signal.aborted) return this.leases.cancel(claim);
      if (remaining() <= 0) return 'STALE';
      if (timeout.signal.aborted) return this.leases.retry(claim, 'RESOLVER_TIMEOUT');
      if (error instanceof Mf06RetryableWorkError) return this.leases.retry(claim, error.code);
      return this.leases.fail(claim, 'PROCESSING_FAILED');
    } finally {
      clearTimeout(timer);
    }
    for (let attempt = 0; attempt < this.settings.maxDatabaseAttempts; attempt++) {
      if (signal.aborted) return this.leases.cancel(claim);
      if (remaining() <= 0) return 'STALE';
      try {
        const result = await this.db.transaction('SERIALIZABLE', async (manager) => {
          signal.throwIfAborted();
          if (remaining() <= 0) return { state: 'STALE' as const, reason: 'LEASE_EXPIRED' };
          const value = await this.work.finalize(manager, claim, prepared, signal);
          signal.throwIfAborted();
          return value;
        });
        // The transaction has committed. A later cancellation cannot undo it.
        if (result.state === 'RECORDED' || result.state === 'REPLAY') return 'COMPLETED';
        if (result.state === 'STALE') return 'STALE';
        return this.leases.fail(claim, 'INVALID_CONTEXT');
      } catch (error) {
        if (signal.aborted) return this.leases.cancel(claim);
        // A stale prepared authority snapshot needs a new lease/preparation, not a SQL retry.
        if (error instanceof Mf06RetryableWorkError) return this.leases.retry(claim, error.code);
        const failure = error as { code?: unknown; driverError?: { code?: unknown } };
        const code = failure?.driverError?.code ?? failure?.code;
        if (code === '55P03' || code === '57014' || code === '55000')
          return this.leases.retry(claim, 'DATABASE_UNAVAILABLE');
        if (code === '40001' || code === '40P01') {
          if (attempt + 1 < this.settings.maxDatabaseAttempts) continue;
          return this.leases.retry(claim, 'DATABASE_UNAVAILABLE');
        }
        return this.leases.fail(claim, 'PROCESSING_FAILED');
      }
    }
    return this.leases.fail(claim, 'PROCESSING_FAILED');
  }
}

function abortRace<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (success) resolve(value as T);
      else reject(value);
    };
    const abort = () => finish(false, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    // Both handlers stay attached to ignored-signal I/O; late resolve/reject can
    // neither finalize a job nor produce an unhandled rejection through this race.
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        (value) => finish(true, value),
        (error) => finish(false, error),
      );
  });
}
