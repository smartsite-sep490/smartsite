import { isUUID } from 'class-validator';
import { ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import type {
  EffectiveZoneAccessGrant,
  ZoneAuthorizationResult,
} from './zone-authorization.interface.js';
import { ZoneAuthorizationService } from './zone-authorization.service.js';

export interface ZoneAuthorityInterval {
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
}

export interface ZoneAuthorityScope {
  siteId: string;
  zoneId: string;
  /** A trusted resolved Worker, never an AI candidate or Track ID. */
  workerId?: string;
}

interface ContractorGrant extends EffectiveZoneAccessGrant {
  siteId: string;
  zoneId: string;
  contractorId: string;
}

interface WorkerGrant extends ContractorGrant {
  workerId: string;
}

interface ContractorParticipationInterval extends ZoneAuthorityInterval {
  siteId: string;
  contractorId: string;
}

interface WorkerZoneAssignmentInterval extends ContractorParticipationInterval {
  workerId: string;
  zoneId: string;
}

/**
 * Internal policy facts, NOT a public wire contract or an implemented reader.
 * Only the owner-approved history reader may assert COMPLETE. Each interval's
 * scope is checked here; its historical eligibility is still the reader's duty.
 * A nonempty revision identifies the reader snapshot; it is not identity proof.
 */
export interface CompleteZoneAuthoritySnapshot {
  status: 'COMPLETE';
  snapshotVersion: string;
  siteId: string;
  zoneId: string;
  workerId: string;
  contractorId: string;
  participationIntervals: readonly ContractorParticipationInterval[];
  assignmentIntervals: readonly WorkerZoneAssignmentInterval[];
  contractorGrants: readonly ContractorGrant[];
  workerGrants: readonly WorkerGrant[];
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function validInterval(value: unknown): value is ZoneAuthorityInterval {
  if (!record(value) || !validDate(value.validFrom)) return false;
  return (
    (value.validUntil === null ||
      (validDate(value.validUntil) && value.validUntil.getTime() > value.validFrom.getTime())) &&
    (value.revokedAt === null || validDate(value.revokedAt))
  );
}
function active(value: ZoneAuthorityInterval, at: number): boolean {
  return (
    value.validFrom.getTime() <= at &&
    (value.validUntil === null || at < value.validUntil.getTime()) &&
    (value.revokedAt === null || at < value.revokedAt.getTime())
  );
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value);
}
function sameId(left: unknown, right: string): boolean {
  return validId(left) && left.toLowerCase() === right.toLowerCase();
}
function validMembershipIntervals(
  values: unknown,
  facts: RecordValue,
  assignment: boolean,
): values is (ContractorParticipationInterval | WorkerZoneAssignmentInterval)[] {
  return (
    Array.isArray(values) &&
    values.every(
      (value: unknown) =>
        record(value) &&
        validInterval(value) &&
        sameId(value.siteId, facts.siteId as string) &&
        sameId(value.contractorId, facts.contractorId as string) &&
        (!assignment ||
          (sameId(value.workerId, facts.workerId as string) &&
            sameId(value.zoneId, facts.zoneId as string))),
    )
  );
}
function validGrants(
  values: unknown,
  facts: RecordValue,
  worker: boolean,
): values is (ContractorGrant | WorkerGrant)[] {
  return (
    Array.isArray(values) &&
    values.every(
      (grant: unknown) =>
        record(grant) &&
        validInterval(grant) &&
        (grant.effect === 'ALLOW' || grant.effect === 'DENY') &&
        sameId(grant.siteId, facts.siteId as string) &&
        sameId(grant.zoneId, facts.zoneId as string) &&
        sameId(grant.contractorId, facts.contractorId as string) &&
        (!worker || sameId(grant.workerId, facts.workerId as string)),
    )
  );
}

function completeSnapshotForScope(
  snapshot: unknown,
  scope: ZoneAuthorityScope,
): snapshot is CompleteZoneAuthoritySnapshot {
  return (
    validId(scope.siteId) &&
    validId(scope.zoneId) &&
    validId(scope.workerId) &&
    record(snapshot) &&
    snapshot.status === 'COMPLETE' &&
    typeof snapshot.snapshotVersion === 'string' &&
    Boolean(snapshot.snapshotVersion.trim()) &&
    sameId(snapshot.siteId, scope.siteId) &&
    sameId(snapshot.zoneId, scope.zoneId) &&
    sameId(snapshot.workerId, scope.workerId) &&
    validId(snapshot.contractorId) &&
    validMembershipIntervals(snapshot.participationIntervals, snapshot, false) &&
    validMembershipIntervals(snapshot.assignmentIntervals, snapshot, true) &&
    validGrants(snapshot.contractorGrants, snapshot, false) &&
    validGrants(snapshot.workerGrants, snapshot, true)
  );
}

export interface WorkerZoneAllowProposal {
  siteId: string;
  zoneId: string;
  workerId: string;
  contractorId: string;
  validFrom: Date;
  validUntil: Date | null;
}

export type WorkerZoneAllowContainmentResult = {
  status: 'CONTAINED' | 'NOT_CONTAINED' | 'UNAVAILABLE';
  reasonCode:
    | 'FULL_COVERAGE'
    | 'INVALID_REQUEST'
    | 'INCOMPLETE_AUTHORITY'
    | 'CONTRACTOR_DENY'
    | 'OUTSIDE_AUTHORITY';
};

function effectiveEnd(interval: ZoneAuthorityInterval): number {
  return Math.min(
    interval.validUntil?.getTime() ?? Infinity,
    interval.revokedAt?.getTime() ?? Infinity,
  );
}

function coversInterval(
  intervals: readonly ZoneAuthorityInterval[],
  start: number,
  end: number,
): boolean {
  const ranges = intervals
    .map((interval) => ({ start: interval.validFrom.getTime(), end: effectiveEnd(interval) }))
    .filter((range) => range.start < range.end && range.end > start && range.start < end)
    .sort((left, right) => left.start - right.start);
  let coveredUntil = start;
  for (const range of ranges) {
    if (range.start > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, range.end);
    if (coveredUntil >= end) return true;
  }
  return false;
}

/**
 * Pure create/update precondition for a proposed Worker ALLOW, not an entry
 * authorization or grant writer. Every instant of its half-open interval must
 * fit the owner's complete scoped membership and effective Contractor rights.
 * The actual writer must re-read/validate and serialize concurrent changes in
 * its transaction; CONTAINED alone does not prove freshness or trusted identity.
 */
export function checkWorkerZoneAllowContainment(
  snapshot: unknown,
  proposed: unknown,
): WorkerZoneAllowContainmentResult {
  if (
    !record(proposed) ||
    !validId(proposed.siteId) ||
    !validId(proposed.zoneId) ||
    !validId(proposed.workerId) ||
    !validId(proposed.contractorId) ||
    !validInterval({ ...proposed, revokedAt: null })
  )
    return { status: 'UNAVAILABLE', reasonCode: 'INVALID_REQUEST' };

  const request = proposed as unknown as WorkerZoneAllowProposal;
  if (
    !completeSnapshotForScope(snapshot, request) ||
    !sameId(snapshot.contractorId, request.contractorId)
  )
    return { status: 'UNAVAILABLE', reasonCode: 'INCOMPLETE_AUTHORITY' };

  const start = request.validFrom.getTime();
  const end = request.validUntil?.getTime() ?? Infinity;
  const denied = snapshot.contractorGrants.some((grant) => {
    const from = grant.validFrom.getTime();
    const until = effectiveEnd(grant);
    return grant.effect === 'DENY' && from < until && from < end && until > start;
  });
  if (denied) return { status: 'NOT_CONTAINED', reasonCode: 'CONTRACTOR_DENY' };

  const covered = [
    snapshot.participationIntervals,
    snapshot.assignmentIntervals,
    snapshot.contractorGrants.filter((grant) => grant.effect === 'ALLOW'),
  ].every((intervals) => coversInterval(intervals, start, end));
  return covered
    ? { status: 'CONTAINED', reasonCode: 'FULL_COVERAGE' }
    : { status: 'NOT_CONTAINED', reasonCode: 'OUTSIDE_AUTHORITY' };
}

/**
 * Evaluate both tiers at one event timestamp. No DB, Face, cache or side effects.
 * Scope is supplied separately so a valid snapshot for another event cannot allow.
 * Grant creation's full-interval containment, historical reader completeness and
 * append-time revocation revalidation are separate required boundaries; this
 * function alone MUST NOT enable live authorization or synthesize COMPLETE data.
 */
export function evaluateZoneAuthority(
  snapshot: unknown,
  restrictionPolicy: ZoneRestrictionPolicy,
  capturedAt: Date,
  scope: ZoneAuthorityScope,
): ZoneAuthorizationResult {
  const policy = new ZoneAuthorizationService();
  if (restrictionPolicy !== ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED)
    return policy.authorizeZoneEntry({ restrictionPolicy });
  if (!validId(scope.workerId)) return policy.authorizeZoneEntry({ restrictionPolicy });
  const workerId = scope.workerId;
  const unavailable = (): ZoneAuthorizationResult =>
    policy.authorizeZoneEntry(
      { restrictionPolicy },
      {
        workerId,
        candidateWorkerId: workerId,
        evaluatedAt: capturedAt,
        authorizationDataAvailable: false,
        grants: [],
      },
    );
  if (!validDate(capturedAt) || !completeSnapshotForScope(snapshot, scope)) return unavailable();

  const at = capturedAt.getTime();
  const contractorGrants = snapshot.contractorGrants.filter((grant) => active(grant, at));
  const workerGrants = snapshot.workerGrants.filter((grant) => active(grant, at));
  const explicitDeny = [...contractorGrants, ...workerGrants].find(
    (grant) => grant.effect === 'DENY',
  );
  const membership =
    snapshot.participationIntervals.some((value) => active(value, at)) &&
    snapshot.assignmentIntervals.some((value) => active(value, at));
  const bothAllow =
    membership &&
    contractorGrants.some((grant) => grant.effect === 'ALLOW') &&
    workerGrants.some((grant) => grant.effect === 'ALLOW');
  // Reuse existing result vocabulary and DENY precedence. Both-tier checks above
  // determine eligibility; do not pretend the single-tier reader supplies them.
  return policy.authorizeZoneEntry(
    { restrictionPolicy },
    {
      workerId,
      candidateWorkerId: workerId,
      evaluatedAt: capturedAt,
      authorizationDataAvailable: true,
      grants: explicitDeny ? [explicitDeny] : bothAllow ? workerGrants : [],
    },
  );
}
