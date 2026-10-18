import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_BYTES = 500_000;
const isJavaScript = (file) => /\.(?:m|c)?js$/i.test(file);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function inside(root, target) {
  const name = relative(root, target);
  return name !== '' && !name.startsWith('..') && !isAbsolute(name);
}

/** Build-byte evidence only. Does not execute assets or measure browser performance. */
export function analyzeWebBundle(manifestPath) {
  if (typeof manifestPath !== 'string' || !manifestPath) throw new Error('Manifest path required');
  const absoluteManifest = resolve(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8'));
  } catch {
    throw new Error('Missing or invalid build manifest JSON');
  }
  if (!isRecord(manifest)) throw new Error('Invalid build manifest object');
  const manifestDirectory = dirname(absoluteManifest);
  const root = realpathSync(
    basename(manifestDirectory) === '.vite' ? dirname(manifestDirectory) : manifestDirectory,
  );
  const entries = Object.entries(manifest);
  const filesByKey = new Map();
  const files = new Map();
  for (const [key, entry] of entries) {
    if (!isRecord(entry) || typeof entry.file !== 'string' || !entry.file) {
      throw new Error(`Invalid manifest asset: ${key}`);
    }
    for (const flag of ['isEntry', 'isDynamicEntry']) {
      if (Object.hasOwn(entry, flag) && typeof entry[flag] !== 'boolean') {
        throw new Error(`Invalid manifest flag ${flag}: ${key}`);
      }
    }
    const name = entry.file;
    if (
      name.includes('\\') ||
      name.split('/').includes('..') ||
      isAbsolute(name) ||
      /^[a-z][\w+.-]*:/i.test(name)
    ) {
      throw new Error(`Unsafe build asset path: ${key}`);
    }
    const path = resolve(root, name);
    if (!inside(root, path)) throw new Error(`Build asset escapes directory: ${key}`);
    let actual;
    try {
      actual = realpathSync(path);
      if (!inside(root, actual) || !statSync(actual).isFile()) throw new Error('Not an owned file');
    } catch {
      throw new Error(`Missing or unsafe build asset: ${key}`);
    }
    const normalized = relative(root, actual).replaceAll('\\', '/');
    if (isJavaScript(name) !== isJavaScript(normalized)) {
      throw new Error(`Unsafe extension-changing build asset alias: ${key}`);
    }
    filesByKey.set(key, normalized);
    if (isJavaScript(normalized)) files.set(normalized, statSync(actual).size);
    for (const field of ['imports', 'dynamicImports']) {
      const imports = Object.hasOwn(entry, field) ? entry[field] : [];
      if (
        !Array.isArray(imports) ||
        imports.some(
          (dependency) => typeof dependency !== 'string' || !Object.hasOwn(manifest, dependency),
        )
      ) {
        throw new Error(`Invalid or unresolved ${field}: ${key}`);
      }
    }
  }
  const entryKeys = entries
    .filter(([, entry]) => entry.isEntry === true && isJavaScript(entry.file))
    .map(([key]) => key);
  if (!entryKeys.length) throw new Error('No JavaScript entry in build manifest');
  const visited = new Set();
  const initial = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const name = filesByKey.get(key);
    if (files.has(name)) initial.add(name);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  entryKeys.forEach(visit);
  const chunks = [...files]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, bytes]) => ({ file, bytes, initial: initial.has(file) }));
  const initialFiles = chunks.filter((chunk) => chunk.initial).map((chunk) => chunk.file);
  const initialBytes = chunks
    .filter((chunk) => chunk.initial)
    .reduce((sum, chunk) => sum + chunk.bytes, 0);
  const oversizedChunks = chunks
    .filter((chunk) => chunk.bytes > BUDGET_BYTES)
    .map(({ file, bytes }) => ({ file, bytes }));
  return {
    pass: initialBytes <= BUDGET_BYTES && oversizedChunks.length === 0,
    initialBytes,
    initialFiles,
    chunks,
    oversizedChunks,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/check-web-bundle-budget.mjs <build-manifest.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = analyzeWebBundle(process.argv[2]);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.pass ? 0 : 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
