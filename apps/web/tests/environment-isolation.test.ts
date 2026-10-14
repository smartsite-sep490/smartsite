import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { loadEnv } from 'vite';
import { expect, test } from 'vitest';
import config from '../vitest.config';

test('does not load operator dotenv settings into fixture-driven Web tests', () => {
  const owned = mkdtempSync(join(tmpdir(), 'smartsite-web-test-env-'));
  try {
    writeFileSync(
      join(owned, '.env.test.local'),
      'VITE_SMARTSITE_TEST_FILE_SENTINEL=operator-only\n',
    );
    const environment = loadEnv('test', config.envDir ?? owned, 'VITE_SMARTSITE_TEST_FILE_');
    expect(environment.VITE_SMARTSITE_TEST_FILE_SENTINEL).toBeUndefined();
  } finally {
    expect(dirname(resolve(owned))).toBe(resolve(tmpdir()));
    expect(basename(owned).startsWith('smartsite-web-test-env-')).toBe(true);
    rmSync(owned, { recursive: true, force: true });
  }
});
