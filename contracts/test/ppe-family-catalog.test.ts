import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PPE_FAMILY_CATALOG, PPE_ITEMS } from '../src/ppe-items.js';

const schema = JSON.parse(
  readFileSync(
    new URL('../schemas/v1.3/technical-observation-event.json', import.meta.url),
    'utf8',
  ),
);

describe('PPE family catalog compatibility', () => {
  it('lists every reviewed v1.3 family once without silently expanding policy input', () => {
    const families = PPE_FAMILY_CATALOG.map((entry) => entry.item);
    assert.deepEqual(families, schema.$defs.ppeObservation.properties.ppeItem.enum);
    assert.equal(new Set(families).size, families.length);
    assert.deepEqual(
      PPE_FAMILY_CATALOG.filter((entry) => entry.policySelectable).map((entry) => entry.item),
      PPE_ITEMS,
    );
    assert.deepEqual(PPE_ITEMS, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']);
  });

  it('retains present-only harness/hook semantics instead of implying missing or attachment safety', () => {
    const restricted = PPE_FAMILY_CATALOG.filter(
      (entry) => entry.observationSemantics === 'PRESENT_ONLY',
    );
    assert.deepEqual(
      restricted.map((entry) => entry.item),
      schema.$defs.ppeObservation.allOf[0].if.properties.ppeItem.enum,
    );
    for (const entry of restricted) {
      assert.equal(entry.policySelectable, false);
      assert.equal(entry.unsupportedReasonCode, 'PRESENT_ONLY_SAFETY_BOUNDARY');
    }
  });

  it('explains unintegrated mask policy without treating its schema as runtime model support', () => {
    const mask = PPE_FAMILY_CATALOG.find((entry) => entry.item === 'MASK');
    assert.ok(mask);
    assert.equal(mask.policySelectable, false);
    assert.equal(mask.observationSemantics, 'PRESENT_MISSING');
    assert.equal(mask.unsupportedReasonCode, 'NOT_IN_POLICY_CONTRACT');
    for (const entry of PPE_FAMILY_CATALOG) {
      assert.equal('modelSupported' in entry, false);
      assert.equal(entry.policySelectable, entry.unsupportedReasonCode === null);
    }
  });
});
