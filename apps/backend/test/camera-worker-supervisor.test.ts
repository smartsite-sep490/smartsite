import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  superviseCameraWorker,
  workerChildEnvironment,
} from '../src/scripts/camera-worker-supervisor.js';

const cameraId = '11111111-1111-4111-8111-111111111111';
function options(id = cameraId) {
  return {
    cameraId: id,
    allowedCameraIds: [id],
    credentialDirectory: path.resolve(process.env.TEMP!),
    outboxPath: path.resolve(process.env.TEMP!, 'existing-outbox.sqlite3'),
    databaseIdentity: '127.0.0.1:5433/smartsite_test/owned',
    leaseMs: 60000,
    maximumStarts: 2,
  };
}

test('each replacement awaits prior exit, issues a fresh artifact and retains the outbox', async () => {
  const order: string[] = [],
    outputs: string[] = [],
    outboxes: string[] = [];
  const result = await superviseCameraWorker(
    options(),
    {
      issue: async (args) => {
        order.push('issue');
        outputs.push(args[args.indexOf('--output') + 1]!);
      },
      launch: async (context) => {
        order.push('launch');
        outboxes.push(context.outboxPath);
        return {
          exited: Promise.resolve({ code: 1, termination: 'EXITED' as const }).then((value) => {
            order.push('exit');
            return value;
          }),
          stop: async () => {
            throw Error('unexpected stop');
          },
        };
      },
      backoff: async () => {
        order.push('backoff');
      },
    },
    new AbortController().signal,
  );
  assert.equal(result.status, 'EXHAUSTED');
  assert.deepEqual(order, ['issue', 'launch', 'exit', 'backoff', 'issue', 'launch', 'exit']);
  assert.equal(new Set(outputs).size, 2);
  assert.deepEqual(outboxes, [options().outboxPath, options().outboxPath]);
});

test('cancellation during issuance never launches a child or retries', async () => {
  const controller = new AbortController();
  let launches = 0;
  const result = await superviseCameraWorker(
    options(),
    {
      issue: async () => {
        controller.abort();
      },
      launch: async () => {
        launches++;
        throw Error('must not launch');
      },
      backoff: async () => {
        throw Error('must not retry');
      },
    },
    controller.signal,
  );
  assert.equal(result.status, 'CANCELLED');
  assert.equal(launches, 0);
});

test('concurrent supervisors for the same camera are refused while owned child stops', async () => {
  const controller = new AbortController();
  let stopped = false;
  let done!: (value: { code: number; termination: 'EXITED' }) => void;
  let launched!: () => void;
  const ready = new Promise<void>((resolve) => {
    launched = resolve;
  });
  const running = superviseCameraWorker(
    options(),
    {
      issue: async () => {},
      launch: async () => {
        launched();
        return {
          exited: new Promise((resolve) => {
            done = resolve;
          }),
          stop: async () => {
            stopped = true;
            done({ code: 0, termination: 'EXITED' });
          },
        };
      },
      backoff: async () => {},
    },
    controller.signal,
  );
  await ready;
  await assert.rejects(
    superviseCameraWorker(
      options(),
      {
        issue: async () => {},
        launch: async () => {
          throw Error('never');
        },
        backoff: async () => {},
      },
      new AbortController().signal,
    ),
  );
  controller.abort();
  assert.equal((await running).status, 'CANCELLED');
  assert.equal(stopped, true);
});

test('issuer failure is sanitized and latches reconciliation instead of retrying', async () => {
  const id = '22222222-2222-4222-8222-222222222222';
  let issued = 0;
  const ports = {
    issue: async () => {
      issued++;
      throw Error('postgres://issuer:secret@private');
    },
    launch: async () => {
      throw Error('must not launch');
    },
    backoff: async () => {},
  };
  await assert.rejects(superviseCameraWorker(options(id), ports, new AbortController().signal), {
    message: 'Worker supervisor requires operator reconciliation',
  });
  await assert.rejects(superviseCameraWorker(options(id), ports, new AbortController().signal));
  assert.equal(issued, 1);
});

test('child environment is an allowlist, never inherits issuer/database/admin credentials', () => {
  const env = workerChildEnvironment(
    {
      PATH: 'tools',
      SystemRoot: 'windows',
      TEMP: 'D:/temp',
      DATABASE_URL: 'secret',
      DIRECT_URL: 'secret',
      SMARTSITE_AI_ISSUER_TOKEN: 'secret',
      NODE_OPTIONS: 'secret',
      SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'secret',
    },
    { SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'worker-service-token' },
  );
  assert.deepEqual(env, {
    PATH: 'tools',
    SystemRoot: 'windows',
    TEMP: 'D:/temp',
    SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'worker-service-token',
  });
  assert.throws(() => workerChildEnvironment({}, { DATABASE_URL: 'secret' }));
});

test(
  'prototype drives and awaits an actual owned fake process with a restricted environment',
  { timeout: 5000 },
  async (t) => {
    const controller = new AbortController();
    let stopped = false;
    const result = await superviseCameraWorker(
      { ...options('33333333-3333-4333-8333-333333333333'), maximumStarts: 1 },
      {
        issue: async () => {},
        launch: async () => {
          const child = spawn(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              `
        if (process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.SMARTSITE_AI_ISSUER_TOKEN) process.exit(9);
        process.stdout.write('ready');
        process.stdin.once('data', () => process.exit(0));
        process.stdin.resume();
      `,
            ],
            {
              windowsHide: true,
              shell: false,
              stdio: ['pipe', 'pipe', 'pipe'],
              env: workerChildEnvironment(
                {
                  ...process.env,
                  DATABASE_URL: 'fixture-issuer-secret',
                  DIRECT_URL: 'fixture-secret',
                  SMARTSITE_AI_ISSUER_TOKEN: 'fixture-secret',
                },
                {},
              ),
            },
          );
          t.after(() => {
            if (child.exitCode === null) child.kill();
          });
          const exited = once(child, 'exit').then(([code]) => ({
            code: code as number | null,
            termination: 'EXITED' as const,
          }));
          const [ready] = await once(child.stdout, 'data');
          assert.equal(ready.toString(), 'ready');
          controller.abort();
          return {
            exited,
            stop: async () => {
              stopped = true;
              child.stdin.end('stop');
            },
          };
        },
      },
      controller.signal,
    );
    assert.equal(result.status, 'CANCELLED');
    assert.equal(stopped, true);
    assert.deepEqual(result.exits, [{ code: 0, termination: 'EXITED' }]);
  },
);

test('test prototype refuses non-test database identity before issuance', async () => {
  let issued = false;
  await assert.rejects(
    superviseCameraWorker(
      { ...options(), databaseIdentity: '127.0.0.1:5434/main/public' },
      {
        issue: async () => {
          issued = true;
        },
        launch: async () => {
          throw Error('never');
        },
      },
      new AbortController().signal,
    ),
  );
  assert.equal(issued, false);
});

test('unproven child cleanup latches ownership and never starts a replacement', async () => {
  const id = '44444444-4444-4444-8444-444444444444';
  const controller = new AbortController();
  let launches = 0;
  const ports = {
    issue: async () => {},
    launch: async () => {
      launches++;
      controller.abort();
      return {
        exited: new Promise<{ code: number; termination: 'EXITED' }>(() => {}),
        stop: async () => {
          throw Error('private-source-cleanup-failed');
        },
      };
    },
  };
  await assert.rejects(superviseCameraWorker(options(id), ports, controller.signal), {
    message: 'Worker supervisor requires operator reconciliation',
  });
  await assert.rejects(superviseCameraWorker(options(id), ports, new AbortController().signal));
  assert.equal(launches, 1);
});
