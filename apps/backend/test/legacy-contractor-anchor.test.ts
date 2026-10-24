import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyContractorAnchor } from '../src/modules/zones/legacy-contractor-anchor.js';

test('retains an explicit legacy anchor without inferring it from participation or current Worker', () => {
  const anchor = 'ca6fd0ab-b2f3-4e29-b4f0-27d0a0bc7c2c';
  assert.equal(legacyContractorAnchor({ contractorId: anchor }), anchor);
  assert.equal(legacyContractorAnchor({ contractorId: null }), null);
  assert.equal(legacyContractorAnchor({ contractorId: undefined }), null);
  assert.equal(
    legacyContractorAnchor({ siteContractorId: anchor, worker: { contractorId: anchor } }),
    null,
  );
});

test('does not promote inherited metadata into immutable historical ownership', () => {
  const prototype = { contractorId: 'ca6fd0ab-b2f3-4e29-b4f0-27d0a0bc7c2c' };
  assert.equal(legacyContractorAnchor(Object.create(prototype) as object), null);
});

test('rejects malformed own values and accessors without executing them', () => {
  assert.throws(() => legacyContractorAnchor({ contractorId: 42 }), /Legacy contractor anchor/);
  let invoked = false;
  const accessor = Object.defineProperty({}, 'contractorId', {
    get: () => {
      invoked = true;
      return 'synthetic';
    },
  });
  assert.throws(() => legacyContractorAnchor(accessor), /Legacy contractor anchor/);
  assert.equal(invoked, false);
});
