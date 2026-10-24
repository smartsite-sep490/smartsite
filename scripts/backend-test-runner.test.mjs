import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

for (const explicit of [false, true]) {
  test(`Backend runner supplies original source root (${explicit ? 'explicit archive override' : 'CI checkout'})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'smartsite-runner-'));
    const backend = join(root, 'apps', 'backend');
    for (const path of [
      'scripts',
      'test/support/legacy24',
      '.test-build/src/config',
      '.test-build/test',
    ]) {
      mkdirSync(join(backend, path), { recursive: true });
    }
    cpSync(
      new URL('../apps/backend/scripts/run-tests.mjs', import.meta.url),
      join(backend, 'scripts/run-tests.mjs'),
    );
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(
      join(backend, '.test-build/src/config/environment.js'),
      'export const validateEnvironment = () => ({NODE_ENV:"test"});',
    );
    const expected = explicit ? join(root, 'original-checkout') : root;
    writeFileSync(
      join(backend, '.test-build/test/source.test.js'),
      `import assert from 'node:assert/strict';\nimport {resolve} from 'node:path';\nassert.equal(resolve(process.env.SMARTSITE_TEST_SOURCE_REPO ?? ''), ${JSON.stringify(expected)});`,
    );
    const env = { ...process.env };
    delete env.SMARTSITE_TEST_SOURCE_REPO;
    delete env.NODE_TEST_CONTEXT;
    if (explicit) env.SMARTSITE_TEST_SOURCE_REPO = expected;
    const result = spawnSync(process.execPath, [join(backend, 'scripts/run-tests.mjs')], {
      env,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
