import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = /^[0-9a-f]{64}$/;
const safePath = /^[a-zA-Z0-9_./-]+$/;

function pins(value) {
  if (!Array.isArray(value) || !value.length || value.length > 512)
    throw new Error('Invalid release pin inventory');
  const seen = new Set();
  for (const entry of value) {
    if (
      typeof entry?.path !== 'string' ||
      entry.path.length > 256 ||
      !safePath.test(entry.path) ||
      isAbsolute(entry.path) ||
      entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      !digest.test(entry.sha256) ||
      seen.has(entry.path)
    )
      throw new Error('Invalid or duplicate release pin');
    seen.add(entry.path);
  }
  return value;
}

async function pinnedBytes(root, entry) {
  const expected = resolve(root, entry.path);
  const actual = await realpath(expected);
  const within = relative(root, actual);
  if (
    actual !== expected ||
    !within ||
    within === '..' ||
    within.startsWith(`..${sep}`) ||
    isAbsolute(within)
  )
    throw new Error('Release pin escapes its root or uses a link');
  const bytes = await readFile(actual);
  if (bytes.length > 2 * 1024 * 1024 || hash(bytes) !== entry.sha256)
    throw new Error('Reviewed release bytes do not match their pin');
  return bytes;
}

/** Copies an existing reviewed artifact; never creates or upgrades review provenance. */
export async function packageReviewedRelease({ manifestPath, sourceRoot, runtimeRoot, output }) {
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length > 2 * 1024 * 1024) throw new Error('Release manifest too large');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.version !== 'MF06_REVIEWED_CUTOVER_RELEASE_V1' ||
    manifest.provenance !== 'OPERATIONAL_REVIEWED' ||
    !/^[0-9a-f]{40}$/.test(manifest.releaseCommit)
  )
    throw new Error('An existing operationally reviewed release is required');
  const source = await realpath(sourceRoot);
  const runtime = await realpath(runtimeRoot);
  const files = [];
  let size = 0;
  for (const [root, entries, copy] of [
    [source, pins(manifest.files), true],
    [runtime, pins(manifest.runtimeFiles), false],
  ]) {
    for (const entry of entries) {
      const bytes = await pinnedBytes(root, entry);
      size += bytes.length;
      if (size > 16 * 1024 * 1024) throw new Error('Release bytes exceed budget');
      if (copy) files.push({ path: entry.path, bytes });
    }
  }
  // Complete all pin checks before writing anything. Existing artifacts are immutable.
  await mkdir(output);
  for (const file of files) {
    const target = resolve(output, 'source', file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes, { flag: 'wx' });
  }
  await writeFile(resolve(output, 'manifest.json'), manifestBytes, { flag: 'wx' });
  const receipt = {
    manifestPath: '/app/reviewed-manifest.json',
    reviewedManifestSha256: hash(manifestBytes),
    releaseRoot: '/app/reviewed-source',
    releaseCommit: manifest.releaseCommit,
  };
  await writeFile(resolve(output, 'release-info.json'), JSON.stringify(receipt) + '\n', {
    flag: 'wx',
  });
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      throw new Error('Usage: package-mf06-release.mjs <reviewed-manifest> <new-output-directory>');
    const runtimeRoot = resolve('apps/backend/dist');
    const output = resolve(process.argv[3]);
    const receipt = await packageReviewedRelease({
      manifestPath: resolve(process.argv[2]),
      sourceRoot: process.cwd(),
      runtimeRoot,
      output,
    });
    const { verifyMainAuthorityCutoverRelease } = await import(
      pathToFileURL(resolve(runtimeRoot, 'modules/zones/main-authority-cutover-release.js')).href
    );
    await verifyMainAuthorityCutoverRelease(
      {
        ...receipt,
        manifestPath: resolve(output, 'manifest.json'),
        releaseRoot: resolve(output, 'source'),
      },
      'production',
    );
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error('MF06 reviewed release packaging failed:', error.message);
    process.exitCode = 1;
  }
}
