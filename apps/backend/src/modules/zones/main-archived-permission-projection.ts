import { ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import type { ZoneAccessEffect } from './zone-authorization.interface.js';
import { projectMainTeamPermissions } from './main-team-permission-projection.js';
import {
  decodeStoredMainAuthorityArchive,
  parseMainAuthorityInstant,
  type MainAuthorityArchiveContext,
} from './main-authority-archive-codec.js';

export type MainArchivedPermissionProjectionResult =
  | { status: 'UNAVAILABLE'; reason: string }
  | {
      status: 'PROJECTED';
      projectionVersion: 'MAIN_ARCHIVED_ZONE_EFFECTS_V1';
      sourceArchiveSha256: string;
      restrictionPolicy: ZoneRestrictionPolicy;
      effects: readonly ZoneAccessEffect[];
      allowPermissionIds: readonly string[];
      denyGrantIds: readonly string[];
      authorityCoverageEstablished: false;
      identityEstablished: false;
    };
type Row = Record<string, unknown>;
interface Interval {
  from: bigint;
  until: bigint | null;
  revoked: bigint | null;
}
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function interval(row: Row): Interval {
  // The archive codec has already validated finite RFC3339 values and ordering.
  return {
    from: parseMainAuthorityInstant(row.valid_from as string)!,
    until: row.valid_until === null ? null : parseMainAuthorityInstant(row.valid_until as string)!,
    revoked:
      row.revoked_at === undefined || row.revoked_at === null
        ? null
        : parseMainAuthorityInstant(row.revoked_at as string)!,
  };
}
function active(value: Interval, at: bigint) {
  return (
    value.from <= at &&
    (value.until === null || at < value.until) &&
    (value.revoked === null || at < value.revoked)
  );
}
function contained(child: Interval, parent: Interval) {
  return (
    child.from >= parent.from &&
    child.until !== null &&
    (parent.until === null || child.until <= parent.until)
  );
}
const unavailable = (reason: string): MainArchivedPermissionProjectionResult => ({
  status: 'UNAVAILABLE',
  reason,
});

/** Private effect projection only. Digest integrity is neither writer coverage nor
 * identity. No runtime provider/API, policy verdict, epoch activation or AI call.
 * Preserve the retained MAIN SQL predicate, not the old independent grant model.
 */
export function projectMainArchivedPermissions(
  value: unknown,
  expected: MainAuthorityArchiveContext & { sha256: string },
): MainArchivedPermissionProjectionResult {
  const decoded = decodeStoredMainAuthorityArchive(value, expected);
  if (decoded.status !== 'VALID') return unavailable(decoded.reason);
  const { archive } = decoded,
    { context } = archive.payload;
  const rows = new Map(archive.payload.sources.map((s) => [s.sourceKind, s.rows]));
  const index = (kind: string) =>
    new Map((rows.get(kind) ?? []).map((row) => [(row.id as string).toLowerCase(), row]));
  const zones = index('ZONE_POLICY'),
    zone = zones.get(context.zoneId.toLowerCase())!;
  const restrictionPolicy = zone.restriction_policy as ZoneRestrictionPolicy;
  const result = (allows: string[], denies: string[]): MainArchivedPermissionProjectionResult => {
    const effects: ZoneAccessEffect[] = [];
    if (allows.length) effects.push('ALLOW');
    if (denies.length) effects.push('DENY');
    return Object.freeze({
      status: 'PROJECTED',
      projectionVersion: 'MAIN_ARCHIVED_ZONE_EFFECTS_V1',
      sourceArchiveSha256: archive.sha256,
      restrictionPolicy,
      effects: Object.freeze(effects),
      allowPermissionIds: Object.freeze(allows.sort()),
      denyGrantIds: Object.freeze(denies.sort()),
      authorityCoverageEstablished: false,
      identityEstablished: false,
    });
  };
  if (restrictionPolicy !== ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED) return result([], []);
  if (context.workerId === null) return unavailable('WORKER_REFERENCE_UNAVAILABLE');
  const worker = index('WORKER').get(context.workerId.toLowerCase());
  if (!worker || !same(worker.site_id, context.siteId) || worker.is_active !== true)
    return unavailable('WORKER_UNAVAILABLE');
  const at = parseMainAuthorityInstant(context.capturedAt)!;
  const denies = (rows.get('ZONE_GRANT') ?? [])
    .filter(
      (row) =>
        row.effect === 'DENY' &&
        same(row.site_id, context.siteId) &&
        same(row.zone_id, context.zoneId) &&
        same(row.worker_id, context.workerId) &&
        active(interval(row), at),
    )
    .map((row) => row.id as string);
  const assignments = index('ASSIGNMENT'),
    contractorPermissions = index('CONTRACTOR_PERMISSION'),
    participations = index('PARTICIPATION'),
    contractors = index('CONTRACTOR');
  const allows: string[] =
    archive.format === 'MF06_MAIN_AUTHORITY_ARCHIVE_V2' ? projectMainTeamPermissions(archive) : [];
  for (const permission of rows.get('WORKER_PERMISSION') ?? []) {
    const assignment = assignments.get((permission.worker_assignment_id as string).toLowerCase());
    const cp = contractorPermissions.get(
      (permission.contractor_zone_permission_id as string).toLowerCase(),
    );
    if (
      !assignment ||
      !cp ||
      !same(cp.site_contractor_id, assignment.site_contractor_id) ||
      !same(assignment.worker_id, context.workerId) ||
      !same(assignment.site_id, context.siteId) ||
      !same(cp.zone_id, context.zoneId) ||
      assignment.status !== 'APPROVED' ||
      assignment.valid_until === null
    )
      continue;
    const participation = participations.get((cp.site_contractor_id as string).toLowerCase());
    if (
      !participation ||
      !same(participation.site_id, assignment.site_id) ||
      !same(participation.contractor_id, worker.contractor_id) ||
      participation.is_active !== true
    )
      continue;
    const contractor = contractors.get((participation.contractor_id as string).toLowerCase());
    if (!contractor || contractor.is_active !== true) continue;
    const wpTime = interval(permission),
      assignmentTime = interval(assignment),
      cpTime = interval(cp),
      participationTime = interval(participation);
    if (
      active(wpTime, at) &&
      active(assignmentTime, at) &&
      active(cpTime, at) &&
      active(participationTime, at) &&
      contained(wpTime, assignmentTime) &&
      contained(wpTime, cpTime) &&
      contained(wpTime, participationTime)
    )
      allows.push(permission.id as string);
  }
  return result(allows, denies);
}
