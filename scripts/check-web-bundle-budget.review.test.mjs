import assert from 'node:assert/strict';
import { mkdirSync, renameSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { analyzeWebBundle } from './check-web-bundle-budget.mjs';
import { withTempBundleFixture } from './web-bundle-budget-fixture.mjs';

for (const [field, value] of [
  ['imports', null],
  ['dynamicImports', null],
  ['isEntry', 'true'],
  ['isDynamicEntry', 'true'],
]) {
  test(`rejects malformed ${field} instead of reporting a passing build`, async () => {
    await withTempBundleFixture(
      { 'entry.js': 300000, 'other.js': 300000 },
      {
        'index.html': { file: 'entry.js', isEntry: true },
        other: { file: 'other.js', [field]: value },
      },
      (manifest) => assert.throws(() => analyzeWebBundle(manifest), /Invalid|invalid/),
    );
  });
}

function link(t, target, path) {
  try {
    symlinkSync(target, path, 'file');
    return true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    t.skip(`File symlinks unavailable under current OS permissions: ${error.code}`);
    return false;
  }
}

test('a JavaScript URL symlink to an oversized non-JS target cannot pass', async (t) => {
  await withTempBundleFixture(
    { 'payload.bin': 600001 },
    { 'index.html': { file: 'entry.js', isEntry: true } },
    (manifest, root) => {
      if (!link(t, 'payload.bin', join(root, 'entry.js'))) return;
      assert.throws(() => analyzeWebBundle(manifest), /alias|Alias|unsafe|Unsafe/);
    },
  );
});

test('an asset symlink outside its build directory is rejected', async (t) => {
  await withTempBundleFixture({ 'outside.js': 100 }, {}, async (_outerManifest, outerRoot) => {
    await withTempBundleFixture(
      {},
      { 'index.html': { file: 'entry.js', isEntry: true } },
      (manifest, root) => {
        if (!link(t, join(outerRoot, 'outside.js'), join(root, 'entry.js'))) return;
        assert.throws(() => analyzeWebBundle(manifest), /unsafe|Unsafe|escapes/);
      },
    );
  });
});

test('Vite .vite manifest resolves assets against the actual build root', async () => {
  await withTempBundleFixture(
    { 'assets/entry.js': 120 },
    { 'index.html': { file: 'assets/entry.js', isEntry: true } },
    (manifest, root) => {
      mkdirSync(join(root, '.vite'));
      const viteManifest = join(root, '.vite/manifest.json');
      renameSync(manifest, viteManifest);
      assert.equal(analyzeWebBundle(viteManifest).initialBytes, 120);
      assert.equal(analyzeWebBundle(viteManifest).pass, true);
    },
  );
});
