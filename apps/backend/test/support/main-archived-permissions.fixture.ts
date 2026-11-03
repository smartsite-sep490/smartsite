import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  sealMainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from '../../src/modules/zones/main-authority-archive-codec.js';

export function archivedPermissionsFixture() {
  const site = randomUUID(),
    zone = randomUUID(),
    worker = randomUUID(),
    contractor = randomUUID(),
    participation = randomUUID(),
    assignment = randomUUID(),
    cp = randomUUID(),
    wp = randomUUID();
  const context: MainAuthorityArchiveContext = {
    siteId: site,
    zoneId: zone,
    workerId: worker,
    capturedAt: '2026-10-11T12:00:00.000001Z',
    purpose: 'RETROSPECTIVE_REVIEW',
  };
  const range = {
    valid_from: '2026-10-11T00:00:00.000001Z',
    valid_until: '2026-10-12T00:00:00.000001Z',
  };
  const data: Record<string, Record<string, unknown>[]> = {
    SITE: [{ id: site, access_policy_version: 1 }],
    ZONE_POLICY: [
      {
        id: zone,
        site_id: site,
        restriction_policy: 'AUTHORIZATION_REQUIRED',
        required_ppe: [],
        configuration_locked: false,
      },
    ],
    WORKER: [
      { id: worker, site_id: site, contractor_id: contractor, user_id: null, is_active: true },
    ],
    CONTRACTOR: [{ id: contractor, is_active: true }],
    PARTICIPATION: [
      { id: participation, contractor_id: contractor, site_id: site, is_active: true, ...range },
    ],
    ASSIGNMENT: [
      {
        id: assignment,
        worker_id: worker,
        site_id: site,
        site_contractor_id: participation,
        status: 'APPROVED',
        version: 1,
        ...range,
      },
    ],
    CONTRACTOR_PERMISSION: [
      { id: cp, site_contractor_id: participation, zone_id: zone, ...range, revoked_at: null },
    ],
    WORKER_PERMISSION: [
      {
        id: wp,
        worker_assignment_id: assignment,
        contractor_zone_permission_id: cp,
        ...range,
        revoked_at: null,
      },
    ],
    ZONE_GRANT: [],
  };
  const payload = {
    version: MAIN_AUTHORITY_ARCHIVE_FORMAT,
    context,
    archivedAt: '2026-10-12T12:00:00.000001Z',
    baseline: {
      epochId: randomUUID(),
      capturedAt: '2026-10-10T00:00:00.000001Z',
      declaredWriterManifestHash: 'a'.repeat(64),
      sourceRegistryHash: 'b'.repeat(64),
      snapshotHash: 'c'.repeat(64),
    },
    sources: MAIN_AUTHORITY_SOURCES.map(([sourceKind, tableName, fields]) => ({
      sourceKind,
      tableName,
      fields,
      rows: data[sourceKind] ?? [],
    })),
  };
  return {
    site,
    zone,
    worker,
    contractor,
    participation,
    assignment,
    cp,
    wp,
    context,
    payload,
    rows: (kind: string) => payload.sources.find((s) => s.sourceKind === kind)!.rows,
    seal() {
      const result = sealMainAuthorityArchive(payload, context);
      assert.equal(result.status, 'VALID');
      if (result.status !== 'VALID') throw Error('Invalid synthetic archive');
      return result.archive;
    },
    deny(effect = 'DENY') {
      const id = randomUUID();
      payload.sources
        .find((s) => s.sourceKind === 'ZONE_GRANT')!
        .rows.push({
          id,
          site_id: site,
          zone_id: zone,
          worker_id: worker,
          effect,
          ...range,
          revoked_at: null,
        });
      return id;
    },
  };
}
