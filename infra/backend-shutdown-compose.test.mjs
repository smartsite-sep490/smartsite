import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('actual local Compose gives the Backend 45s before forced stop, beyond its 30s HTTP drain', () => {
  const owned = mkdtempSync(join(tmpdir(), 'smartsite-shutdown-config-'));
  const emptyEnv = join(owned, 'empty.env');
  writeFileSync(emptyEnv, '', { flag: 'wx' });
  const environment = Object.fromEntries(
    [
      'PATH',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'ProgramData',
      'ProgramFiles',
      'ProgramFiles(x86)',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', emptyEnv, '-f', 'infra/compose.yaml', 'config', '--format', 'json'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: environment,
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(result.error, undefined, 'Compose CLI must be available; no containers are started');
  assert.equal(result.status, 0, 'Actual Compose file must render with an empty env file');
  const config = JSON.parse(result.stdout);
  assert.equal(config.services.backend.stop_grace_period, '45s');
  assert.equal(config.services.backend.build.dockerfile, 'infra/docker/backend.Dockerfile');
  assert.equal(config.services.backend.environment.DATABASE_SCHEMA, 'public');
  assert.equal(config.services.migrate.environment.DATABASE_SCHEMA, 'public');
  // Keep the tiny empty-env attempt artifact; no runtime .env or existing output is removed.
});
