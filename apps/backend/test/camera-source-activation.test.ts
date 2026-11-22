import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activateTestedCameraSource } from '../src/modules/cameras/camera-source-activation.js';

const commandId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
const previous = '33333333-3333-4333-8333-333333333333';
const current = '44444444-4444-4444-8444-444444444444';
test('activation stops old owner, rechecks authority, issues once, then starts with server-only generation', async () => {
  const calls: string[] = [];
  const result = await activateTestedCameraSource(
    { commandId, receiptId, expectedRevision: 0 },
    {
      authorize: async () => {
        calls.push('auth');
      },
      prepare: async () => {
        calls.push('stop');
        return {
          state: 'PREPARED',
          commandId,
          sourceRevision: 0,
          sourceKind: 'LIVE',
          currentGenerationId: previous,
        };
      },
      issue: async (expected, command) => {
        assert.equal(expected, previous);
        assert.equal(command, commandId);
        calls.push('issue');
        return {
          workerGenerationId: current,
          streamSessionId: current,
          secret: 'server-only-generation',
          expiresAt: '2026-11-20T23:00:00Z',
        };
      },
      commit: async (command, generation) => {
        assert.equal(command, commandId);
        assert.equal(generation.secret, 'server-only-generation');
        calls.push('start');
        return {
          state: 'RUNNING',
          commandId,
          sourceRevision: 1,
          sourceKind: 'LIVE',
          currentGenerationId: current,
        };
      },
    },
  );
  assert.deepEqual(calls, ['auth', 'stop', 'auth', 'issue', 'auth', 'start', 'auth']);
  assert.equal(result.state, 'RUNNING');
  assert.doesNotMatch(JSON.stringify(result), /server-only-generation/);
});
test('revoked permission after stopping never issues or starts; completed retry never renews', async () => {
  let auth = 0,
    issue = 0,
    start = 0;
  const ports = {
    authorize: async () => {
      if (++auth === 2) throw Error('revoked');
    },
    prepare: async () => ({
      state: 'PREPARED' as const,
      commandId,
      sourceRevision: 0,
      sourceKind: 'LIVE' as const,
      currentGenerationId: previous,
    }),
    issue: async () => {
      issue++;
      throw Error('unexpected');
    },
    commit: async () => {
      start++;
      throw Error('unexpected');
    },
  };
  await assert.rejects(
    activateTestedCameraSource({ commandId, receiptId, expectedRevision: 0 }, ports),
    /revoked/,
  );
  assert.equal(issue, 0);
  assert.equal(start, 0);
  const done = {
    state: 'RUNNING' as const,
    commandId,
    sourceRevision: 1,
    sourceKind: 'LIVE' as const,
    currentGenerationId: current,
  };
  const result = await activateTestedCameraSource(
    { commandId, receiptId, expectedRevision: 0 },
    { ...ports, authorize: async () => {}, prepare: async () => done },
  );
  assert.deepEqual(result, done);
  assert.equal(issue, 0);
});
