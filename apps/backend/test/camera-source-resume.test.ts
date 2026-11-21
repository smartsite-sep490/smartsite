import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resumeAcceptedCameraSource } from '../src/modules/cameras/camera-source-resume.js';
const command = { commandId: 'command', expectedRevision: 3, expectedConfigurationVersion: 12 };
const owner = 'old-owner',
  generation = {
    workerGenerationId: 'new-owner',
    streamSessionId: 'new-session',
    secret: 'private-credential',
    expiresAt: '2026-11-21T01:00:00Z',
  };
const prepared = {
  state: 'PREPARED' as const,
  commandId: command.commandId,
  sourceRevision: 3,
  sourceKind: 'LIVE' as const,
  currentGenerationId: owner,
};
test('resume preserves source revision, rechecks authority, and only returns public host state', async () => {
  const calls: string[] = [];
  const result = await resumeAcceptedCameraSource(command, owner, {
    authorize: async () => {
      calls.push('auth');
    },
    prepare: async () => {
      calls.push('stop');
      return prepared;
    },
    issue: async (id, cmd) => {
      assert.equal(id, owner);
      assert.equal(cmd, command.commandId);
      calls.push('issue');
      return generation;
    },
    commit: async (cmd, issued) => {
      assert.equal(issued.secret, generation.secret);
      calls.push('start');
      return {
        ...prepared,
        state: 'RUNNING',
        commandId: cmd,
        currentGenerationId: issued.workerGenerationId,
      };
    },
  });
  assert.deepEqual(calls, ['auth', 'stop', 'auth', 'issue', 'auth', 'start']);
  assert.equal(result.sourceRevision, 3);
  assert.doesNotMatch(JSON.stringify(result), /private-credential/);
});
test('foreign owner or source revision and revoked caller never start a worker', async () => {
  for (const changed of [{ currentGenerationId: 'foreign' }, { sourceRevision: 4 }]) {
    let issued = 0;
    await assert.rejects(
      resumeAcceptedCameraSource(command, owner, {
        authorize: async () => {},
        prepare: async () => ({ ...prepared, ...changed }),
        issue: async () => {
          issued++;
          return generation;
        },
        commit: async () => {
          throw Error('must not start');
        },
      }),
    );
    assert.equal(issued, 0);
  }
  for (const revokeAt of [2, 3]) {
    let checks = 0,
      starts = 0;
    await assert.rejects(
      resumeAcceptedCameraSource(command, owner, {
        authorize: async () => {
          if (++checks === revokeAt) throw Error('revoked');
        },
        prepare: async () => prepared,
        issue: async () => generation,
        commit: async () => {
          starts++;
          throw Error('must not start');
        },
      }),
      /revoked/,
    );
    assert.equal(starts, 0);
  }
});
test('known running retry never issues again and uncertain commit is never retried', async () => {
  const running = {
    ...prepared,
    state: 'RUNNING' as const,
    currentGenerationId: generation.workerGenerationId,
  };
  let issues = 0,
    commits = 0;
  await resumeAcceptedCameraSource(command, generation.workerGenerationId, {
    authorize: async () => {},
    prepare: async () => running,
    issue: async () => {
      issues++;
      return generation;
    },
    commit: async () => {
      commits++;
      return running;
    },
  });
  assert.equal(issues, 0);
  assert.equal(commits, 0);
  await assert.rejects(
    resumeAcceptedCameraSource(command, owner, {
      authorize: async () => {},
      prepare: async () => prepared,
      issue: async () => generation,
      commit: async () => {
        commits++;
        throw Error('unknown outcome');
      },
    }),
    /unknown outcome/,
  );
  assert.equal(commits, 1);
});
