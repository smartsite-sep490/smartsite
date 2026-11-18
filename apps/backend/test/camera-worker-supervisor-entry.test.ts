import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { mkdtemp, writeFile, readdir, unlink, rmdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseSupervisorConfiguration,
  runOperatorSupervisor,
} from '../src/scripts/run-camera-worker-supervisor.js';

const camera = '11111111-1111-4111-8111-111111111111';
const root = path.resolve(process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : '/tmp');
function fixture() {
  return {
    cameraId: camera,
    allowedCameraIds: [camera],
    credentialDirectory: path.join(root, 'private-credentials'),
    outboxPath: path.join(root, 'retained.sqlite3'),
    databaseIdentity: '127.0.0.1:5433/smartsite_test/isolated_supervisor',
    leaseMs: 60000,
    maximumStarts: 2,
    worker: {
      pythonExecutable: path.join(root, 'python.exe'),
      manifestFile: path.join(root, 'reviewed.json'),
      workingDirectory: root,
    },
  };
}

test('operator entry accepts explicit test-only paths and bounded restart configuration', () => {
  const parsed = parseSupervisorConfiguration(fixture());
  assert.equal(parsed.cameraId, camera);
  assert.equal(parsed.maximumStarts, 2);
  assert.equal(parsed.worker.manifestFile, fixture().worker.manifestFile);
});

test('operator entry refuses unknown options, inline secrets and shell fragments', () => {
  for (const input of [
    { ...fixture(), databaseUrl: 'postgresql://secret' },
    {
      ...fixture(),
      worker: { ...fixture().worker, workerEnvironment: { DATABASE_URL: 'secret' } },
    },
    { ...fixture(), worker: { ...fixture().worker, args: ['--unsafe'] } },
  ])
    assert.throws(() => parseSupervisorConfiguration(input));
});

test('operator entry refuses website/cloud identity and non-private test schemas', () => {
  for (const databaseIdentity of [
    '127.0.0.1:5434/smartsite/public',
    'cloud.example:5432/smartsite/private',
    '127.0.0.1:5433/smartsite_test/public',
    '127.0.0.1:5433/smartsite_test/pg_catalog',
  ])
    assert.throws(() => parseSupervisorConfiguration({ ...fixture(), databaseIdentity }));
});

test('operator entry refuses relative paths, malformed camera scope and unbounded restarts', () => {
  for (const patch of [
    { credentialDirectory: './credentials' },
    { outboxPath: './retained.sqlite3' },
    { allowedCameraIds: [] },
    { allowedCameraIds: ['22222222-2222-4222-8222-222222222222'] },
    { maximumStarts: 4 },
    { leaseMs: 0 },
    { initialExpectedGenerationId: 'invalid' },
    { worker: { ...fixture().worker, manifestFile: './manifest.json' } },
  ])
    assert.throws(() => parseSupervisorConfiguration({ ...fixture(), ...patch }));
});

test('cancelled explicit composition validates files but issues no credential and launches no child', async () => {
  const folder = await mkdtemp(path.join(root, 'supervisor-entry-'));
  const configFile = path.join(folder, 'operator.json');
  const manifestFile = path.join(folder, 'manifest.json');
  try {
    await writeFile(manifestFile, '{}');
    const config = fixture();
    config.credentialDirectory = folder;
    config.worker = {
      pythonExecutable: process.execPath,
      manifestFile,
      workingDirectory: folder,
    };
    await writeFile(configFile, JSON.stringify(config));
    const result = await runOperatorSupervisor(
      ['--config', configFile],
      { PATH: process.env.PATH, DATABASE_URL: 'must-not-be-used' },
      AbortSignal.abort(),
    );
    assert.deepEqual(result, { status: 'CANCELLED', starts: 0, exits: [] });
    assert.deepEqual((await readdir(folder)).sort(), ['manifest.json', 'operator.json']);
  } finally {
    await unlink(configFile);
    await unlink(manifestFile);
    await rmdir(folder);
  }
});

test('entry rejects implicit configuration and oversized files before invoking any issuer', async () => {
  await assert.rejects(runOperatorSupervisor([], {}, AbortSignal.abort()));
  const folder = await mkdtemp(path.join(root, 'supervisor-entry-size-'));
  const file = path.join(folder, 'oversized.json');
  try {
    await writeFile(file, ' '.repeat(65537));
    await assert.rejects(runOperatorSupervisor(['--config', file], {}, AbortSignal.abort()), {
      message: 'Supervisor configuration exceeds size limit',
    });
  } finally {
    await unlink(file);
    await rmdir(folder);
  }
});

test('actual CLI refuses invalid configuration without printing inline secret bytes', async () => {
  const folder = await mkdtemp(path.join(root, 'supervisor-entry-cli-'));
  const file = path.join(folder, 'invalid.json');
  const secret = 'synthetic-secret-that-must-never-appear';
  try {
    await writeFile(file, JSON.stringify({ ...fixture(), databaseUrl: secret }));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../src/scripts/run-camera-worker-supervisor.js', import.meta.url)),
        '--config',
        file,
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        env: { NODE_ENV: 'test', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Supervisor stopped; operator reconciliation may be required.\n');
    assert.ok(!(result.stderr + result.stdout).includes(secret));
    assert.deepEqual(await readdir(folder), ['invalid.json']);
  } finally {
    await unlink(file);
    await rmdir(folder);
  }
});
