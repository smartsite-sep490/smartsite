import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../src/common/configuration/main-team-authority-sources.js';
import { MAIN_AUTHORITY_ARCHIVE_FORMAT_V2 } from '../src/modules/zones/main-authority-archive-codec.js';
import { MainQualifiedAuthorityReader } from '../src/modules/zones/main-qualified-authority.reader.js';

test('qualified authority output keeps operational coverage and synthetic mechanics provenance mutually exclusive', async () => {
  for (const provenance of ['OPERATIONAL_REVIEWED', 'SYNTHETIC_TEST'] as const) {
    const epochId = '11111111-1111-4111-8111-111111111111';
    const manifestSha256 = 'a'.repeat(64),
      sourceRegistryHash = 'b'.repeat(64);
    const baseline = {
      epochId,
      capturedAt: '2026-10-30T00:00:00.000000Z',
      declaredWriterManifestHash: manifestSha256,
      sourceRegistryHash,
      snapshotHash: 'c'.repeat(64),
    };
    const archive = {
      format: MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
      payload: {
        baseline,
        sources: MAIN_AUTHORITY_V2_SOURCES.map(([sourceKind, tableName, fields]) => ({
          sourceKind,
          tableName,
          fields,
          rows: [],
        })),
      },
    };
    const reader = new MainQualifiedAuthorityReader(
      {} as DataSource,
      {
        manifestPath: 'D:/synthetic-unused-release.json',
        reviewedManifestSha256: manifestSha256,
        releaseRoot: 'D:/synthetic-unused-release',
        releaseCommit: 'd'.repeat(40),
      },
      new ConfigService<BackendEnvironment, true>({ NODE_ENV: 'test' }),
      { read: async () => ({ status: 'RECONSTRUCTED', archive }) } as never,
    );
    // Isolate the output mapping after qualification; no operational release or DB proof is fabricated.
    Reflect.set(reader, 'qualifyEpoch', async () => ({
      epoch_id: epochId,
      state: 'READY',
      writer_manifest_hash: manifestSha256,
      source_registry_hash: sourceRegistryHash,
      snapshot_hash: baseline.snapshotHash,
      captured_at: baseline.capturedAt,
      activated_at: baseline.capturedAt,
      gapped_at: null,
      closed_at: null,
      witness_confirmed_at: baseline.capturedAt,
      revision_state_hash: 'EMPTY',
    }));
    const prepare = Reflect.get(reader, 'prepareInSnapshot').bind(reader) as (
      ...args: unknown[]
    ) => Promise<{
      status: string;
      provenance: string;
      operationalAuthorityCoverageEstablished: boolean;
      syntheticCutoverMechanicsVerified: boolean;
      identityEstablished: boolean;
    }>;
    const result = await prepare(
      {} as EntityManager,
      { epochId },
      {
        manifestSha256,
        sourceRegistryHash,
        releaseCommit: 'd'.repeat(40),
        provenance,
      },
    );
    assert.equal(result.status, 'QUALIFIED');
    assert.equal(result.provenance, provenance);
    assert.equal(
      result.operationalAuthorityCoverageEstablished,
      provenance === 'OPERATIONAL_REVIEWED',
    );
    assert.equal(result.syntheticCutoverMechanicsVerified, provenance === 'SYNTHETIC_TEST');
    assert.equal(result.identityEstablished, false);
    assert.ok(Object.isFrozen(result));
  }
});
