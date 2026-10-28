import { randomUUID } from 'node:crypto';
import { archivedPermissionsFixture } from './main-archived-permissions.fixture.js';

const V2 = 'MF06_MAIN_AUTHORITY_ARCHIVE_V2';
export function teamArchiveFixture() {
  const base = archivedPermissionsFixture();
  const team = randomUUID();
  const sources: {
    sourceKind: string;
    tableName: string;
    fields: readonly string[];
    rows: Record<string, unknown>[];
  }[] = structuredClone(base.payload.sources);
  for (const source of sources) {
    if (source.sourceKind === 'ASSIGNMENT') {
      source.fields = [...source.fields, 'zone_ids'];
      source.rows[0]!.zone_ids = [base.zone];
    }
    if (source.sourceKind === 'WORKER_PERMISSION') source.rows = [];
  }
  sources.push(
    {
      sourceKind: 'TEAM',
      tableName: 'contractor_team',
      fields: ['id', 'site_id', 'contractor_id', 'is_active'],
      rows: [{ id: team, site_id: base.site, contractor_id: base.contractor, is_active: true }],
    },
    {
      sourceKind: 'TEAM_MEMBERSHIP',
      tableName: 'contractor_team_membership',
      fields: ['id', 'team_id', 'worker_id', 'site_id', 'contractor_id', 'joined_at', 'left_at'],
      rows: [
        {
          id: randomUUID(),
          team_id: team,
          worker_id: base.worker,
          site_id: base.site,
          contractor_id: base.contractor,
          joined_at: '2026-10-11T00:00:00.000001Z',
          left_at: null,
        },
      ],
    },
    {
      sourceKind: 'TEAM_PERMISSION',
      tableName: 'team_zone_permission',
      fields: [
        'id',
        'team_id',
        'contractor_zone_permission_id',
        'valid_from',
        'valid_until',
        'revoked_at',
      ],
      rows: [
        {
          id: randomUUID(),
          team_id: team,
          contractor_zone_permission_id: base.cp,
          valid_from: '2026-10-11T00:00:00.000001Z',
          valid_until: '2026-10-12T00:00:00.000001Z',
          revoked_at: null,
        },
      ],
    },
  );
  const payload = { ...base.payload, version: V2, sources };
  return {
    context: base.context,
    payload,
    row: (kind: string) => sources.find((s) => s.sourceKind === kind)!.rows[0]!,
    deny() {
      const id = base.deny();
      sources
        .find((s) => s.sourceKind === 'ZONE_GRANT')!
        .rows.push(base.rows('ZONE_GRANT').at(-1)!);
      return id;
    },
  };
}
