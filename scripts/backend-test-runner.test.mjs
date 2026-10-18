import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

for (const refusal of [false, true]) {
  test(`integration runner owns and cleans its namespace (${refusal ? 'migration refusal' : 'success'})`, () => {
    const base = fileURLToPath(new URL('../.worktrees/runner-tests/', import.meta.url));
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, 'case-'));
    const backend = join(root, 'apps', 'backend');
    const receipt = join(root, 'calls.jsonl');
    try {
      writeFileSync(receipt, '');
      for (const path of [
        'scripts',
        'test/support/legacy24',
        '.test-build/src/config',
        '.test-build/test/support',
        '.test-build/test/integration',
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
      writeFileSync(
        join(backend, '.test-build/test/support/test-environment.js'),
        'export const resolveTestDatabaseUrl = () => "postgresql://smartsite_test:synthetic@127.0.0.1:5433/smartsite_test";',
      );
      writeFileSync(
        join(backend, '.test-build/test/support/test-data-source.js'),
        `
        import assert from 'node:assert/strict';
        import {appendFileSync} from 'node:fs';
        const record = value => appendFileSync(${JSON.stringify(receipt)}, JSON.stringify(value)+'\\n');
        export default {
          isInitialized:false,
          async initialize() {
            assert.match(process.env.SMARTSITE_TEST_SCHEMA ?? '', /^isolated_test_[a-f0-9]{32}$/);
            this.isInitialized=true;
          },
          async query(sql) {record(sql);},
          async runMigrations() {
            record('migrate');
            ${refusal ? "throw new Error('Synthetic refusal');" : ''}
          },
          async destroy() {this.isInitialized=false;record('destroy');}
        };
      `,
      );
      writeFileSync(
        join(backend, '.test-build/test/integration/scope.test.js'),
        `
        import assert from 'node:assert/strict';
        assert.match(process.env.SMARTSITE_TEST_SCHEMA ?? '', /^isolated_test_[a-f0-9]{32}$/);
      `,
      );
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.SMARTSITE_TEST_SCHEMA;
      const result = spawnSync(
        process.execPath,
        [join(backend, 'scripts/run-tests.mjs'), '--integration'],
        { env, encoding: 'utf8', windowsHide: true },
      );
      assert.equal(result.status, refusal ? 1 : 0, result.stdout + result.stderr);
      const calls = readFileSync(receipt, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      const create = calls.find((sql) => sql.startsWith('CREATE SCHEMA'));
      assert.match(create ?? '', /^CREATE SCHEMA "isolated_test_[a-f0-9]{32}"$/);
      const schema = create.match(/"([^"]+)"/)[1];
      assert(calls.includes(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));
      assert(calls.indexOf(create) < calls.indexOf('migrate'));
      assert.equal(calls.at(-1), 'destroy');
    } finally {
      assert(root.startsWith(base));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
