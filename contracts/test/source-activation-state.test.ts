import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import type { SourceActivationResult, SourcePreparationResult } from '../src/index.js';

const commandId = '11111111-1111-4111-8111-111111111111';
const generationId = '33333333-3333-4333-8333-333333333333';

const schema = JSON.parse(
  readFileSync(new URL('../schemas/v1.1/source-activation-state.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const unownedExample = JSON.parse(
  readFileSync(
    new URL('../../examples/v1.1/source-unowned-prepared.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const ajv = new Ajv2020.default({ strict: true });
const validate = ajv.compile(schema);

test('source-activation-state v1.1 JSON schema accepts canonical unowned PREPARED example and v1.0 goldens', () => {
  const legacyPrepared: SourcePreparationResult = {
    schemaVersion: '1.0.0',
    state: 'PREPARED',
    commandId,
    sourceRevision: 0,
    sourceKind: 'LIVE',
    currentGenerationId: generationId,
  };
  const legacyRunning: SourceActivationResult & { schemaVersion: '1.0.0' } = {
    schemaVersion: '1.0.0',
    state: 'RUNNING',
    commandId,
    sourceRevision: 1,
    sourceKind: 'LIVE',
    currentGenerationId: generationId,
  };

  assert.equal(validate(legacyPrepared), true);
  assert.equal(validate(legacyRunning), true);
  assert.equal(validate(unownedExample), true);
  assert.deepEqual(unownedExample, {
    schemaVersion: '1.1.0',
    state: 'PREPARED',
    commandId: '11111111-1111-4111-8111-111111111111',
    sourceRevision: 0,
    sourceKind: 'LIVE',
    currentGenerationId: null,
  } satisfies SourcePreparationResult);
});

function withoutCurrentGeneration(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.currentGenerationId;
  return copy;
}

test('source-activation-state v1.1 JSON schema rejects invalid v1.0 and v1.1 boundary variants', () => {
  const legacyBase = {
    schemaVersion: '1.0.0',
    state: 'PREPARED',
    commandId,
    sourceRevision: 0,
    sourceKind: 'LIVE',
    currentGenerationId: generationId,
  };
  const invalidPayloads: unknown[] = [
    { ...legacyBase, currentGenerationId: null },
    withoutCurrentGeneration(legacyBase),
    { ...legacyBase, unknownField: true },
    { ...unownedExample, state: 'RUNNING' },
    { ...unownedExample, state: 'RUNNING', sourceRevision: 1, currentGenerationId: generationId },
    { ...unownedExample, sourceRevision: 1 },
    { ...unownedExample, sourceRevision: -1 },
    withoutCurrentGeneration(unownedExample),
    { ...unownedExample, currentGenerationId: generationId },
    { ...unownedExample, unknownField: true },
    { ...unownedExample, permission: 'BOOTSTRAP' },
    { ...unownedExample, sourceKind: 'REPLAY' },
    { ...unownedExample, commandId: 'not-a-uuid' },
  ];

  for (const payload of invalidPayloads) {
    assert.equal(
      validate(payload),
      false,
      `Expected JSON schema rejection for ${JSON.stringify(payload)}`,
    );
  }
});
