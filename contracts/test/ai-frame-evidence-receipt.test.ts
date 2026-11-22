import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

function artifact(path: string) {
  const local = new URL('../' + path, import.meta.url);
  return JSON.parse(
    readFileSync(existsSync(local) ? local : new URL('../../' + path, import.meta.url), 'utf8'),
  );
}

test('private frame receipt is bound storage evidence, never an admission or permission receipt', () => {
  const validate = new Ajv2020.default({ strict: true }).compile(
    artifact('schemas/v1/ai-frame-evidence-receipt.json'),
  );
  const receipt = artifact('examples/v1/ai-frame-evidence-receipt.json');
  assert.equal(validate(receipt), true);
  for (const invalid of [
    { ...receipt, kind: 'RAW_STORED' },
    { ...receipt, kind: 'FRAME_ADMITTED' },
    { ...receipt, allowed: true },
    { ...receipt, publicUrl: 'https://example.invalid/frame.jpg' },
    { ...receipt, bindingHash: undefined },
    { ...receipt, sha256: 'C'.repeat(64) },
  ])
    assert.equal(validate(invalid), false);
});
