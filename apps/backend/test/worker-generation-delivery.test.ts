import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { provisionCameraWorker } from '../src/scripts/provision-camera-worker.js';
import {
  deliverWorkerGeneration,
  parseWorkerGenerationArguments,
} from '../src/scripts/worker-generation-delivery.js';

const fixtureRoot = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : tmpdir();

const cameraId = '11111111-1111-4111-8111-111111111111';
const credential = {
  workerGenerationId: '22222222-2222-4222-8222-222222222222',
  streamSessionId: '33333333-3333-4333-8333-333333333333',
  secret: 'x'.repeat(43),
  expiresAt: '2026-10-27T05:00:00.000Z',
};

test('operator arguments reject unknown, duplicate and implicit target options', () => {
  const args = [
    '--camera-id',
    cameraId,
    '--lease-ms',
    '60000',
    '--output',
    path.resolve('credential.json'),
    '--database-identity',
    'localhost:5433/test/owned',
  ];
  assert.equal(parseWorkerGenerationArguments(args).leaseMs, 60000);
  for (const invalid of [
    args.slice(0, -2),
    [...args, '--unknown', 'value'],
    [...args, '--lease-ms', '60000'],
    args.map((v) => (v === '60000' ? '1e4' : v)),
  ]) {
    assert.throws(() => parseWorkerGenerationArguments(invalid));
  }
});

test('exclusive credential delivery flushes before issuer commit and refuses overwrite', async () => {
  const dir = await mkdtemp(path.join(fixtureRoot, 'worker-generation-delivery-test-'));
  const output = path.join(dir, 'credential.json').replaceAll('\\', '/');
  await deliverWorkerGeneration(output, cameraId, async (deliver) => {
    await deliver(credential);
    const stored = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(stored, { schemaVersion: '1.0.0', cameraId, ...credential });
  });
  let invoked = false;
  await assert.rejects(
    deliverWorkerGeneration(output, cameraId, async () => {
      invoked = true;
    }),
  );
  assert.equal(invoked, false);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).secret, credential.secret);
});

test('issuer failure propagates without overwriting or deleting its recovery artifact', async () => {
  const dir = await mkdtemp(path.join(fixtureRoot, 'worker-generation-delivery-test-'));
  const output = path.join(dir, 'credential.json');
  await assert.rejects(
    deliverWorkerGeneration(output, cameraId, async (deliver) => {
      await deliver(credential);
      throw new Error('synthetic transaction commit failure');
    }),
  );
  assert.equal(
    JSON.parse(await readFile(output, 'utf8')).workerGenerationId,
    credential.workerGenerationId,
  );
});

test('operator refuses target mismatch and missing allowlist before creating a credential file', async () => {
  const args = [
    '--camera-id',
    cameraId,
    '--lease-ms',
    '60000',
    '--output',
    path.join(fixtureRoot, 'never-created-operator-credential.json'),
    '--database-identity',
    'localhost:5433/test/owned',
  ];
  const env = {
    DATABASE_URL: 'postgres://synthetic:synthetic@localhost:5433/test',
    DATABASE_SCHEMA: 'owned',
  };
  await assert.rejects(provisionCameraWorker(args, env), /outside the operator allowlist/);
  await assert.rejects(
    provisionCameraWorker(args, {
      ...env,
      DATABASE_SCHEMA: 'other',
      AI_CONFIGURATION_CAMERA_IDS: cameraId,
    }),
    /Database identity mismatch/,
  );
});

test('actual command entry point reports a generic failure without printing credentials', () => {
  const sentinel = 'synthetic-private-marker';
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../src/scripts/provision-camera-worker.js', import.meta.url)),
      '--camera-id',
      cameraId,
      '--lease-ms',
      '60000',
      '--output',
      path.join(fixtureRoot, 'never-created-operator-credential.json'),
      '--database-identity',
      'localhost:5433/wrong/owned',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DIRECT_URL: '',
        DATABASE_URL_UNPOOLED: '',
        DATABASE_URL: `postgres://operator:${sentinel}@localhost:5433/test`,
        DATABASE_SCHEMA: 'owned',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Worker provisioning failed;/);
  assert(!result.stderr.includes(sentinel));
  assert(!result.stderr.includes('postgres://'));
});

test('operator rejects unsafe schema and connection search_path override before opening output', async () => {
  const args = [
    '--camera-id',
    cameraId,
    '--lease-ms',
    '60000',
    '--output',
    path.join(fixtureRoot, 'never-created-operator-credential.json'),
    '--database-identity',
    'localhost:5433/test/owned',
  ];
  const env = {
    DATABASE_URL: 'postgres://synthetic:synthetic@localhost:5433/test',
    DATABASE_SCHEMA: 'owned',
    AI_CONFIGURATION_CAMERA_IDS: cameraId,
  };
  for (const schema of [
    'public',
    'owned,public',
    'owned;DROP SCHEMA public',
    'Owned',
    'x'.repeat(64),
  ]) {
    await assert.rejects(
      provisionCameraWorker(args, { ...env, DATABASE_SCHEMA: schema }),
      /Explicit private schema required/,
    );
  }
  await assert.rejects(
    provisionCameraWorker(args, {
      ...env,
      DATABASE_URL: env.DATABASE_URL + '?options=-c%20search_path%3Dpublic',
    }),
    /Connection options override/,
  );
});
