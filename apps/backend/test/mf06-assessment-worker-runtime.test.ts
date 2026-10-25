import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { dirname, isAbsolute, join, resolve } from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DataSource, type EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import { validateEnvironment } from '../src/config/environment.js';
import { SafetyModule } from '../src/modules/safety/safety.module.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
} from '../src/modules/zones/main-authority-cutover-release.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';
import {
  Mf06AssessmentWorkerRuntime,
  UnavailableMf06FacePreparation,
} from '../src/modules/safety/assessments/mf06-assessment-worker-runtime.service.js';

const here = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(here, '../src');
const D_RUNS_ROOT = 'D:/Ky9-FPT/SmartSiteData/runs';
const FIXTURE_RUNS_ROOT = process.platform === 'win32' ? D_RUNS_ROOT : tmpdir();

const SAMPLE_CLAIM: Mf06JobClaim = Object.freeze({
  requestId: '11111111-1111-4111-8111-111111111111',
  leaseToken: '22222222-2222-4222-8222-222222222222',
  headRevision: 2,
  attemptCount: 1,
  leaseExpiresAt: '2026-10-21T12:05:00.000Z',
  deadlineAt: '2026-10-21T12:15:00.000Z',
});

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createConfigStub(
  values: Partial<Record<keyof BackendEnvironment, unknown>>,
): ConfigService<BackendEnvironment, true> {
  return {
    get(key: keyof BackendEnvironment) {
      return values[key];
    },
  } as unknown as ConfigService<BackendEnvironment, true>;
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const realSetTimeout = globalThis.setTimeout;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for: ${description}`);
}

async function withControlledTimers<T>(
  options: {
    fastForwardOneSecondTickToMs?: number;
    fireStartupVerifyTimeoutImmediately?: boolean;
  },
  run: (recordedDelays: number[]) => Promise<T>,
): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  const recordedDelays: number[] = [];
  const realAbortTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (delay) => {
    recordedDelays.push(delay);
    return options.fireStartupVerifyTimeoutImmediately
      ? AbortSignal.abort(new DOMException('Verification timed out', 'TimeoutError'))
      : realAbortTimeout(delay);
  };

  globalThis.setTimeout = ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const numericDelay = typeof delay === 'number' ? delay : 0;
    recordedDelays.push(numericDelay);
    if (options.fireStartupVerifyTimeoutImmediately && numericDelay === 10_000) {
      return realSetTimeout(callback, 0, ...args);
    }
    if (options.fastForwardOneSecondTickToMs !== undefined && numericDelay === 1_000) {
      return realSetTimeout(callback, options.fastForwardOneSecondTickToMs, ...args);
    }
    return realSetTimeout(callback, delay, ...args);
  }) as typeof setTimeout;

  try {
    return await run(recordedDelays);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    AbortSignal.timeout = realAbortTimeout;
  }
}

function createIdleDbStub(
  options: {
    onClaimTransaction?: () => Promise<void>;
  } = {},
) {
  let claimTransactions = 0;
  let inFlightClaimTransactions = 0;
  let maxConcurrentClaimTransactions = 0;

  const db = {
    driver: { schema: 'public' },
    async transaction(
      isolation: string,
      runInTransaction: (manager: EntityManager) => Promise<unknown>,
    ) {
      if (isolation === 'READ COMMITTED') {
        claimTransactions += 1;
        inFlightClaimTransactions += 1;
        maxConcurrentClaimTransactions = Math.max(
          maxConcurrentClaimTransactions,
          inFlightClaimTransactions,
        );
        try {
          if (options.onClaimTransaction) {
            await options.onClaimTransaction();
          }
          const manager = {
            async query() {
              return [];
            },
          } as unknown as EntityManager;
          return await runInTransaction(manager);
        } finally {
          inFlightClaimTransactions -= 1;
        }
      }
      throw new Error(`Unexpected transaction isolation in idle stub: ${isolation}`);
    },
  } as unknown as DataSource;

  return {
    db,
    getClaimTransactions: () => claimTransactions,
    getMaxConcurrentClaimTransactions: () => maxConcurrentClaimTransactions,
  };
}

async function createRetainedSyntheticCutoverFixture() {
  await mkdir(FIXTURE_RUNS_ROOT, { recursive: true });
  const rootDir = await mkdtemp(join(FIXTURE_RUNS_ROOT, 'mf06-worker-runtime-synthetic-'));
  assert.equal(isAbsolute(rootDir), true, 'Fixture root must be a native absolute path');
  if (process.platform === 'win32') {
    assert.match(rootDir, /^[dD]:[\\/]/, 'Fixture root must be retained on D: drive');
  }

  const releaseRoot = join(rootDir, 'release');
  const evidenceRoot = join(rootDir, 'evidence');
  await mkdir(evidenceRoot, { recursive: true });

  const files: Array<{ path: string; sha256: string }> = [];
  for (const relativePath of MAIN_AUTHORITY_CUTOVER_RELEASE_FILES) {
    const targetPath = resolve(releaseRoot, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    const bytes = Buffer.from(`// synthetic release pin: ${relativePath}\n`, 'utf8');
    await writeFile(targetPath, bytes, { flag: 'wx' });
    files.push({ path: relativePath, sha256: sha256(bytes) });
  }

  const runtimeFiles = await Promise.all(
    MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES.map(async (relativePath) => ({
      path: relativePath,
      sha256: sha256(await readFile(resolve(runtimeRoot, relativePath))),
    })),
  );

  const authSourceSha = files.find(
    (entry) => entry.path === 'apps/backend/src/modules/auth/auth.service.ts',
  )?.sha256;
  if (!authSourceSha) {
    throw new Error('Missing synthetic auth.service.ts pin');
  }

  const releaseCommit = 'b'.repeat(40);
  const validManifestBytes = Buffer.from(
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
            fileSha256: authSourceSha,
            methodBodySha256: 'd'.repeat(64),
            classification: 'MASKED_COMMAND',
          },
        ],
      },
    }),
    'utf8',
  );

  const manifestPath = join(rootDir, 'SYNTHETIC-NOT-OPERATIONAL-manifest.json');
  await writeFile(manifestPath, validManifestBytes, { flag: 'wx' });
  const reviewedManifestSha256 = sha256(validManifestBytes);

  return {
    env: Object.freeze({
      NODE_ENV: 'test' as const,
      MF06_WORKER_ENABLED: true,
      MF06_CUTOVER_MANIFEST_PATH: manifestPath,
      MF06_CUTOVER_MANIFEST_SHA256: reviewedManifestSha256,
      MF06_CUTOVER_RELEASE_ROOT: releaseRoot,
      MF06_CUTOVER_RELEASE_COMMIT: releaseCommit,
      SMARTSITE_AI_SERVICE_TOKEN: 'smartsite_local_dev_service_token_only',
    }),
    evidenceRoot,
    corruptManifest: () => writeFile(manifestPath, '{"corrupted":true}', 'utf8'),
    restoreManifest: () => writeFile(manifestPath, validManifestBytes),
  };
}

describe('Mf06AssessmentWorkerRuntime unit tests', () => {
  let fixture!: Awaited<ReturnType<typeof createRetainedSyntheticCutoverFixture>>;

  before(async () => {
    fixture = await createRetainedSyntheticCutoverFixture();
  });

  describe('1. disabled by default', () => {
    it('is registered by SafetyModule and resolves through real Nest DI without worker I/O when disabled', async () => {
      const providers = Reflect.getMetadata('providers', SafetyModule) as unknown[];
      assert(providers.includes(Mf06AssessmentWorkerRuntime));
      const { db, getClaimTransactions } = createIdleDbStub();
      @Module({
        providers: [
          Mf06AssessmentWorkerRuntime,
          { provide: DataSource, useValue: db },
          {
            provide: ConfigService,
            useValue: new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
          },
        ],
      })
      class RuntimeFixtureModule {}
      const app = await NestFactory.createApplicationContext(RuntimeFixtureModule, {
        logger: false,
        abortOnError: false,
      });
      try {
        assert(app.get(Mf06AssessmentWorkerRuntime) instanceof Mf06AssessmentWorkerRuntime);
        assert.equal(getClaimTransactions(), 0);
      } finally {
        await app.close();
      }
      assert.equal(getClaimTransactions(), 0);
    });
    it('creates no timer, performs no release verification or dequeue I/O, and shuts down cleanly', async () => {
      const { db, getClaimTransactions } = createIdleDbStub();
      await withControlledTimers({}, async (recordedDelays) => {
        const runtime = new Mf06AssessmentWorkerRuntime(
          db,
          createConfigStub({
            NODE_ENV: 'development',
            MF06_WORKER_ENABLED: false,
            SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
          }),
        );

        await runtime.onModuleInit();
        assert.deepEqual(recordedDelays, []);
        assert.equal(getClaimTransactions(), 0);

        await runtime.onModuleDestroy();
        assert.equal(getClaimTransactions(), 0);
      });
    });
  });

  describe('2. startup validation, genuine cutover manifest verification, and abortable/bounded onModuleInit', () => {
    it('rejects missing cutover release fields or partial identity configuration before dequeue', async () => {
      const { db, getClaimTransactions } = createIdleDbStub();

      for (const missingReleasePatch of [
        { MF06_CUTOVER_MANIFEST_PATH: undefined },
        { MF06_CUTOVER_MANIFEST_SHA256: undefined },
        { MF06_CUTOVER_RELEASE_ROOT: undefined },
        { MF06_CUTOVER_RELEASE_COMMIT: undefined },
      ]) {
        const runtime = new Mf06AssessmentWorkerRuntime(
          db,
          createConfigStub({ ...fixture.env, ...missingReleasePatch }),
        );
        await assert.rejects(() => runtime.onModuleInit(), /MF06_CUTOVER_RELEASE_CONFIG_REQUIRED/);
      }

      for (const partialIdentityPatch of [
        { SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000' },
        {
          SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
          EVIDENCE_LOCAL_ROOT: fixture.evidenceRoot,
        },
        {
          MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
          EVIDENCE_LOCAL_ROOT: fixture.evidenceRoot,
        },
      ]) {
        const runtime = new Mf06AssessmentWorkerRuntime(
          db,
          createConfigStub({ ...fixture.env, ...partialIdentityPatch }),
        );
        await assert.rejects(() => runtime.onModuleInit(), /MF06_PARTIAL_IDENTITY_CONFIG/);
      }

      assert.equal(getClaimTransactions(), 0);
    });

    it('rejects startup via actual verifyMainAuthorityCutoverRelease when manifest is missing, tampered, or non-test provenance fails', async () => {
      const { db, getClaimTransactions } = createIdleDbStub();

      const missingManifestRuntime = new Mf06AssessmentWorkerRuntime(
        db,
        createConfigStub({
          ...fixture.env,
          MF06_CUTOVER_MANIFEST_PATH: path.resolve(fixture.evidenceRoot, 'missing.json'),
        }),
      );
      await assert.rejects(() => missingManifestRuntime.onModuleInit());

      const wrongDigestRuntime = new Mf06AssessmentWorkerRuntime(
        db,
        createConfigStub({
          ...fixture.env,
          MF06_CUTOVER_MANIFEST_SHA256: 'f'.repeat(64),
        }),
      );
      await assert.rejects(() => wrongDigestRuntime.onModuleInit(), /Cutover review pin mismatch/);

      const syntheticInProdRuntime = new Mf06AssessmentWorkerRuntime(
        db,
        createConfigStub({
          ...fixture.env,
          NODE_ENV: 'production',
        }),
      );
      await assert.rejects(
        () => syntheticInProdRuntime.onModuleInit(),
        /Synthetic cutover release is test-only/,
      );

      assert.equal(getClaimTransactions(), 0);
    });

    it('bounds and aborts onModuleInit release verification when destroyed or when verification times out', async () => {
      const { db, getClaimTransactions } = createIdleDbStub();

      const abortedRuntime = new Mf06AssessmentWorkerRuntime(db, createConfigStub(fixture.env));
      const pendingInit = abortedRuntime.onModuleInit();
      await abortedRuntime.onModuleDestroy();
      await assert.rejects(() => pendingInit, /MF06_RUNTIME_ABORTED/);
      assert.equal(getClaimTransactions(), 0);

      await withControlledTimers(
        { fireStartupVerifyTimeoutImmediately: true },
        async (recordedDelays) => {
          const timedOutRuntime = new Mf06AssessmentWorkerRuntime(
            db,
            createConfigStub(fixture.env),
          );
          await assert.rejects(() => timedOutRuntime.onModuleInit(), { name: 'TimeoutError' });
          assert.ok(recordedDelays.includes(10_000));
          assert.equal(getClaimTransactions(), 0);
        },
      );
    });
  });

  describe('3. sequential timer without overlap', () => {
    it('never overlaps ticks while a claim/runOnce execution is still in flight and schedules 1000ms idle interval', async () => {
      let releaseFirstClaim!: () => void;
      const firstClaimGate = new Promise<void>((resolve) => {
        releaseFirstClaim = resolve;
      });
      let firstClaimEntered = false;

      let callIndex = 0;
      const { db, getClaimTransactions, getMaxConcurrentClaimTransactions } = createIdleDbStub({
        onClaimTransaction: async () => {
          callIndex += 1;
          if (callIndex === 1) {
            firstClaimEntered = true;
            await firstClaimGate;
          }
        },
      });

      await withControlledTimers({ fastForwardOneSecondTickToMs: 25 }, async (recordedDelays) => {
        const runtime = new Mf06AssessmentWorkerRuntime(db, createConfigStub(fixture.env));
        await runtime.onModuleInit();
        await waitFor(() => firstClaimEntered, 'first claim transaction entered');

        // Even while first claim is held open across ticks, no second tick is scheduled or started
        assert.equal(
          getClaimTransactions(),
          1,
          'No second tick may start before the first tick finishes',
        );
        assert.equal(getMaxConcurrentClaimTransactions(), 1);
        assert.equal(
          recordedDelays.filter((delay) => delay === 1_000).length,
          0,
          'Idle timer is not scheduled until the active tick finishes',
        );

        releaseFirstClaim();
        await waitFor(
          () => getClaimTransactions() >= 2,
          'subsequent tick runs after first tick completes',
        );
        await runtime.onModuleDestroy();

        assert.ok(recordedDelays.includes(1_000), 'Idle verification loop uses 1000ms interval');
        assert.equal(getMaxConcurrentClaimTransactions(), 1);
      });
    });
  });

  describe('4. pre-dequeue release re-verification and safe pause/retry via on-disk manifest', () => {
    it('reverifies trusted release before each dequeue, pauses with 1000ms retry when manifest is corrupted on disk, and resumes when restored', async () => {
      let shouldFailClaim = false;
      const { db, getClaimTransactions } = createIdleDbStub({
        onClaimTransaction: async () => {
          if (shouldFailClaim) {
            throw new Error('transient connection reset');
          }
        },
      });

      let invalidationWarnings = 0;
      let executionErrors = 0;
      const originalWarn = Logger.prototype.warn;
      const originalError = Logger.prototype.error;
      Logger.prototype.warn = function (message: unknown) {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { reason?: string }).reason === 'CUTOVER_RELEASE_INVALIDATED'
        ) {
          invalidationWarnings += 1;
        }
      };
      Logger.prototype.error = function (message: unknown) {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { reason?: string }).reason === 'WORKER_EXECUTION_FAILED'
        ) {
          executionErrors += 1;
        }
      };

      await fixture.restoreManifest();
      await withControlledTimers({ fastForwardOneSecondTickToMs: 25 }, async (recordedDelays) => {
        const runtime = new Mf06AssessmentWorkerRuntime(db, createConfigStub(fixture.env));

        try {
          await runtime.onModuleInit();
          await waitFor(() => getClaimTransactions() >= 1, 'initial claim completed');

          await fixture.corruptManifest();
          const claimsAtCorrupt = getClaimTransactions();
          await waitFor(
            () => invalidationWarnings >= 1,
            'cutover release invalidation pause observed',
          );
          assert.equal(
            getClaimTransactions(),
            claimsAtCorrupt,
            'Must not claim/dequeue any job while on-disk cutover manifest fails verification',
          );
          assert.ok(recordedDelays.includes(1_000), 'Pause retry uses 1000ms interval');

          await fixture.restoreManifest();
          await waitFor(
            () => getClaimTransactions() > claimsAtCorrupt,
            'dequeue resumes after on-disk cutover manifest is restored',
          );

          shouldFailClaim = true;
          await waitFor(
            () => executionErrors >= 1,
            'transient worker execution failure pause observed',
          );
          const claimsDuringFailure = getClaimTransactions();

          shouldFailClaim = false;
          await waitFor(
            () => getClaimTransactions() > claimsDuringFailure,
            'dequeue recovers after transient worker execution failure clears',
          );
        } finally {
          Logger.prototype.warn = originalWarn;
          Logger.prototype.error = originalError;
          await fixture.restoreManifest();
          await runtime.onModuleDestroy();
        }
      });
    });
  });

  describe('5. onModuleDestroy drain while DB exists', () => {
    it('stops timer, aborts active work, and awaits worker.drain lease cancellation while DB is alive', async () => {
      let dbDestroyed = false;
      let activeLeaseToken: string | null = null;
      let cancelExecutedWhileDbAlive = false;
      let enteredPrepare = false;

      const db = {
        driver: { schema: 'public' },
        async transaction(
          isolation: string,
          runInTransaction: (manager: EntityManager) => Promise<unknown>,
        ) {
          assert.equal(dbDestroyed, false, 'Worker DB operations must complete before DB teardown');
          if (isolation === 'READ COMMITTED') {
            const manager = {
              async query(sql: string, params?: unknown[]) {
                if (sql.trim() === 'SELECT clock_timestamp() AS now') {
                  return [{ now: new Date() }];
                }
                if (sql.includes('FOR UPDATE SKIP LOCKED') && sql.includes('attempt_count < $1')) {
                  if (activeLeaseToken !== null) return [];
                  return [
                    {
                      request_id: SAMPLE_CLAIM.requestId,
                      status: 'PENDING',
                      attempt_count: 0,
                      head_revision: 1,
                      lease_token: null,
                      lease_expires_at: null,
                      deadline_at: new Date(Date.now() + 600_000),
                      next_attempt_at: new Date(Date.now() - 1_000),
                    },
                  ];
                }
                if (sql.includes("SET status='CLAIMED'")) {
                  activeLeaseToken = String(params?.[1] ?? '');
                  return [{ request_id: SAMPLE_CLAIM.requestId }];
                }
                if (sql.includes('WHERE request_id=$1 FOR UPDATE')) {
                  return [
                    {
                      request_id: SAMPLE_CLAIM.requestId,
                      status: 'CLAIMED',
                      attempt_count: 1,
                      head_revision: 2,
                      lease_token: activeLeaseToken,
                      lease_expires_at: new Date(Date.now() + 300_000),
                      deadline_at: new Date(Date.now() + 600_000),
                      next_attempt_at: new Date(Date.now() - 1_000),
                    },
                  ];
                }
                if (sql.includes('WITH stamp AS')) {
                  cancelExecutedWhileDbAlive = !dbDestroyed && params?.[2] === 'ABORTED';
                  return [{ request_id: SAMPLE_CLAIM.requestId, status: 'CANCELLED' }];
                }
                return [];
              },
            } as unknown as EntityManager;
            return runInTransaction(manager);
          }

          if (isolation === 'REPEATABLE READ') {
            const manager = {
              async query(sql: string) {
                if (sql.includes('SET TRANSACTION READ ONLY')) {
                  enteredPrepare = true;
                  await new Promise((resolve) => setTimeout(resolve, 35));
                }
                return [];
              },
            } as unknown as EntityManager;
            return runInTransaction(manager);
          }

          throw new Error(`Unexpected isolation level: ${isolation}`);
        },
      } as unknown as DataSource;

      const runtime = new Mf06AssessmentWorkerRuntime(db, createConfigStub(fixture.env));
      await runtime.onModuleInit();
      await waitFor(() => enteredPrepare, 'WorkPort.prepare entered');

      await runtime.onModuleDestroy();
      dbDestroyed = true;

      assert.equal(
        cancelExecutedWhileDbAlive,
        true,
        'Active lease must be cancelled during onModuleDestroy while DB connection still exists',
      );
    });
  });

  describe('6. configured HTTP Face path and honest unavailable Face branch', () => {
    it('UnavailableMf06FacePreparation returns IDENTITY_UNAVAILABLE and throws on aborted signal', async () => {
      const unavailable = new UnavailableMf06FacePreparation();
      const activeSignal = new AbortController().signal;
      assert.deepEqual(await unavailable.prepare(SAMPLE_CLAIM, activeSignal), {
        state: 'UNAVAILABLE',
        reason: 'IDENTITY_UNAVAILABLE',
      });

      const abortedController = new AbortController();
      abortedController.abort(new Error('SHUTDOWN_ABORT'));
      await assert.rejects(
        () => unavailable.prepare(SAMPLE_CLAIM, abortedController.signal),
        /SHUTDOWN_ABORT/,
      );
    });

    it('wires real HttpSafetyIdentityResolver and Mf06FacePreparation when all 4 identity fields are configured and rejects invalid resolver/preparation inputs', async () => {
      const { db, getClaimTransactions } = createIdleDbStub();

      const validHttpRuntime = new Mf06AssessmentWorkerRuntime(
        db,
        createConfigStub({
          ...fixture.env,
          SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
          SMARTSITE_AI_SERVICE_TOKEN: 'smartsite_local_dev_service_token_only',
          EVIDENCE_LOCAL_ROOT: fixture.evidenceRoot,
          MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
        }),
      );
      await validHttpRuntime.onModuleInit();
      await waitFor(() => getClaimTransactions() >= 1, 'HTTP-configured runtime executes tick');
      await validHttpRuntime.onModuleDestroy();

      assert.throws(
        () =>
          validateEnvironment({
            MF06_WORKER_ENABLED: 'true',
            MF06_CUTOVER_MANIFEST_PATH: fixture.env.MF06_CUTOVER_MANIFEST_PATH,
            MF06_CUTOVER_MANIFEST_SHA256: fixture.env.MF06_CUTOVER_MANIFEST_SHA256,
            MF06_CUTOVER_RELEASE_ROOT: fixture.env.MF06_CUTOVER_RELEASE_ROOT,
            MF06_CUTOVER_RELEASE_COMMIT: fixture.env.MF06_CUTOVER_RELEASE_COMMIT,
            SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000?bad=query',
            SMARTSITE_AI_SERVICE_TOKEN: 'smartsite_local_dev_service_token_only',
            EVIDENCE_LOCAL_ROOT: fixture.evidenceRoot,
            MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
          }),
        /SMARTSITE_AI_IDENTITY_URL/,
      );

      assert.throws(
        () =>
          validateEnvironment({
            MF06_WORKER_ENABLED: 'true',
            MF06_CUTOVER_MANIFEST_PATH: fixture.env.MF06_CUTOVER_MANIFEST_PATH,
            MF06_CUTOVER_MANIFEST_SHA256: fixture.env.MF06_CUTOVER_MANIFEST_SHA256,
            MF06_CUTOVER_RELEASE_ROOT: fixture.env.MF06_CUTOVER_RELEASE_ROOT,
            MF06_CUTOVER_RELEASE_COMMIT: fixture.env.MF06_CUTOVER_RELEASE_COMMIT,
            SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000',
            SMARTSITE_AI_SERVICE_TOKEN: 'short-token',
            EVIDENCE_LOCAL_ROOT: fixture.evidenceRoot,
            MF06_FACE_MODEL_VERSION: 'arcface-r100-v1',
          }),
        /SMARTSITE_AI_SERVICE_TOKEN/,
      );
    });
  });
});
