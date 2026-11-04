import 'reflect-metadata';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment, EnvironmentValidationError } from '../src/config/environment.js';

const release = {
  MF06_WORKER_ENABLED: 'true',
  MF06_CUTOVER_MANIFEST_PATH: resolve('runtime-unissued', 'manifest.json'),
  MF06_CUTOVER_MANIFEST_SHA256: 'a'.repeat(64),
  MF06_CUTOVER_RELEASE_ROOT: resolve('runtime-unissued', 'release'),
  MF06_CUTOVER_RELEASE_COMMIT: 'b'.repeat(40),
};
const runtimeModule = () =>
  import(
    new URL(
      '../src/modules/safety/assessments/mf06-assessment-worker-runtime.service.js',
      import.meta.url,
    ).href
  );

test('worker is independently OFF by default and rejects ambiguous flags', () => {
  const config = validateEnvironment({ NODE_ENV: 'test' }) as Record<string, unknown>;
  assert.equal(config.MF06_WORKER_ENABLED, false);
  assert.equal(config.MF06_ENQUEUE_ENABLED, false);
  assert.equal(config.MF06_ASSESSMENT_READ_ENABLED, false);
  for (const value of ['TRUE', '1', 'yes', '', ' true '])
    assert.throws(
      () => validateEnvironment({ MF06_WORKER_ENABLED: value }),
      EnvironmentValidationError,
    );
});

test('enabled worker requires every reviewed release pin and complete optional Face configuration', () => {
  assert.throws(
    () => validateEnvironment({ MF06_WORKER_ENABLED: 'true' }),
    EnvironmentValidationError,
  );
  for (const field of [
    'MF06_CUTOVER_MANIFEST_PATH',
    'MF06_CUTOVER_MANIFEST_SHA256',
    'MF06_CUTOVER_RELEASE_ROOT',
    'MF06_CUTOVER_RELEASE_COMMIT',
  ]) {
    const input: Record<string, string> = { ...release };
    delete input[field];
    assert.throws(() => validateEnvironment(input), EnvironmentValidationError);
  }
  const config = validateEnvironment(release) as Record<string, unknown>;
  assert.equal(config.MF06_WORKER_ENABLED, true);
  assert.equal(config.MF06_ENQUEUE_ENABLED, false);
  assert.throws(
    () =>
      validateEnvironment({
        ...release,
        SMARTSITE_AI_IDENTITY_URL: 'https://example.invalid/identity',
      }),
    EnvironmentValidationError,
  );
  assert.throws(
    () => validateEnvironment({ ...release, MF06_FACE_MODEL_VERSION: 'model-v1' }),
    EnvironmentValidationError,
  );
});

test('runtime OFF does not read database or construct external dependencies; stop is repeatable', async () => {
  const { Mf06AssessmentWorkerRuntime } = await runtimeModule();
  const db = new Proxy(
    {},
    {
      get() {
        throw Error('Disabled runtime must not touch database');
      },
    },
  );
  const runtime = new Mf06AssessmentWorkerRuntime(
    db,
    new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
  );
  await runtime.onModuleInit();
  await runtime.onModuleDestroy();
  await runtime.onModuleDestroy();
});

test('unissued release prevents enabled runtime from reaching database or scheduling work', async () => {
  const { Mf06AssessmentWorkerRuntime } = await runtimeModule();
  const db = new Proxy(
    {},
    {
      get() {
        throw Error('Unverified release must not reach database');
      },
    },
  );
  const runtime = new Mf06AssessmentWorkerRuntime(
    db,
    new ConfigService(validateEnvironment({ ...release, NODE_ENV: 'test' })),
  );
  await assert.rejects(
    runtime.onModuleInit(),
    (error) => !String(error).includes('must not reach database'),
  );
  await runtime.onModuleDestroy();
});

test('default missing-identity preparation remains unavailable and obeys cancellation', async () => {
  const { UnavailableMf06FacePreparation } = await runtimeModule();
  const preparation = new UnavailableMf06FacePreparation();
  assert.deepEqual(await preparation.prepare({}, new AbortController().signal), {
    state: 'UNAVAILABLE',
    reason: 'IDENTITY_UNAVAILABLE',
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(preparation.prepare({}, controller.signal));
});

test('enabled Face configuration rejects HTTP to match the resolver transport', () => {
  const complete = {
    ...release,
    MF06_FACE_MODEL_VERSION: 'model-v1',
    EVIDENCE_LOCAL_ROOT: resolve('runtime-unissued', 'evidence'),
  };
  assert.throws(
    () => validateEnvironment({ ...complete, SMARTSITE_AI_IDENTITY_URL: 'http://127.0.0.1:8000' }),
    EnvironmentValidationError,
  );
  assert.doesNotThrow(() =>
    validateEnvironment({
      ...complete,
      SMARTSITE_AI_IDENTITY_URL: 'https://example.invalid/identity',
    }),
  );
});

test(
  'drain timeout does not skip later Nest application shutdown hooks',
  { timeout: 1500 },
  async () => {
    const { Module } = await import('@nestjs/common');
    const { NestFactory } = await import('@nestjs/core');
    const { Mf06AssessmentWorkerRuntime } = await runtimeModule();
    const runtime = new Mf06AssessmentWorkerRuntime(
      {},
      new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
    );
    let disposed = false;
    let drainCalls = 0;
    class Cleanup {
      onApplicationShutdown() {
        disposed = true;
      }
    }
    @Module({ providers: [{ provide: Mf06AssessmentWorkerRuntime, useValue: runtime }, Cleanup] })
    class TestLifecycleModule {}
    const app = await NestFactory.createApplicationContext(TestLifecycleModule, {
      logger: false,
      abortOnError: false,
    });
    // Simulate the worker's bounded drain rejection and an unfinished database tick.
    Object.assign(runtime, {
      worker: {
        drain: async () => {
          drainCalls++;
          throw Error('MF06_DRAIN_TIMEOUT');
        },
      },
      activeTick: new Promise<void>(() => {}),
    });
    await app.close();
    assert.equal(disposed, true);
    assert.equal(drainCalls, 1);
  },
);
