import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withTempBundleFixture } from './web-bundle-budget-fixture.mjs';

const checker = fileURLToPath(new URL('./check-web-bundle-budget.mjs', import.meta.url));
function run(args) {
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', checker, ...args], {
    env: { ...process.env, NODE_OPTIONS: '' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 131072,
  });
  assert.equal(result.error, undefined);
  return result;
}

test('CLI exits zero and prints an independently measurable passing build', async () => {
  await withTempBundleFixture(
    { 'assets/index.js': 500000 },
    { 'index.html': { file: 'assets/index.js', isEntry: true } },
    (manifest) => {
      const result = run([manifest]);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(JSON.parse(result.stdout).initialBytes, 500000);
      assert.equal(JSON.parse(result.stdout).pass, true);
    },
  );
});

test('CLI exits one for a valid build that breaches the actual byte budget', async () => {
  await withTempBundleFixture(
    { 'assets/index.js': 500001 },
    { 'index.html': { file: 'assets/index.js', isEntry: true } },
    (manifest) => {
      const result = run([manifest]);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, '');
      assert.equal(JSON.parse(result.stdout).pass, false);
      assert.deepEqual(JSON.parse(result.stdout).oversizedChunks, [
        { file: 'assets/index.js', bytes: 500001 },
      ]);
    },
  );
});

test('CLI distinguishes malformed input and wrong invocation from budget failure', async () => {
  const missingArgument = run([]);
  assert.equal(missingArgument.status, 2);
  assert.match(missingArgument.stderr, /Usage:/);
  await withTempBundleFixture({}, '{invalid-json-content-must-not-be-echoed', (manifest) => {
    const result = run([manifest]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /invalid build manifest JSON/);
    assert.doesNotMatch(result.stderr, /invalid-json-content-must-not-be-echoed/);
  });
});
