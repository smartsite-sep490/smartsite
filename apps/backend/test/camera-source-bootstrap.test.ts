import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { backendDirectory } from '../src/config/runtime-environment.js';
import {
  activateTestedCameraSource,
  type SourceActivationPorts,
  type SourceActivationState,
} from '../src/modules/cameras/camera-source-activation.js';
import { sourceActivationStateSchema } from '../src/modules/cameras/camera-source-contract.js';

const commandId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
const existingGenerationId = '33333333-3333-4333-8333-333333333333';
const issuedGenerationId = '44444444-4444-4444-8444-444444444444';
const otherGenerationId = '55555555-5555-4555-8555-555555555555';

const unownedExamplePath = path.resolve(
  backendDirectory,
  '..',
  '..',
  'contracts',
  'examples',
  'v1.1',
  'source-unowned-prepared.json',
);
const unownedExample = JSON.parse(readFileSync(unownedExamplePath, 'utf8')) as Record<
  string,
  unknown
>;

const issuedGeneration = {
  workerGenerationId: issuedGenerationId,
  streamSessionId: '66666666-6666-4666-8666-666666666666',
  secret: 'server-only-bootstrap-generation-secret',
  expiresAt: '2026-11-22T23:00:00Z',
};

test('strict sourceActivationStateSchema accepts canonical v1.1 unowned PREPARED example and preserves valid v1.0 goldens', () => {
  const legacyPrepared = {
    schemaVersion: '1.0.0',
    state: 'PREPARED',
    commandId,
    sourceRevision: 0,
    sourceKind: 'LIVE',
    currentGenerationId: existingGenerationId,
  };
  const legacyRunning = {
    schemaVersion: '1.0.0',
    state: 'RUNNING',
    commandId,
    sourceRevision: 1,
    sourceKind: 'LIVE',
    currentGenerationId: issuedGenerationId,
  };
  assert.deepEqual(sourceActivationStateSchema.parse(legacyPrepared), legacyPrepared);
  assert.deepEqual(sourceActivationStateSchema.parse(legacyRunning), legacyRunning);

  assert.equal(unownedExample.schemaVersion, '1.1.0');
  assert.equal(unownedExample.state, 'PREPARED');
  assert.equal(unownedExample.sourceRevision, 0);
  assert.equal(unownedExample.sourceKind, 'LIVE');
  assert.equal(unownedExample.currentGenerationId, null);

  assert.deepEqual(sourceActivationStateSchema.parse(unownedExample), unownedExample);
});

function withoutCurrentGeneration(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.currentGenerationId;
  return copy;
}

test('strict sourceActivationStateSchema rejects invalid v1.0 null-owner and invalid v1.1 boundary variants', () => {
  const legacyBase = {
    schemaVersion: '1.0.0',
    state: 'PREPARED',
    commandId,
    sourceRevision: 0,
    sourceKind: 'LIVE',
    currentGenerationId: existingGenerationId,
  };
  const invalidPayloads: unknown[] = [
    { ...legacyBase, currentGenerationId: null },
    withoutCurrentGeneration(legacyBase),
    { ...legacyBase, unknownField: true },
    { ...unownedExample, state: 'RUNNING' },
    {
      ...unownedExample,
      state: 'RUNNING',
      sourceRevision: 1,
      currentGenerationId: issuedGenerationId,
    },
    { ...unownedExample, sourceRevision: 1 },
    { ...unownedExample, sourceRevision: -1 },
    withoutCurrentGeneration(unownedExample),
    { ...unownedExample, unknownField: true },
    { ...unownedExample, permission: 'BOOTSTRAP' },
    { ...unownedExample, sourceKind: 'REPLAY' },
    { ...unownedExample, commandId: 'not-a-uuid' },
  ];

  for (const payload of invalidPayloads) {
    assert.equal(
      sourceActivationStateSchema.safeParse(payload).success,
      false,
      `Expected schema rejection for ${JSON.stringify(payload)}`,
    );
  }
});

test('zero-revision bootstrap helper issues null only for unowned v1.1 PREPARED, rechecks authority, and returns confirmed RUNNING generation', async () => {
  const calls: string[] = [];
  const issuedWith: unknown[] = [];

  const ports = {
    authorize: async () => {
      calls.push('auth');
    },
    prepare: async () => {
      calls.push('prepare');
      return structuredClone(unownedExample) as unknown as SourceActivationState;
    },
    issue: async (expected: string | null, cmd: string) => {
      assert.equal(expected, null);
      assert.equal(cmd, commandId);
      issuedWith.push(expected);
      calls.push('issue');
      return issuedGeneration;
    },
    commit: async (cmd: string, generation: typeof issuedGeneration) => {
      assert.equal(cmd, commandId);
      assert.equal(generation.secret, issuedGeneration.secret);
      calls.push('commit');
      return {
        schemaVersion: '1.0.0',
        state: 'RUNNING',
        commandId,
        sourceRevision: 1,
        sourceKind: 'LIVE',
        currentGenerationId: issuedGenerationId,
      } as unknown as SourceActivationState;
    },
  } as unknown as SourceActivationPorts;

  const result = await activateTestedCameraSource(
    { commandId, receiptId, expectedRevision: 0 },
    ports,
  );

  assert.deepEqual(calls, ['auth', 'prepare', 'auth', 'issue', 'commit', 'auth']);
  assert.deepEqual(issuedWith, [null]);
  assert.equal(result.state, 'RUNNING');
  assert.equal(result.sourceRevision, 1);
  assert.equal(result.currentGenerationId, issuedGenerationId);
  assert.doesNotMatch(JSON.stringify(result), /server-only-bootstrap-generation-secret/);
});

test('bootstrap helper rejects null owner on nonzero revision or legacy schema, and rejects v1.1/null in RUNNING state', async () => {
  const invalidPreparedCases: Array<{
    expectedRevision: number;
    prepared: Record<string, unknown>;
  }> = [
    {
      expectedRevision: 1,
      prepared: { ...unownedExample, sourceRevision: 1 },
    },
    {
      expectedRevision: 0,
      prepared: { ...unownedExample, schemaVersion: '1.0.0' },
    },
    {
      expectedRevision: 0,
      prepared: {
        schemaVersion: '1.0.0',
        state: 'RUNNING',
        commandId,
        sourceRevision: 1,
        sourceKind: 'LIVE',
        currentGenerationId: null,
      },
    },
  ];

  for (const testCase of invalidPreparedCases) {
    let issues = 0;
    let commits = 0;
    const ports = {
      authorize: async () => {},
      prepare: async () => structuredClone(testCase.prepared) as unknown as SourceActivationState,
      issue: async () => {
        issues++;
        return issuedGeneration;
      },
      commit: async () => {
        commits++;
        return {
          state: 'RUNNING',
          commandId,
          sourceRevision: testCase.expectedRevision + 1,
          sourceKind: 'LIVE',
          currentGenerationId: issuedGenerationId,
        };
      },
    } as unknown as SourceActivationPorts;

    await assert.rejects(
      activateTestedCameraSource(
        { commandId, receiptId, expectedRevision: testCase.expectedRevision },
        ports,
      ),
      `Expected helper rejection for prepared=${JSON.stringify(testCase.prepared)}`,
    );
    assert.equal(issues, 0);
    assert.equal(commits, 0);
  }

  // CameraSourceService.remote() validates every wire payload with sourceActivationStateSchema
  // at the transport boundary before activateTestedCameraSource() inspects command/generation state.
  for (const invalidRunning of [
    {
      schemaVersion: '1.1.0',
      state: 'RUNNING',
      commandId,
      sourceRevision: 1,
      sourceKind: 'LIVE',
      currentGenerationId: issuedGenerationId,
    },
    {
      schemaVersion: '1.0.0',
      state: 'RUNNING',
      commandId,
      sourceRevision: 1,
      sourceKind: 'LIVE',
      currentGenerationId: null,
    },
    {
      schemaVersion: '1.0.0',
      state: 'RUNNING',
      commandId,
      sourceRevision: 2,
      sourceKind: 'LIVE',
      currentGenerationId: issuedGenerationId,
    },
    {
      schemaVersion: '1.0.0',
      state: 'RUNNING',
      commandId,
      sourceRevision: 1,
      sourceKind: 'LIVE',
      currentGenerationId: otherGenerationId,
    },
  ]) {
    const ports: SourceActivationPorts = {
      authorize: async () => {},
      prepare: async () => sourceActivationStateSchema.parse(structuredClone(unownedExample)),
      issue: async () => issuedGeneration,
      commit: async () => sourceActivationStateSchema.parse(structuredClone(invalidRunning)),
    };

    await assert.rejects(
      activateTestedCameraSource({ commandId, receiptId, expectedRevision: 0 }, ports),
      `Expected boundary/confirmation failure for running=${JSON.stringify(invalidRunning)}`,
    );
  }
});

test('revoked authority after unowned prepare never issues or commits, completed retry issues nothing, and failed commit stays fail closed', async () => {
  let authChecks = 0;
  let issues = 0;
  let commits = 0;
  const revokedPorts = {
    authorize: async () => {
      if (++authChecks === 2) throw new Error('revoked');
    },
    prepare: async () => structuredClone(unownedExample) as unknown as SourceActivationState,
    issue: async () => {
      issues++;
      return issuedGeneration;
    },
    commit: async () => {
      commits++;
      throw new Error('unexpected commit');
    },
  } as unknown as SourceActivationPorts;

  await assert.rejects(
    activateTestedCameraSource({ commandId, receiptId, expectedRevision: 0 }, revokedPorts),
    /revoked/,
  );
  assert.equal(issues, 0);
  assert.equal(commits, 0);

  const alreadyRunning: SourceActivationState = {
    state: 'RUNNING',
    commandId,
    sourceRevision: 1,
    sourceKind: 'LIVE',
    currentGenerationId: issuedGenerationId,
  };
  const retryResult = await activateTestedCameraSource(
    { commandId, receiptId, expectedRevision: 0 },
    {
      authorize: async () => {},
      prepare: async () => alreadyRunning,
      issue: async () => {
        issues++;
        return issuedGeneration;
      },
      commit: async () => {
        commits++;
        return alreadyRunning;
      },
    },
  );
  assert.deepEqual(retryResult, alreadyRunning);
  assert.equal(issues, 0);
  assert.equal(commits, 0);

  let commitCalls = 0;
  await assert.rejects(
    activateTestedCameraSource({ commandId, receiptId, expectedRevision: 0 }, {
      authorize: async () => {},
      prepare: async () => structuredClone(unownedExample) as unknown as SourceActivationState,
      issue: async () => issuedGeneration,
      commit: async () => {
        commitCalls++;
        throw new Error('commit failed');
      },
    } as unknown as SourceActivationPorts),
    /commit failed/,
  );
  assert.equal(commitCalls, 1);
});
