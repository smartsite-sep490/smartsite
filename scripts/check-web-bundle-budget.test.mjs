import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeWebBundle } from './check-web-bundle-budget.mjs';
import { withTempBundleFixture } from './web-bundle-budget-fixture.mjs';

async function expectBundleError(files, manifest) {
  await withTempBundleFixture(files, manifest, async (manifestPath) => {
    await assert.rejects(async () => await analyzeWebBundle(manifestPath));
  });
}

test('deduplicates transitive and cyclic static imports and passes at exact 500000-byte boundaries', async () => {
  await withTempBundleFixture(
    {
      'assets/a-entry.js': 200_000,
      'assets/b-left.js': 150_000,
      'assets/c-right.js': 150_000,
      'assets/d-lazy.js': 500_000,
    },
    {
      'index.html': {
        file: 'assets/a-entry.js',
        src: 'index.html',
        isEntry: true,
        imports: ['_b-left.js', '_c-right.js'],
        dynamicImports: ['src/lazy-panel.tsx'],
      },
      '_b-left.js': {
        file: 'assets/b-left.js',
        imports: ['_c-right.js'],
      },
      '_c-right.js': {
        file: 'assets/c-right.js',
        imports: ['_b-left.js'],
      },
      'src/lazy-panel.tsx': {
        file: 'assets/d-lazy.js',
        src: 'src/lazy-panel.tsx',
        isDynamicEntry: true,
        imports: ['_c-right.js'],
      },
    },
    async (manifestPath) => {
      const result = await analyzeWebBundle(manifestPath);
      assert.equal(result.pass, true);
      assert.equal(result.initialBytes, 500_000);
      assert.deepEqual(result.initialFiles, [
        'assets/a-entry.js',
        'assets/b-left.js',
        'assets/c-right.js',
      ]);
      assert.deepEqual(result.oversizedChunks, []);
      assert.deepEqual(result.chunks, [
        { file: 'assets/a-entry.js', bytes: 200_000, initial: true },
        { file: 'assets/b-left.js', bytes: 150_000, initial: true },
        { file: 'assets/c-right.js', bytes: 150_000, initial: true },
        { file: 'assets/d-lazy.js', bytes: 500_000, initial: false },
      ]);
    },
  );
});

test('excludes dynamic imports from initialBytes but fails when a dynamic chunk exceeds 500000 bytes', async () => {
  await withTempBundleFixture(
    {
      'assets/a-entry.js': 180_000,
      'assets/b-heavy-lazy.js': 500_001,
      'assets/c-lazy-helper.js': 110_000,
    },
    {
      'index.html': {
        file: 'assets/a-entry.js',
        isEntry: true,
        dynamicImports: ['src/heavy-lazy.tsx'],
      },
      'src/heavy-lazy.tsx': {
        file: 'assets/b-heavy-lazy.js',
        isDynamicEntry: true,
        imports: ['_c-lazy-helper.js'],
      },
      '_c-lazy-helper.js': {
        file: 'assets/c-lazy-helper.js',
      },
    },
    async (manifestPath) => {
      const result = await analyzeWebBundle(manifestPath);
      assert.equal(result.pass, false);
      assert.equal(result.initialBytes, 180_000);
      assert.deepEqual(result.initialFiles, ['assets/a-entry.js']);
      assert.deepEqual(result.oversizedChunks, [
        { file: 'assets/b-heavy-lazy.js', bytes: 500_001 },
      ]);
      assert.deepEqual(result.chunks, [
        { file: 'assets/a-entry.js', bytes: 180_000, initial: true },
        { file: 'assets/b-heavy-lazy.js', bytes: 500_001, initial: false },
        { file: 'assets/c-lazy-helper.js', bytes: 110_000, initial: false },
      ]);
    },
  );
});

test('fails when aggregate initial static JS closure exceeds 500000 bytes even when every individual chunk is below limit', async () => {
  await withTempBundleFixture(
    {
      'assets/a-entry.js': 180_000,
      'assets/b-vendor.js': 170_000,
      'assets/c-ui.js': 150_001,
    },
    {
      'index.html': {
        file: 'assets/a-entry.js',
        isEntry: true,
        imports: ['_b-vendor.js'],
      },
      '_b-vendor.js': {
        file: 'assets/b-vendor.js',
        imports: ['_c-ui.js'],
      },
      '_c-ui.js': {
        file: 'assets/c-ui.js',
      },
    },
    async (manifestPath) => {
      const result = await analyzeWebBundle(manifestPath);
      assert.equal(result.pass, false);
      assert.equal(result.initialBytes, 500_001);
      assert.deepEqual(result.initialFiles, [
        'assets/a-entry.js',
        'assets/b-vendor.js',
        'assets/c-ui.js',
      ]);
      assert.deepEqual(result.oversizedChunks, []);
    },
  );
});

test('deduplicates duplicate manifest aliases referencing the same output JS file', async () => {
  await withTempBundleFixture(
    {
      'assets/a-entry.js': 220_000,
      'assets/b-shared.js': 260_000,
    },
    {
      'index.html': {
        file: 'assets/a-entry.js',
        isEntry: true,
        imports: ['_shared-alias-1.js', '_shared-alias-2.js'],
      },
      'src/main.tsx': {
        file: 'assets/a-entry.js',
        isEntry: true,
        imports: ['_shared-alias-1.js'],
      },
      '_shared-alias-1.js': {
        file: 'assets/b-shared.js',
      },
      '_shared-alias-2.js': {
        file: 'assets/b-shared.js',
      },
    },
    async (manifestPath) => {
      const result = await analyzeWebBundle(manifestPath);
      assert.equal(result.pass, true);
      assert.equal(result.initialBytes, 480_000);
      assert.deepEqual(result.initialFiles, ['assets/a-entry.js', 'assets/b-shared.js']);
      assert.deepEqual(result.oversizedChunks, []);
      assert.deepEqual(result.chunks, [
        { file: 'assets/a-entry.js', bytes: 220_000, initial: true },
        { file: 'assets/b-shared.js', bytes: 260_000, initial: true },
      ]);
    },
  );
});

test('throws on malformed manifest, missing entry, unresolved import keys, or missing asset files', async () => {
  await expectBundleError({}, '{malformed-json');
  await expectBundleError(
    { 'assets/a-chunk.js': 1024 },
    { '_chunk.js': { file: 'assets/a-chunk.js' } },
  );
  await expectBundleError(
    { 'assets/a-entry.js': 1024 },
    { 'index.html': { file: 'assets/a-entry.js', isEntry: true, imports: ['_missing.js'] } },
  );
  await expectBundleError(
    { 'assets/a-entry.js': 1024 },
    {
      'index.html': {
        file: 'assets/a-entry.js',
        isEntry: true,
        dynamicImports: ['src/missing-lazy.tsx'],
      },
    },
  );
  await expectBundleError(
    {},
    { 'index.html': { file: 'assets/missing-disk-file.js', isEntry: true } },
  );
});

test('throws on relative path traversal, absolute paths, or backslash paths in manifest file fields', async () => {
  for (const unsafeFile of [
    '../outside.js',
    'assets/../../outside.js',
    '/abs/outside.js',
    'D:/abs/outside.js',
    'assets\\backslash.js',
  ]) {
    await expectBundleError(
      { 'assets/a-entry.js': 1024 },
      { 'index.html': { file: unsafeFile, isEntry: true } },
    );
  }
});
