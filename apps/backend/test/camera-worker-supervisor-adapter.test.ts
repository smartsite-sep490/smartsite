import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import {
  workerRuntimeCommand,
  operatorSupervisorPorts,
} from '../src/scripts/camera-worker-supervisor-adapter.js';

const cameraId = '11111111-1111-4111-8111-111111111111';
const root = path.resolve(process.env.TEMP!);
const input = {
  pythonExecutable: path.join(root, 'python.exe'),
  manifestFile: path.join(root, 'reviewed.json'),
  workingDirectory: root,
  workerEnvironment: { SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'fixture-service-token' },
};
const context = {
  cameraId,
  credentialFile: path.join(root, 'fresh.json'),
  outboxPath: path.join(root, 'retained.sqlite3'),
};

test('fixed isolated runtime command binds camera/outbox and never passes issuer env', () => {
  const command = workerRuntimeCommand(input, context, {
    PATH: 'tools',
    DATABASE_URL: 'issuer-secret',
    DIRECT_URL: 'secret',
    PYTHONPATH: 'injection',
    NODE_OPTIONS: 'injection',
  });
  assert.equal(command.executable, input.pythonExecutable);
  assert.deepEqual(command.args, [
    '-I',
    '-B',
    '-m',
    'smartsite_ai.tools.run_camera_runtime',
    '--manifest',
    input.manifestFile,
    '--generation-credential-file',
    context.credentialFile,
    '--expected-camera-id',
    cameraId,
    '--expected-outbox',
    context.outboxPath,
  ]);
  assert.equal(command.options.shell, false);
  assert.equal(command.options.windowsHide, true);
  assert.equal(command.options.env?.DATABASE_URL, undefined);
  assert.equal(command.options.env?.PYTHONPATH, undefined);
  assert.equal(command.options.env?.SMARTSITE_AI_BACKEND_SERVICE_TOKEN, 'fixture-service-token');
});

test('command rejects relative executable/manifest/cwd and startup-injection overrides', () => {
  for (const key of ['pythonExecutable', 'manifestFile', 'workingDirectory'] as const)
    assert.throws(() => workerRuntimeCommand({ ...input, [key]: 'relative' }, context, {}));
  assert.throws(() =>
    workerRuntimeCommand({ ...input, workerEnvironment: { NODE_OPTIONS: 'unsafe' } }, context, {}),
  );
  assert.throws(() => workerRuntimeCommand(input, { ...context, credentialFile: 'relative' }, {}));
});

test('adapter refuses dotenv discovery and linked/missing paths before issuer or child use', async () => {
  const dir = await mkdtemp(path.join(root, 'supervisor-adapter-'));
  const file = path.join(dir, 'manifest.json');
  await writeFile(file, '{}');
  await writeFile(path.join(dir, '.env'), 'DATABASE_URL=fixture-secret');
  await assert.rejects(
    operatorSupervisorPorts(
      { ...input, pythonExecutable: file, manifestFile: file, workingDirectory: dir },
      {},
    ),
    /dotenv/,
  );
  await assert.rejects(
    operatorSupervisorPorts(
      {
        ...input,
        pythonExecutable: path.join(dir, 'missing'),
        manifestFile: file,
        workingDirectory: dir,
      },
      {},
    ),
  );
});
