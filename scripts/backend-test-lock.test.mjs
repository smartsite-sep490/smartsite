import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { acquireTestBuildLock } from '../apps/backend/scripts/test-build-lock.mjs';

test('another test process cannot acquire the shared build tree or remove its files', () => {
  const root = resolve(tmpdir());
  const folder = mkdtempSync(join(root, 'smartsite-backend-test-lock-'));
  const lock = join(folder, 'test.lock');
  const marker = join(folder, 'compiled-test.js');
  writeFileSync(marker, 'compiled test must survive');
  const release = acquireTestBuildLock(lock);
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import { acquireTestBuildLock } from ${JSON.stringify(new URL('../apps/backend/scripts/test-build-lock.mjs', import.meta.url).href)};
      try { acquireTestBuildLock(process.argv[1])(); process.exitCode = 2; }
      catch (error) { console.error(error.message); process.exitCode = 1; }
    `,
        lock,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already reserved/);
    assert.equal(readFileSync(marker, 'utf8'), 'compiled test must survive');
    release();
    acquireTestBuildLock(lock)();
    assert.equal(readFileSync(marker, 'utf8'), 'compiled test must survive');
  } finally {
    release();
    assert.equal(dirname(resolve(folder)), root);
    rmSync(folder, { recursive: true, force: true });
  }
});
