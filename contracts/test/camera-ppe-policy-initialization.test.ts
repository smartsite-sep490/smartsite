import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInitializeCameraPpePolicyCommand as parse } from '../src/camera-ppe-policy-command.js';
const regionId = '00000000-0000-4000-8000-000000000001';
const input = {
  commandId: '00000000-0000-4000-8000-000000000002',
  expectedConfigurationVersion: 1,
  policy: { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'HARD_HAT'] },
  regionPolicies: [{ regionId, policy: { mode: 'INHERIT' } }],
};
test('initialization retains explicit choices and normalizes copies', () => {
  const result = parse(input)!;
  assert.deepEqual(result.policy, { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'HARD_HAT'] });
  assert.deepEqual(result.regionPolicies, input.regionPolicies);
  assert.notEqual(result.regionPolicies, input.regionPolicies);
  assert(parse({ ...input, regionPolicies: [] }));
});
test('initialization refuses missing, duplicate and sparse binding choices', () => {
  assert.equal(parse({ ...input, regionPolicies: undefined }), null);
  assert.equal(
    parse({ ...input, regionPolicies: [...input.regionPolicies, ...input.regionPolicies] }),
    null,
  );
  assert.equal(parse({ ...input, regionPolicies: Array(1) }), null);
  assert.equal(parse({ ...input, regionPolicies: [{ regionId, policy: [] }] }), null);
});
test('legacy empty requirements and caller-owned authority fields never become policy', () => {
  assert.equal(parse({ ...input, policy: { mode: 'EXPLICIT', requiredPpe: [] } }), null);
  assert.equal(parse({ ...input, siteId: 'invented' }), null);
  assert.equal(
    parse({
      ...input,
      regionPolicies: [{ regionId, policy: { mode: 'INHERIT' }, actor: 'invented' }],
    }),
    null,
  );
  assert.equal(parse(Object.assign(new Date(), input)), null);
  assert.equal(
    parse({ ...input, regionPolicies: [Object.assign(new Date(), input.regionPolicies[0])] }),
    null,
  );
});
