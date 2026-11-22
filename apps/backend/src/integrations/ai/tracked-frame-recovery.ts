import { Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type {
  TrackedFrameAdmission,
  TrackedFrameKey,
  TrackedRecoveryScope,
} from './tracked-frame-admission.js';
import { expireTrackedPending } from './tracked-pending-expiry.js';

interface SourceGapOptions {
  minPersistentMs: number;
  onGap(signal: Readonly<TrackedFrameKey>): void | boolean;
}

interface SourceGapState {
  scope: TrackedRecoveryScope;
  frameId: string;
  firstSeenAt: number;
  notified: boolean;
}

function matchesSource(scope: TrackedRecoveryScope, current?: TrackedRecoveryScope): boolean {
  return (
    scope.cameraId === current?.cameraId &&
    scope.generationId === current.generationId &&
    scope.streamSessionId === current.streamSessionId
  );
}

interface TrackedRecoveryOptions {
  cameraIds: readonly string[];
  intervalMs: number;
  maxFramesPerCamera: number;
  sourceGap?: SourceGapOptions;
}

/** Prototype lifecycle provider. Registration requires an explicit trusted camera policy. */
export class TrackedFrameRecovery implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrackedFrameRecovery.name);
  private readonly options: TrackedRecoveryOptions;
  private readonly gapStates = new Map<string, SourceGapState>();
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly source: DataSource,
    private readonly admission: TrackedFrameAdmission,
    options: TrackedRecoveryOptions,
  ) {
    const { cameraIds, intervalMs, maxFramesPerCamera, sourceGap } = options;
    if (
      !cameraIds.length ||
      cameraIds.some((id) => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 1 ||
      intervalMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxFramesPerCamera) ||
      maxFramesPerCamera < 1 ||
      (sourceGap !== undefined &&
        (!Number.isSafeInteger(sourceGap.minPersistentMs) ||
          sourceGap.minPersistentMs < intervalMs ||
          typeof sourceGap.onGap !== 'function'))
    )
      throw new Error('Invalid tracked recovery options');
    this.options = {
      cameraIds: [...new Set(cameraIds)],
      intervalMs,
      maxFramesPerCamera,
      sourceGap: sourceGap && { ...sourceGap },
    };
  }

  onApplicationBootstrap() {
    if (!this.active && !this.timer && !this.shutdown.signal.aborted) this.run();
  }

  async onModuleDestroy() {
    this.shutdown.abort();
    clearTimeout(this.timer);
    await this.active;
    this.gapStates.clear();
  }

  private run() {
    this.active = this.sweep().finally(() => {
      this.active = undefined;
      if (!this.shutdown.signal.aborted) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.run();
        }, this.options.intervalMs);
        this.timer.unref();
      }
    });
  }

  private async sweep() {
    const { cameraIds, maxFramesPerCamera } = this.options;
    for (const cameraId of cameraIds) {
      if (this.shutdown.signal.aborted) break;
      try {
        await expireTrackedPending(
          this.source,
          [cameraId],
          maxFramesPerCamera,
          this.shutdown.signal,
        );
        if (this.shutdown.signal.aborted) break;
        if (this.options.sourceGap)
          await this.recoverWithGapSignal(cameraId, maxFramesPerCamera, this.options.sourceGap);
        else
          await this.admission.recoverCurrent(
            this.source,
            cameraId,
            maxFramesPerCamera,
            this.shutdown.signal,
          );
      } catch {
        if (!this.gapStates.get(cameraId)?.notified) this.gapStates.delete(cameraId);
        this.logger.warn('Tracked frame recovery failed for a configured camera');
      }
    }
  }

  private async recoverWithGapSignal(cameraId: string, limit: number, policy: SourceGapOptions) {
    const scope = await this.admission.readCurrentScope(this.source, cameraId);
    if (this.shutdown.signal.aborted) return;
    if (!scope) {
      this.gapStates.delete(cameraId);
      return;
    }

    const results = await this.admission.recoverPending(
      this.source,
      scope,
      limit,
      this.shutdown.signal,
    );
    if (this.shutdown.signal.aborted) return;
    const previous = this.gapStates.get(cameraId);
    const sameSource = previous && matchesSource(previous.scope, scope);
    if (sameSource && previous.notified) return;

    const gap = results.find(
      (result) => result.kind === 'PENDING_PREDECESSOR' && result.reason === 'SOURCE_GAP',
    );
    if (!gap) {
      this.gapStates.delete(cameraId);
      return;
    }
    const now = performance.now();
    if (!sameSource || previous.frameId !== gap.frameId) {
      this.gapStates.set(cameraId, {
        scope,
        frameId: gap.frameId,
        firstSeenAt: now,
        notified: false,
      });
      return;
    }
    if (now - previous.firstSeenAt < policy.minPersistentMs) return;

    // Recovery may have selected a generation that rotated while this sweep was running.
    const current = await this.admission.readCurrentScope(this.source, cameraId);
    if (!matchesSource(scope, current)) {
      this.gapStates.delete(cameraId);
      return;
    }
    if (this.shutdown.signal.aborted) return;
    const signal = Object.freeze({ ...scope, frameId: gap.frameId });
    if (!(await this.admission.recheckSourceGap(this.source, signal))) {
      this.gapStates.delete(cameraId);
      return;
    }
    if (this.shutdown.signal.aborted) return;
    previous.notified = policy.onGap(signal) !== false;
  }
}
