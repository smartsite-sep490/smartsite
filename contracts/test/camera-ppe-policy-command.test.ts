import assert from 'node:assert/strict';
import { test } from 'node:test';

const modulePath = '../src/camera-ppe-policy-command.js';
const api = await import(modulePath).catch(() => ({}));
const camera = api.parseCameraPpePolicyChangeCommand as (input: unknown) => unknown;
const region = api.parseRegionPpePolicyChangeCommand as (input: unknown) => unknown;
const command = {
  commandId: '11111111-1111-4111-8111-111111111111',
  expectedConfigurationVersion: 4,
  policy: { mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST', 'HARD_HAT'] },
};

test('policy commands retain the replay ID and expected version, canonicalizing detached items', () => {
  const parsed = camera(command) as typeof command;
  assert.deepEqual(parsed, {
    ...command,
    policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
  });
  parsed.policy.requiredPpe.push('BOOTS');
  assert.deepEqual(command.policy.requiredPpe, ['SAFETY_VEST', 'HARD_HAT']);
});

test('Region may inherit but camera default cannot inherit', () => {
  const input = { ...command, policy: { mode: 'INHERIT' } };
  assert.equal(camera(input), null);
  assert.deepEqual(region(input), input);
  const disabled = { ...command, policy: { mode: 'DISABLED', reason: ' Local exception ' } };
  assert.deepEqual(camera(disabled), {
    ...disabled,
    policy: { mode: 'DISABLED', reason: 'Local exception' },
  });
});

test('commands reject invalid revisions, missing replay IDs and caller-supplied scope or result fields', () => {
  for (const parse of [camera, region]) {
    for (const expectedConfigurationVersion of [0, -1, 1.5, '4', Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(parse({ ...command, expectedConfigurationVersion }), null);
    }
    for (const commandId of ['', null, 'not-a-uuid']) {
      assert.equal(parse({ ...command, commandId }), null);
    }
    for (const extra of ['siteId', 'cameraId', 'regionId', 'configurationVersion', 'applied']) {
      assert.equal(parse({ ...command, [extra]: 'caller-value' }), null);
    }
    assert.equal(parse({ policy: command.policy }), null);
    assert.equal(parse(Object.assign(Object.create(command), {})), null);
    assert.equal(parse({ ...command, [Symbol('extra')]: true }), null);
  }
});

test('commands reuse strict policy validation for all five items and disabled reasons', () => {
  for (const parse of [camera, region]) {
    assert.ok(
      parse({
        ...command,
        policy: {
          mode: 'EXPLICIT',
          requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'],
        },
      }),
    );
    for (const policy of [
      { mode: 'EXPLICIT', requiredPpe: [] },
      { mode: 'EXPLICIT', requiredPpe: ['MASK'] },
      { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'GLOVES'] },
      { mode: 'DISABLED', reason: ' ' },
      { mode: 'DISABLED', reason: 'x'.repeat(501) },
      { mode: 'DISABLED', reason: 'hidden\ncontrol' },
      { mode: 'INHERIT', requiredPpe: ['HARD_HAT'] },
    ])
      assert.equal(parse({ ...command, policy }), null);
  }
});
