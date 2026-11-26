import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const { packageReviewedRelease } = await import('./package-mf06-release.mjs');

async function fixture(t) {
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, 'smartsite-release-'));
  t.after(async () => {
    assert.equal(dirname(root), temporaryRoot);
    await rm(root, { recursive: true, force: true });
  });
  const sourceRoot = join(root, 'repo');
  const runtimeRoot = join(root, 'dist');
  await mkdir(join(sourceRoot, 'apps/backend/src'), { recursive: true });
  await mkdir(runtimeRoot);
  await writeFile(join(sourceRoot, 'apps/backend/src/example.ts'), 'export const answer = 42;\n');
  await writeFile(join(runtimeRoot, 'example.js'), 'export const answer = 42;\n');
  const manifest = {
    version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
    provenance: 'OPERATIONAL_REVIEWED',
    releaseCommit: 'a'.repeat(40),
    files: [{ path: 'apps/backend/src/example.ts', sha256: sha('export const answer = 42;\n') }],
    runtimeFiles: [{ path: 'example.js', sha256: sha('export const answer = 42;\n') }],
  };
  const manifestPath = join(root, 'reviewed.json');
  const save = () => writeFile(manifestPath, JSON.stringify(manifest) + '\n');
  await save();
  return {
    root,
    sourceRoot,
    runtimeRoot,
    manifest,
    manifestPath,
    save,
    output: join(root, 'bundle'),
  };
}

test('packages the exact reviewed manifest and source bytes with matching runtime pins', async (t) => {
  const input = await fixture(t);
  const receipt = await packageReviewedRelease(input);
  const original = await readFile(input.manifestPath);
  assert.deepEqual(await readFile(join(input.output, 'manifest.json')), original);
  assert.deepEqual(
    await readFile(join(input.output, 'source/apps/backend/src/example.ts')),
    await readFile(join(input.sourceRoot, 'apps/backend/src/example.ts')),
  );
  assert.equal(receipt.reviewedManifestSha256, sha(original));
  assert.equal(receipt.releaseCommit, 'a'.repeat(40));
  assert.equal(receipt.releaseRoot, '/app/reviewed-source');
  assert.equal(receipt.manifestPath, '/app/reviewed-manifest.json');
});

test('rejects missing or changed source and runtime before creating an artifact', async (t) => {
  for (const kind of ['source', 'runtime']) {
    const input = await fixture(t);
    const file =
      kind === 'source'
        ? join(input.sourceRoot, 'apps/backend/src/example.ts')
        : join(input.runtimeRoot, 'example.js');
    await writeFile(file, 'changed\n');
    await assert.rejects(packageReviewedRelease(input), /pin|bytes/i);
    await assert.rejects(readFile(join(input.output, 'manifest.json')), { code: 'ENOENT' });
    await rm(file);
    await assert.rejects(packageReviewedRelease(input), /ENOENT/);
  }
});

test('does not invent operational review or permit duplicate and escaping pin paths', async (t) => {
  for (const update of [
    (m) => {
      m.provenance = 'SYNTHETIC_TEST';
    },
    (m) => {
      delete m.provenance;
    },
    (m) => {
      m.files.push({ ...m.files[0] });
    },
    (m) => {
      m.runtimeFiles[0].path = '../outside.js';
    },
    (m) => {
      m.files[0].path = '/outside.ts';
    },
    (m) => {
      m.files[0].sha256 = 'not-a-hash';
    },
    (m) => {
      m.runtimeFiles = [];
    },
  ]) {
    const input = await fixture(t);
    update(input.manifest);
    await input.save();
    await assert.rejects(packageReviewedRelease(input));
  }
});

test('refuses to overwrite a previous artifact', async (t) => {
  const input = await fixture(t);
  await packageReviewedRelease(input);
  await assert.rejects(packageReviewedRelease(input), { code: 'EEXIST' });
});
