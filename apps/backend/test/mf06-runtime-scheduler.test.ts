import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
} from '../src/modules/zones/main-authority-cutover-release.js';
import { Mf06AssessmentWorkerRuntime } from '../src/modules/safety/assessments/mf06-assessment-worker-runtime.service.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    assert(Date.now() < deadline, 'Expected lifecycle transition');
    await sleep(20);
  }
}
async function syntheticRelease(omitPath?: string) {
  const runs = tmpdir();
  await mkdir(runs, { recursive: true });
  const root = await mkdtemp(join(runs, 'mf06-synthetic-runtime-'));
  const releaseRoot = join(root, 'release');
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
  const files = [];
  for (const path of MAIN_AUTHORITY_CUTOVER_RELEASE_FILES) {
    if (path === omitPath) continue;
    const target = resolve(releaseRoot, path);
    await mkdir(dirname(target), { recursive: true });
    // Synthetic review input only, never represented as operational source/writer review.
    const bytes = Buffer.from(`// SYNTHETIC_TEST pin ${path}\n`);
    await writeFile(target, bytes, { flag: 'wx' });
    files.push({ path, sha256: hash(bytes) });
  }
  const runtimeFiles = await Promise.all(
    MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES.map(async (path) => ({
      path,
      sha256: hash(await readFile(resolve(runtimeRoot, path))),
    })),
  );
  const manifestPath = join(root, 'SYNTHETIC-NOT-OPERATIONAL.json');
  const releaseCommit = 'b'.repeat(40);
  const bytes = Buffer.from(
    JSON.stringify({
      version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
      releaseCommit,
      captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1',
      provenance: 'SYNTHETIC_TEST',
      sourceRegistryHash: 'a'.repeat(64),
      files,
      runtimeFiles,
      writerReview: {
        protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1',
        sourceIndexSha256: 'c'.repeat(64),
        methods: 1,
        files: 1,
        exactQuotesAndSourcePinsVerified: true,
        missingOrDuplicateMethods: false,
        completeWriterClosureEstablished: true,
        rows: [
          {
            file: 'modules/auth/auth.service.ts',
            method: 'syntheticFixtureOnly',
            fileSha256: files.find((f) => f.path.endsWith('/auth.service.ts'))!.sha256,
            methodBodySha256: 'd'.repeat(64),
            classification: 'MASKED_COMMAND',
          },
        ],
      },
    }),
  );
  await writeFile(manifestPath, bytes, { flag: 'wx' });
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    MF06_WORKER_ENABLED: true,
    MF06_CUTOVER_MANIFEST_PATH: manifestPath,
    MF06_CUTOVER_MANIFEST_SHA256: hash(bytes),
    MF06_CUTOVER_RELEASE_ROOT: releaseRoot,
    MF06_CUTOVER_RELEASE_COMMIT: releaseCommit,
  });
  return {
    config,
    corrupt: () => writeFile(manifestPath, '{}'),
    restore: () => writeFile(manifestPath, bytes),
  };
}
for (const path of [
  'apps/backend/src/modules/zones/zone-authority-transaction.ts',
  'apps/backend/src/common/configuration/authority-storage-relations.ts',
  'apps/backend/src/common/configuration/zone-entry-storage-profile-v1.ts',
  'apps/backend/src/modules/users/site-representatives.controller.ts',
  'apps/backend/src/modules/workforce/directory/contractors.controller.ts',
  'apps/backend/src/modules/workforce/directory/workforce-configuration.service.ts',
  'apps/backend/src/modules/workforce/directory/workforce.controller.ts',
  'apps/backend/src/modules/workforce/directory/contractor-operations.service.ts',
  'apps/backend/src/modules/workforce/directory/contractor-operations.controller.ts',
  'apps/backend/src/modules/workforce/directory/contractor-worker-accounts.controller.ts',
  'apps/backend/src/modules/workforce/directory/contractor-worker-accounts.service.ts',
  'apps/backend/src/modules/workforce/documents/worker-documents.controller.ts',
  'apps/backend/src/modules/workforce/documents/worker-documents.service.ts',
  'apps/backend/src/modules/workforce/directory/worker-assignment.controller.ts',
  'apps/backend/src/modules/workforce/shared/access-audit.ts',
  'apps/backend/src/modules/workforce/access/site-access-setup.controller.ts',
  'apps/backend/src/modules/workforce/access/site-access-setup.service.ts',
  'apps/backend/src/modules/workforce/teams/contractor-teams.controller.ts',
  'apps/backend/src/modules/workforce/teams/contractor-teams.service.ts',
  'apps/backend/src/modules/workforce/teams/dto/contractor-team.dto.ts',
  'apps/backend/src/modules/zones/zone-access-management.service.ts',
  'apps/backend/src/modules/zones/zone-access.controller.ts',
]) {
  test(`runtime refuses release missing authority dependency ${path}`, async () => {
    const release = await syntheticRelease(path);
    const db = idleDatabase();
    const runtime = new Mf06AssessmentWorkerRuntime(db.db, release.config);
    try {
      await assert.rejects(runtime.onModuleInit());
      assert.equal(db.count(), 0);
    } finally {
      await runtime.onModuleDestroy();
    }
  });
}
function idleDatabase(beforeClaim: () => Promise<void> = async () => {}) {
  let count = 0,
    active = 0,
    maxActive = 0;
  const db = {
    driver: { schema: 'synthetic_runtime_only' },
    transaction: async (level: string, work: (manager: EntityManager) => Promise<unknown>) => {
      assert.equal(level, 'READ COMMITTED');
      count++;
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await beforeClaim();
        return await work({ query: async () => [] } as unknown as EntityManager);
      } finally {
        active--;
      }
    },
  } as unknown as DataSource;
  return { db, count: () => count, active: () => active, maxActive: () => maxActive };
}

test(
  'synthetically pinned runtime never overlaps an unfinished claim and stops future ticks',
  { timeout: 10000 },
  async () => {
    const release = await syntheticRelease();
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const db = idleDatabase(() => blocked);
    const runtime = new Mf06AssessmentWorkerRuntime(db.db, release.config);
    try {
      await runtime.onModuleInit();
      await waitFor(() => db.count() === 1);
      await sleep(1150);
      assert.equal(db.count(), 1);
      assert.equal(db.maxActive(), 1);
      unblock();
      await waitFor(() => db.active() === 0);
    } finally {
      unblock();
      await runtime.onModuleDestroy();
    }
    const stopped = db.count();
    await sleep(1100);
    assert.equal(db.count(), stopped);
  },
);

test(
  'runtime rechecks pinned release before dequeue, pauses on tamper and resumes after restoration',
  { timeout: 10000 },
  async () => {
    const release = await syntheticRelease();
    const db = idleDatabase();
    const runtime = new Mf06AssessmentWorkerRuntime(db.db, release.config);
    try {
      await runtime.onModuleInit();
      await waitFor(() => db.count() >= 1 && db.active() === 0);
      await release.corrupt();
      const before = db.count();
      await sleep(1300);
      assert.equal(db.count(), before);
      await release.restore();
      await waitFor(() => db.count() > before);
    } finally {
      await runtime.onModuleDestroy();
    }
  },
);
