import {
  ZoneAuthoritySourceKind,
  WorkerSiteZoneAssignmentStatus,
} from '../../database/entities/index.js';
import type { AuthorityHistoryRow } from './zone-authority-reader.port.js';
import type { CompleteZoneAuthoritySnapshot } from './zone-authority-chain.policy.js';
import type { ZoneRestrictionPolicy } from '../../database/entities/enums.js';

export type AuthorityProjectionResult =
  | {
      status: 'PROJECTED';
      scope: { siteId: string; zoneId: string; workerId: string; contractorId: string };
      projection: Omit<CompleteZoneAuthoritySnapshot, 'snapshotVersion'>;
      restrictionPolicy: ZoneRestrictionPolicy;
      eligibility: { workerActive: boolean; contractorActive: boolean };
    }
  | {
      status: 'UNAVAILABLE';
      reason:
        'WORKER_MEMBERSHIP_UNAVAILABLE' | 'LEGACY_CONTRACTOR_ANCHOR' | 'STATE_HISTORY_UNAVAILABLE';
    };

/** Accepts only validated selected facts from selectAuthorityHistory; does not attest coverage or identity. */
export function projectSelectedZoneAuthority(
  selected: readonly AuthorityHistoryRow[],
  scope: { siteId: string; zoneId: string; workerId: string },
): AuthorityProjectionResult {
  const unavailable = (
    reason:
      'WORKER_MEMBERSHIP_UNAVAILABLE' | 'LEGACY_CONTRACTOR_ANCHOR' | 'STATE_HISTORY_UNAVAILABLE',
  ): AuthorityProjectionResult => ({ status: 'UNAVAILABLE', reason });
  const membership = selected.find(
    (f) =>
      f.sourceKind === ZoneAuthoritySourceKind.WORKER_MEMBERSHIP &&
      f.sourceId === scope.workerId &&
      f.payload.siteId === scope.siteId,
  );
  if (!membership || membership.sourceKind !== ZoneAuthoritySourceKind.WORKER_MEMBERSHIP)
    return unavailable('WORKER_MEMBERSHIP_UNAVAILABLE');
  const contractorId = membership.payload.contractorId;
  if (contractorId === null) return unavailable('LEGACY_CONTRACTOR_ANCHOR');
  const contractor = selected.find(
    (fact) =>
      fact.sourceKind === ZoneAuthoritySourceKind.CONTRACTOR_STATE &&
      fact.sourceId === contractorId,
  );
  const zonePolicy = selected.find(
    (fact) =>
      fact.sourceKind === ZoneAuthoritySourceKind.ZONE_POLICY &&
      fact.sourceId === scope.zoneId &&
      fact.payload.siteId === scope.siteId,
  );
  if (
    !contractor ||
    contractor.sourceKind !== ZoneAuthoritySourceKind.CONTRACTOR_STATE ||
    !zonePolicy ||
    zonePolicy.sourceKind !== ZoneAuthoritySourceKind.ZONE_POLICY
  )
    return unavailable('STATE_HISTORY_UNAVAILABLE');
  const eligible = membership.payload.isActive && contractor.payload.isActive;
  const interval = (value: {
    validFrom: string;
    validUntil: string | null;
    revokedAt?: string | null;
  }) => ({
    validFrom: new Date(value.validFrom),
    validUntil: value.validUntil === null ? null : new Date(value.validUntil),
    revokedAt: value.revokedAt == null ? null : new Date(value.revokedAt),
  });
  const scoped = {
    siteId: scope.siteId,
    zoneId: scope.zoneId,
    workerId: scope.workerId,
    contractorId,
  };
  const projection: Omit<CompleteZoneAuthoritySnapshot, 'snapshotVersion'> = {
    ...scoped,
    status: 'COMPLETE',
    participationIntervals: eligible
      ? selected.flatMap((fact) =>
          fact.sourceKind === ZoneAuthoritySourceKind.PARTICIPATION &&
          fact.payload.siteId === scope.siteId &&
          fact.payload.contractorId === contractorId &&
          fact.payload.isActive
            ? [{ ...scoped, ...interval(fact.payload) }]
            : [],
        )
      : [],
    assignmentIntervals: eligible
      ? selected.flatMap((fact) =>
          fact.sourceKind === ZoneAuthoritySourceKind.ASSIGNMENT &&
          fact.payload.siteId === scope.siteId &&
          fact.payload.workerId === scope.workerId &&
          fact.payload.contractorId === contractorId &&
          fact.payload.status === WorkerSiteZoneAssignmentStatus.APPROVED &&
          fact.payload.zoneIds.includes(scope.zoneId)
            ? [{ ...scoped, ...interval(fact.payload) }]
            : [],
        )
      : [],
    contractorGrants: selected.flatMap((fact) =>
      fact.sourceKind === ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT &&
      fact.payload.siteId === scope.siteId &&
      fact.payload.zoneId === scope.zoneId &&
      fact.payload.contractorId === contractorId
        ? [{ ...scoped, effect: fact.payload.effect, ...interval(fact.payload) }]
        : [],
    ),
    workerGrants: selected.flatMap((fact) =>
      fact.sourceKind === ZoneAuthoritySourceKind.WORKER_ZONE_GRANT &&
      fact.payload.siteId === scope.siteId &&
      fact.payload.zoneId === scope.zoneId &&
      fact.payload.workerId === scope.workerId &&
      fact.payload.contractorId === contractorId
        ? [{ ...scoped, effect: fact.payload.effect, ...interval(fact.payload) }]
        : [],
    ),
  };
  const relevantLegacy = selected.some(
    (fact) =>
      (fact.sourceKind === ZoneAuthoritySourceKind.WORKER_ZONE_GRANT &&
        fact.payload.siteId === scope.siteId &&
        fact.payload.zoneId === scope.zoneId &&
        fact.payload.workerId === scope.workerId &&
        fact.payload.contractorId === null) ||
      (fact.sourceKind === ZoneAuthoritySourceKind.ASSIGNMENT &&
        fact.payload.siteId === scope.siteId &&
        fact.payload.workerId === scope.workerId &&
        fact.payload.zoneIds.includes(scope.zoneId) &&
        fact.payload.contractorId === null),
  );
  if (relevantLegacy) return unavailable('LEGACY_CONTRACTOR_ANCHOR');
  return {
    status: 'PROJECTED',
    scope: scoped,
    projection,
    restrictionPolicy: zonePolicy.payload.restrictionPolicy,
    eligibility: {
      workerActive: membership.payload.isActive,
      contractorActive: contractor.payload.isActive,
    },
  };
}
