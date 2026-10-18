import {
  parseMainAuthorityInstant,
  type MainAuthorityArchive,
} from './main-authority-archive-codec.js';

type Row = Record<string, unknown>;
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const time = (v: unknown) => parseMainAuthorityInstant(v as string)!;
const active = (row: Row, at: bigint) =>
  time(row.valid_from) <= at &&
  (row.valid_until === null || at < time(row.valid_until)) &&
  (row.revoked_at === undefined || row.revoked_at === null || at < time(row.revoked_at));
const contained = (child: Row, parent: Row) =>
  child.valid_until !== null &&
  time(child.valid_from) >= time(parent.valid_from) &&
  (parent.valid_until === null || time(child.valid_until) <= time(parent.valid_until));

/** Validated V2 archive only. Keep the current MAIN team SQL predicate, including Zone membership. */
export function projectMainTeamPermissions(archive: MainAuthorityArchive): string[] {
  const { context, sources } = archive.payload;
  const rows = new Map(sources.map((source) => [source.sourceKind, source.rows]));
  const at = time(context.capturedAt);
  const worker = rows.get('WORKER')!.find((row) => same(row.id, context.workerId))!;
  const allowed: string[] = [];
  for (const permission of rows.get('TEAM_PERMISSION') ?? []) {
    const team = rows.get('TEAM')?.find((row) => same(row.id, permission.team_id));
    if (
      !team ||
      team.is_active !== true ||
      !same(team.site_id, context.siteId) ||
      !same(team.contractor_id, worker.contractor_id)
    )
      continue;
    const member = rows
      .get('TEAM_MEMBERSHIP')
      ?.some(
        (row) =>
          same(row.team_id, team.id) &&
          same(row.site_id, team.site_id) &&
          same(row.contractor_id, team.contractor_id) &&
          same(row.worker_id, context.workerId) &&
          time(row.joined_at) <= at &&
          (row.left_at === null || at < time(row.left_at)),
      );
    if (!member || !active(permission, at)) continue;
    const cp = rows
      .get('CONTRACTOR_PERMISSION')
      ?.find(
        (row) =>
          same(row.id, permission.contractor_zone_permission_id) &&
          same(row.zone_id, context.zoneId),
      );
    if (!cp || !active(cp, at) || !contained(permission, cp)) continue;
    const participation = rows
      .get('PARTICIPATION')
      ?.find(
        (row) =>
          same(row.id, cp.site_contractor_id) &&
          same(row.site_id, team.site_id) &&
          same(row.contractor_id, team.contractor_id) &&
          row.is_active === true,
      );
    if (!participation || !active(participation, at) || !contained(permission, participation))
      continue;
    if (
      !rows
        .get('CONTRACTOR')
        ?.some((row) => same(row.id, participation.contractor_id) && row.is_active === true)
    )
      continue;
    const assigned = rows
      .get('ASSIGNMENT')
      ?.some(
        (row) =>
          same(row.worker_id, context.workerId) &&
          same(row.site_id, context.siteId) &&
          same(row.site_contractor_id, participation.id) &&
          row.status === 'APPROVED' &&
          row.valid_until !== null &&
          active(row, at) &&
          (row.zone_ids as string[]).some((id) => same(id, context.zoneId)),
      );
    if (assigned) allowed.push(permission.id as string);
  }
  return allowed;
}
