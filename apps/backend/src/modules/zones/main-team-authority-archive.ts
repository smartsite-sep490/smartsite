import { z } from 'zod';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';

export const MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT = 'MF06_MAIN_AUTHORITY_ARCHIVE_V2';
export const MAIN_TEAM_AUTHORITY_SOURCES: readonly (readonly [
  string,
  string,
  readonly string[],
])[] = MAIN_AUTHORITY_V2_SOURCES;

export function teamAuthorityRowSchemas(validInstant: (value: string) => boolean) {
  const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const instant = z.string().max(40).refine(validInstant);
  return {
    TEAM: z.strictObject({ id, site_id: id, contractor_id: id, is_active: z.boolean() }),
    TEAM_MEMBERSHIP: z.strictObject({
      id,
      team_id: id,
      worker_id: id,
      site_id: id,
      contractor_id: id,
      joined_at: instant,
      left_at: instant.nullable(),
    }),
    TEAM_PERMISSION: z.strictObject({
      id,
      team_id: id,
      contractor_zone_permission_id: id,
      valid_from: instant,
      valid_until: instant,
      revoked_at: instant.nullable(),
    }),
  };
}

/** Referential consistency only, never a grant of permission or coverage. */
export function teamAuthorityScopeMatches(rows: Map<string, Record<string, unknown>[]>): boolean {
  const same = (a: unknown, b: unknown) =>
    typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  const find = (kind: string, id: unknown) =>
    (rows.get(kind) ?? []).find((row) => same(row.id, id));
  for (const team of rows.get('TEAM') ?? [])
    if (!find('SITE', team.site_id) || !find('CONTRACTOR', team.contractor_id)) return false;
  for (const member of rows.get('TEAM_MEMBERSHIP') ?? []) {
    const team = find('TEAM', member.team_id),
      worker = find('WORKER', member.worker_id);
    if (
      !team ||
      !worker ||
      !same(member.site_id, team.site_id) ||
      !same(member.contractor_id, team.contractor_id) ||
      !same(worker.site_id, team.site_id)
    )
      return false;
  }
  for (const permission of rows.get('TEAM_PERMISSION') ?? []) {
    const team = find('TEAM', permission.team_id);
    const parent = find('CONTRACTOR_PERMISSION', permission.contractor_zone_permission_id);
    const participation = parent && find('PARTICIPATION', parent.site_contractor_id);
    const zone = parent && find('ZONE_POLICY', parent.zone_id);
    if (
      !team ||
      !participation ||
      !zone ||
      !same(team.site_id, participation.site_id) ||
      !same(team.contractor_id, participation.contractor_id) ||
      !same(team.site_id, zone.site_id)
    )
      return false;
  }
  return true;
}
