import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import {
  SiteEntity,
  WorkerSiteZoneAssignmentEntity,
  ZoneAccessGrantEntity,
  ZoneAuthorityCommandEntity,
} from '../src/database/entities/index.js';
import { createIsolatedTestDatabase } from './support/isolated-test-database.js';

async function metadataOnly(legacy: boolean) {
  const previous = process.env.TEST_DATABASE_URL;
  process.env.TEST_DATABASE_URL =
    'postgresql://smartsite_test:synthetic-never-connected@127.0.0.1:5433/smartsite_test';
  try {
    const fixture = createIsolatedTestDatabase(legacy ? { legacy: true } : { canonical: true });
    // Invoke only TypeORM's metadata compiler. No initialize, socket, migration or SQL.
    const build = Reflect.get(DataSource.prototype, 'buildMetadatas') as (
      this: DataSource,
    ) => Promise<void>;
    await build.call(fixture.dataSource);
    assert.equal(fixture.dataSource.isInitialized, false);
    return fixture.dataSource;
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = previous;
  }
}

test('legacy24 metadata matches the old schema instead of selecting Main-only columns', async () => {
  const source = await metadataOnly(true);
  const columns = (
    target:
      typeof SiteEntity | typeof WorkerSiteZoneAssignmentEntity | typeof ZoneAccessGrantEntity,
  ) => source.getMetadata(target).columns.map((column) => column.propertyName);
  assert.equal(columns(SiteEntity).includes('accessPolicyVersion'), false);
  assert.equal(columns(WorkerSiteZoneAssignmentEntity).includes('contractorId'), true);
  assert.equal(columns(WorkerSiteZoneAssignmentEntity).includes('siteContractorId'), false);
  assert.equal(columns(ZoneAccessGrantEntity).includes('contractorId'), true);
  assert.equal(source.hasMetadata(ZoneAuthorityCommandEntity), true);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
});

test('canonical metadata keeps current Main participation FK and excludes branch-only history', async () => {
  const source = await metadataOnly(false);
  const assignment = source.getMetadata(WorkerSiteZoneAssignmentEntity);
  assert.equal(
    assignment.columns.some((column) => column.propertyName === 'siteContractorId'),
    true,
  );
  assert.equal(
    assignment.columns.some((column) => column.propertyName === 'contractorId'),
    false,
  );
  assert.equal(
    source
      .getMetadata(SiteEntity)
      .columns.some((column) => column.propertyName === 'accessPolicyVersion'),
    true,
  );
  assert.equal(
    source
      .getMetadata(ZoneAccessGrantEntity)
      .columns.some((column) => column.propertyName === 'contractorId'),
    false,
  );
  assert.equal(source.hasMetadata(ZoneAuthorityCommandEntity), false);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
});

test('legacy constructor aliases do not accept an unknown class with a trusted entity name', async () => {
  const source = await metadataOnly(true);
  const impostor = class SiteEntity {};
  assert.equal(source.hasMetadata(SiteEntity), true);
  assert.equal(source.hasMetadata(impostor), false);
  assert.throws(() => source.getMetadata(impostor), /No metadata/);
});

test('historical fixture bytes stay pinned and explicitly exclude production usage', async () => {
  const root = new URL('./support/legacy24/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8')) as {
    sourceCommit: string;
    productionUsageAllowed: boolean;
    canonicalProfileChanged: boolean;
    files: { path: string; snapshotSha256: string; gitBlob: string }[];
  };
  assert.equal(provenance.sourceCommit, '587faebbd1e7f9481d485d97ede92d507c51ccce');
  assert.equal(provenance.productionUsageAllowed, false);
  assert.equal(provenance.canonicalProfileChanged, false);
  assert.equal(provenance.files.length, 53);
  assert.equal(new Set(provenance.files.map((file) => file.path)).size, 53);
  for (const file of provenance.files) {
    const prefix = 'apps/backend/test/support/legacy24/';
    assert.equal(file.path.startsWith(prefix), true);
    assert.equal(file.path.includes('..'), false);
    assert.match(file.gitBlob, /^[a-f0-9]{40}$/);
    const bytes = await readFile(new URL(file.path.slice(prefix.length), root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.snapshotSha256, file.path);
  }
});
