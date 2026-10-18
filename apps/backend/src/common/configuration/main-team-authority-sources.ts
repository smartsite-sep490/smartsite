import { MAIN_AUTHORITY_SOURCES } from './main-authority-sources.js';

/** Frozen V2 inventory. V1 is imported by applied migrations and must remain unchanged. */
export const MAIN_AUTHORITY_V2_SOURCES = [
  ...MAIN_AUTHORITY_SOURCES.map(
    ([kind, table, fields]) =>
      [kind, table, kind === 'ASSIGNMENT' ? [...fields, 'zone_ids'] : fields] as const,
  ),
  ['TEAM', 'contractor_team', ['id', 'site_id', 'contractor_id', 'is_active']],
  [
    'TEAM_MEMBERSHIP',
    'contractor_team_membership',
    ['id', 'site_id', 'contractor_id', 'team_id', 'worker_id', 'joined_at', 'left_at'],
  ],
  [
    'TEAM_PERMISSION',
    'team_zone_permission',
    ['id', 'team_id', 'contractor_zone_permission_id', 'valid_from', 'valid_until', 'revoked_at'],
  ],
] as const;
