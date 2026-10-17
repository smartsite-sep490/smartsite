import type { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';

export interface Mf06LeaseOptions {
  leaseSeconds: number;
  maxAttempts: number;
  retryDelaySeconds: number;
}

export type Mf06JobClaim = Readonly<{
  requestId: string;
  leaseToken: string;
  headRevision: number;
  attemptCount: number;
  leaseExpiresAt: string;
  deadlineAt: string;
}>;

/** Private software state machine. No scheduler, resolver or runtime registration. */
export class Mf06JobLeaseService {
  private readonly options: Readonly<Mf06LeaseOptions>;
  constructor(
    private readonly db: DataSource,
    options: Mf06LeaseOptions,
  ) {
    if (
      !options ||
      ![options.leaseSeconds, options.maxAttempts, options.retryDelaySeconds].every(
        Number.isSafeInteger,
      ) ||
      options.leaseSeconds < 1 ||
      options.leaseSeconds > 300 ||
      options.maxAttempts < 1 ||
      options.maxAttempts > 10 ||
      options.retryDelaySeconds < 1 ||
      options.retryDelaySeconds > 300
    ) {
      throw new Error('MF06_INVALID_LEASE_OPTIONS');
    }
    this.options = Object.freeze({
      leaseSeconds: options.leaseSeconds,
      maxAttempts: options.maxAttempts,
      retryDelaySeconds: options.retryDelaySeconds,
    });
  }

  async claim(signal?: AbortSignal): Promise<Mf06JobClaim | null> {
    if (signal?.aborted) return null;
    const aborted = new Error('MF06_CLAIM_ABORTED');
    const checkAbort = () => {
      if (signal?.aborted) throw aborted;
    };
    try {
      return await this.db.transaction('READ COMMITTED', async (manager) => {
        checkAbort();
        await this.expireInTransaction(manager);
        checkAbort();
        const [head] = (await manager.query(
          `SELECT * FROM zone_entry_assessment_job
          WHERE attempt_count < $1 AND head_revision < 2147483646
            AND deadline_at > clock_timestamp()
            AND ((status='PENDING' AND next_attempt_at<=clock_timestamp())
              OR (status='CLAIMED' AND lease_expires_at<=clock_timestamp()))
          ORDER BY next_attempt_at,request_id LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [this.options.maxAttempts],
        )) as JobRow[];
        checkAbort();
        if (!head) return null;
        // Read again after the lock; an eligibility expression is not a lease clock.
        const now = await this.now(manager);
        if (head.deadline_at.getTime() <= now.getTime()) return null;
        const expiry = new Date(
          Math.min(now.getTime() + this.options.leaseSeconds * 1000, head.deadline_at.getTime()),
        );
        const token = randomUUID();
        const changed = (await manager.query(
          `WITH changed AS (UPDATE zone_entry_assessment_job SET status='CLAIMED',
          attempt_count=attempt_count+1,head_revision=head_revision+1,
          lease_token=$2,lease_expires_at=$3,updated_at=$4
          WHERE request_id=$1 AND head_revision=$5 AND attempt_count < $6
            AND deadline_at>clock_timestamp() AND $3::timestamptz>clock_timestamp()
            AND ((status='PENDING' AND next_attempt_at<=clock_timestamp())
              OR (status='CLAIMED' AND lease_expires_at<=clock_timestamp()))
          RETURNING request_id) SELECT request_id FROM changed`,
          [head.request_id, token, expiry, now, head.head_revision, this.options.maxAttempts],
        )) as { request_id: string }[];
        checkAbort();
        if (changed.length !== 1) return null;
        return Object.freeze({
          requestId: head.request_id,
          leaseToken: token,
          headRevision: head.head_revision + 1,
          attemptCount: head.attempt_count + 1,
          leaseExpiresAt: expiry.toISOString(),
          deadlineAt: head.deadline_at.toISOString(),
        });
      });
    } catch (error) {
      if (error === aborted) return null;
      throw error;
    }
  }

  async retry(
    claim: Mf06JobClaim,
    errorCode: 'RESOLVER_TIMEOUT' | 'RESOLVER_UNAVAILABLE' | 'DATABASE_UNAVAILABLE',
  ): Promise<'RETRY' | 'FAILED' | 'STALE'> {
    if (!['RESOLVER_TIMEOUT', 'RESOLVER_UNAVAILABLE', 'DATABASE_UNAVAILABLE'].includes(errorCode))
      return 'STALE';
    return this.transition(claim, 'RETRY', errorCode) as Promise<'RETRY' | 'FAILED' | 'STALE'>;
  }
  async fail(
    claim: Mf06JobClaim,
    errorCode: 'INVALID_CONTEXT' | 'PROCESSING_FAILED',
  ): Promise<'FAILED' | 'STALE'> {
    if (!['INVALID_CONTEXT', 'PROCESSING_FAILED'].includes(errorCode)) return 'STALE';
    return this.transition(claim, 'FAILED', errorCode) as Promise<'FAILED' | 'STALE'>;
  }
  async cancel(claim: Mf06JobClaim): Promise<'CANCELLED' | 'STALE'> {
    return this.transition(claim, 'CANCELLED', 'ABORTED') as Promise<'CANCELLED' | 'STALE'>;
  }
  async expire(): Promise<number> {
    return this.db.transaction('READ COMMITTED', (manager) => this.expireInTransaction(manager));
  }

  private async now(manager: EntityManager): Promise<Date> {
    const [row] = (await manager.query('SELECT clock_timestamp() AS now')) as { now: Date }[];
    if (!(row?.now instanceof Date) || !Number.isFinite(row.now.getTime()))
      throw new Error('MF06_DATABASE_CLOCK_UNAVAILABLE');
    return row.now;
  }

  private async expireInTransaction(manager: EntityManager): Promise<number> {
    // Only due terminalization candidates. A valid in-flight lease is not stolen
    // merely because its last allowed attempt is currently being processed.
    const heads = (await manager.query(
      `SELECT * FROM zone_entry_assessment_job
      WHERE status IN ('PENDING','CLAIMED') AND head_revision < 2147483647
        AND (deadline_at<=clock_timestamp() OR
          ((attempt_count >= $1 OR head_revision >= 2147483646)
            AND (status='PENDING' OR lease_expires_at<=clock_timestamp())))
      ORDER BY deadline_at,request_id LIMIT 100 FOR UPDATE SKIP LOCKED`,
      [this.options.maxAttempts],
    )) as JobRow[];
    let changed = 0;
    for (const head of heads) {
      const now = await this.now(manager);
      const reason =
        head.deadline_at <= now
          ? 'DEADLINE_EXCEEDED'
          : head.head_revision >= 2147483646
            ? 'HEAD_REVISION_EXHAUSTED'
            : 'ATTEMPTS_EXHAUSTED';
      await manager.query(
        `UPDATE zone_entry_assessment_job SET status='FAILED',
        head_revision=head_revision+1,lease_token=NULL,lease_expires_at=NULL,
        last_error_code=$2,updated_at=$3 WHERE request_id=$1`,
        [head.request_id, reason, now],
      );
      changed++;
    }
    return changed;
  }

  private async transition(
    value: Mf06JobClaim,
    action: 'RETRY' | 'FAILED' | 'CANCELLED',
    code: string,
  ): Promise<'RETRY' | 'FAILED' | 'CANCELLED' | 'STALE'> {
    if (
      !value ||
      ![value.requestId, value.leaseToken].every((id) => typeof id === 'string' && uuid.test(id)) ||
      !Number.isSafeInteger(value.headRevision) ||
      value.headRevision < 1 ||
      value.headRevision > 2147483646
    )
      return 'STALE';
    // Snapshot caller identifiers before waiting for row ownership.
    const requestId = value.requestId.toLowerCase(),
      token = value.leaseToken.toLowerCase(),
      revision = value.headRevision;
    return this.db.transaction('READ COMMITTED', async (manager) => {
      const [head] = (await manager.query(
        'SELECT * FROM zone_entry_assessment_job WHERE request_id=$1 FOR UPDATE',
        [requestId],
      )) as JobRow[];
      const now = await this.now(manager);
      if (
        !head ||
        head.status !== 'CLAIMED' ||
        head.lease_token !== token ||
        head.head_revision !== revision ||
        !head.lease_expires_at ||
        head.lease_expires_at <= now ||
        head.deadline_at <= now
      )
        return 'STALE';
      const next = new Date(now.getTime() + this.options.retryDelaySeconds * 1000);
      let result = action;
      if (
        action === 'RETRY' &&
        (head.attempt_count >= this.options.maxAttempts || next >= head.deadline_at)
      ) {
        result = 'FAILED';
        code = next >= head.deadline_at ? 'DEADLINE_EXCEEDED' : 'ATTEMPTS_EXHAUSTED';
      }
      const changed = (await manager.query(
        `WITH stamp AS (SELECT clock_timestamp() AS now), changed AS (
        UPDATE zone_entry_assessment_job SET
        status=CASE WHEN $2::varchar='PENDING' AND stamp.now+make_interval(secs=>$4)>=deadline_at THEN 'FAILED' ELSE $2::varchar END,
        head_revision=head_revision+1,lease_token=NULL,lease_expires_at=NULL,
        last_error_code=CASE WHEN $2::varchar='PENDING' AND stamp.now+make_interval(secs=>$4)>=deadline_at THEN 'DEADLINE_EXCEEDED' ELSE $3 END,
        updated_at=stamp.now,
        next_attempt_at=CASE WHEN $2::varchar='PENDING' AND stamp.now+make_interval(secs=>$4)<deadline_at THEN stamp.now+make_interval(secs=>$4) ELSE next_attempt_at END
        FROM stamp
        WHERE request_id=$1 AND status='CLAIMED' AND lease_token=$5 AND head_revision=$6
          AND clock_timestamp()<lease_expires_at AND clock_timestamp()<deadline_at
        RETURNING request_id,status) SELECT request_id,status FROM changed`,
        [
          requestId,
          result === 'RETRY' ? 'PENDING' : result,
          code,
          this.options.retryDelaySeconds,
          token,
          revision,
        ],
      )) as { request_id: string; status: 'PENDING' | 'FAILED' | 'CANCELLED' }[];
      return changed[0] ? (changed[0].status === 'PENDING' ? 'RETRY' : changed[0].status) : 'STALE';
    });
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface JobRow {
  request_id: string;
  status: string;
  attempt_count: number;
  head_revision: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  deadline_at: Date;
  next_attempt_at: Date;
}
