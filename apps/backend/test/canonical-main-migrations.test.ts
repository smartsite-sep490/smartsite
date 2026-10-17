import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import { createIsolatedTestDatabase } from './support/isolated-test-database.js';

const repository = process.env.SMARTSITE_TEST_SOURCE_REPO;
const baseline = '2e98619ac94be775ef43f4cb3076f00a59b88df1';
const previousMain = '3ce035888d18b61f8b70bd7c1eada4ae8d799d74';
const currentMain = '0ef7b6901cde852e5660e8a58f1a194e16ac560a';
const retainedChecklist = '7bb4501692830f185a367fc0e2fbf06685f725b2';
test(
  'owned test database defaults to release graph; historical24 requires an explicit test-only selection',
  {
    skip: process.env.TEST_DATABASE_URL
      ? false
      : 'Explicit test connection metadata required; no connection opened',
  },
  () => {
    const canonical = createIsolatedTestDatabase();
    const legacy = createIsolatedTestDatabase({ legacy: true });
    const production = buildTypeOrmOptions({
      DATABASE_URL: 'postgresql://unit:unit@localhost/unit',
    });
    assert.deepEqual(canonical.dataSource.options.migrations, production.migrations);
    assert(Array.isArray(legacy.dataSource.options.migrations));
    assert.equal(legacy.dataSource.options.migrations.length, 24);
    assert.equal(canonical.dataSource.isInitialized, false);
    assert.equal(legacy.dataSource.isInitialized, false);
  },
);
test(
  'production migration graph includes pinned current Main, four Safety slots and additive team history without rewriting historical migrations',
  { skip: repository ? false : 'Explicit pinned source repository required' },
  () => {
    assert.ok(repository);
    const original = (path: string, commit = baseline) =>
      execFileSync('git', ['show', `${commit}:${path}`], {
        cwd: repository,
        windowsHide: true,
        maxBuffer: 2_097_152,
      });
    const options = original(
      'apps/backend/src/database/typeorm.options.ts',
      currentMain,
    ).toString();
    const names = options
      .match(/migrations: \[([\s\S]*?)\]/)![1]!
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const registered = buildTypeOrmOptions({
      DATABASE_URL: 'postgresql://unit:unit@localhost/unit',
    });
    assert(Array.isArray(registered.migrations));
    const actual = registered.migrations.map((migration) => {
      assert.equal(typeof migration, 'function');
      return (migration as new () => { name: string }).name;
    });
    const expected = [
      ...names,
      'Mf06AssessmentRequests1791590400001',
      'Mf06MainAuthorityJournal1791590400002',
      'SafetyFaceProvenance1791590400003',
      'Mf06ImmutableAssessments1791590400004',
      'Mf06TeamAuthorityHistory1792281600000',
      'PrepareNotificationCompatibility1792010000000',
      'CompleteNotificationCompatibility1792368000001',
      'ZoneEntryPhysicalStorage1792454400000',
    ];
    assert.deepEqual([...actual].sort(), [...expected].sort());
    assert.equal(new Set(actual).size, actual.length, 'migration registrations must be unique');
    assert.equal(new Set(expected).size, expected.length);
    assert.equal(registered.synchronize, false);
    assert.equal(registered.migrationsRun, false);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    // Retain the already-applied Tuấn Checklist bytes; later forward migrations
    // reconcile Main's Manager notification CHECK without rewriting this history.
    for (const match of options.matchAll(/from '\.\/migrations\/([\w-]+)\.js'/g)) {
      const path = `apps/backend/src/database/migrations/${match[1]}.ts`;
      assert.equal(
        digest(readFileSync(join(repository, path))),
        digest(
          original(
            path,
            path.endsWith('/1792195200000-SafetyChecklists.ts') ? retainedChecklist : currentMain,
          ),
        ),
        path,
      );
    }
    const historicalOptions = original('apps/backend/src/database/typeorm.options.ts').toString();
    for (const match of historicalOptions.matchAll(/from '\.\/migrations\/([\w-]+)\.js'/g)) {
      const path = `apps/backend/src/database/migrations/${match[1]}.ts`;
      assert.equal(digest(readFileSync(join(repository, path))), digest(original(path)), path);
    }
    const priorOptions = original(
      'apps/backend/src/database/typeorm.options.ts',
      previousMain,
    ).toString();
    const upstreamEdits = [...priorOptions.matchAll(/from '\.\/migrations\/([\w-]+)\.js'/g)]
      .map((match) => `apps/backend/src/database/migrations/${match[1]}.ts`)
      .filter(
        (path) => digest(original(path, previousMain)) !== digest(original(path, currentMain)),
      );
    // Main changed an existing checklist constraint; byte provenance is not upgrade proof.
    assert.deepEqual(upstreamEdits, [
      'apps/backend/src/database/migrations/1792195200000-SafetyChecklists.ts',
    ]);
    assert(!actual.includes('ZoneAuthorityHistory1791417600000'));
  },
);
