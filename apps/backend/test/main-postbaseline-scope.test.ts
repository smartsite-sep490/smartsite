import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { archivedPermissionsFixture } from './support/main-archived-permissions.fixture.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../src/common/configuration/main-team-authority-sources.js';
import { MainAuthorityCapturedStateReader } from '../src/modules/zones/main-authority-captured-state.reader.js';

function fixture({ insertZone = true, malformed = false, crossSite = false } = {}) {
  const f = archivedPermissionsFixture(),
    epoch = randomUUID(),
    context = { ...f.context, workerId: null };
  const sources = f.payload.sources.map((s) => ({ ...s, rows: [] }));
  const siteSource = sources.find((s) => s.sourceKind === 'SITE')!;
  (siteSource.rows as Record<string, unknown>[]).push({
    id: f.site,
    access_policy_version: malformed ? 'invalid' : 1,
  });
  const base = {
    version: 'MF06_MAIN_BASELINE_JSONB_V1',
    epochId: epoch,
    capturedAt: f.payload.baseline.capturedAt,
    declaredWriterManifestHash: 'a'.repeat(64),
    sourceRegistryHash: 'b'.repeat(64),
    sources,
  };
  const zone = {
    ...f.payload.sources.find((s) => s.sourceKind === 'ZONE_POLICY')!.rows[0]!,
    site_id: crossSite ? randomUUID() : f.site,
  };
  let factReads = 0;
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: async (sql: string) => {
      if (sql.includes('transaction_isolation'))
        return [{ isolation: 'serializable', readonly: 'on', after_transaction_start: false }];
      if (sql.startsWith('SET LOCAL')) return [];
      if (sql.includes('SELECT source_kind,table_name,fields,protocol_version'))
        return MAIN_AUTHORITY_V2_SOURCES.map(([kind, table, fields]) => ({
          source_kind: kind,
          table_name: table,
          fields: [...fields],
          protocol_version: 'MAIN_ROW_JOURNAL_V1',
        })).sort((a, b) => (a.source_kind < b.source_kind ? -1 : 1));
      if (sql.includes('WITH sources AS')) return [{ valid: true }];
      if (sql.includes('snapshot_json::text AS snapshot_text'))
        return [
          {
            epoch_id: epoch,
            captured_at: base.capturedAt,
            archived_at: f.payload.archivedAt,
            writer_manifest_hash: base.declaredWriterManifestHash,
            source_registry_hash: base.sourceRegistryHash,
            snapshot_hash: 'c'.repeat(64),
            snapshot_text: JSON.stringify(base),
            row_count: 1,
            baseline_hash_valid: true,
            registry_hash_valid: true,
            origin_valid: true,
            witness_known: true,
            before_baseline: false,
            future: false,
          },
        ];
      if (sql.includes('SELECT snapshot_json=')) return [{ exact: true }];
      if (sql.includes('FROM authorization_history_gap')) return [];
      if (sql.includes('WITH selected AS')) return [{ n: insertZone ? 1 : 0, bytes: '1024' }];
      if (sql.includes('SELECT f.fact_id')) {
        factReads++;
        return insertZone
          ? [
              {
                fact_id: randomUUID(),
                source_kind: 'ZONE_POLICY',
                source_id: f.zone,
                revision: '1',
                base_revision: '0',
                operation: 'INSERT',
                before_text: null,
                after_text: JSON.stringify(zone),
                known: true,
                hashes_valid: true,
              },
            ]
          : [];
      }
      if (sql.includes('jsonb_to_recordset')) return [{ value: true }];
      throw Error('Unexpected historical reader query');
    },
  } as unknown as EntityManager;
  return {
    read: () =>
      new MainAuthorityCapturedStateReader().read(manager, { ...context, epochId: epoch }),
    factReads: () => factReads,
  };
}

test('history reconstructs a Zone created after the baseline before checking requested scope', async () => {
  const fx = fixture(),
    result = await fx.read();
  assert.equal(result.status, 'RECONSTRUCTED', JSON.stringify(result));
  assert.equal(fx.factReads(), 1);
  if (result.status === 'RECONSTRUCTED')
    assert.equal(
      result.archive.payload.sources.find((s) => s.sourceKind === 'ZONE_POLICY')!.rows.length,
      1,
    );
});
test('missing or cross-Site reconstructed Zone remains unavailable', async () => {
  for (const options of [{ insertZone: false }, { crossSite: true }])
    assert.deepEqual(await fixture(options).read(), {
      status: 'UNAVAILABLE',
      reason: 'SOURCE_SCOPE_MISMATCH',
    });
});
test('malformed baseline rows still fail before history traversal', async () => {
  const fx = fixture({ malformed: true });
  assert.deepEqual(await fx.read(), { status: 'UNAVAILABLE', reason: 'MALFORMED_ARCHIVE' });
  assert.equal(fx.factReads(), 0);
});
