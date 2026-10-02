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
  if (
    !validDate(capturedAt) ||
    !validId(scope.siteId) ||
    !validId(scope.zoneId) ||
    !record(snapshot) ||
    snapshot.status !== 'COMPLETE' ||
    typeof snapshot.snapshotVersion !== 'string' ||
    !snapshot.snapshotVersion.trim() ||
    !sameId(snapshot.siteId, scope.siteId) ||
    !sameId(snapshot.zoneId, scope.zoneId) ||
    !sameId(snapshot.workerId, workerId) ||
    !validId(snapshot.contractorId) ||
    !validMembershipIntervals(snapshot.participationIntervals, snapshot, false) ||
    !validMembershipIntervals(snapshot.assignmentIntervals, snapshot, true) ||
    !validGrants(snapshot.contractorGrants, snapshot, false) ||
    !validGrants(snapshot.workerGrants, snapshot, true)
  )
    return unavailable();

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
