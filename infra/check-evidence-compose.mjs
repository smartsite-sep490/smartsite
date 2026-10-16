import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateEvidenceConfig } from './evidence-compose-validation.mjs';

// Validate the actual Compose merge without a daemon, runtime .env, or real media.
const repo = fileURLToPath(new URL('../', import.meta.url));
const owned = mkdtempSync(join(tmpdir(), 'smartsite-evidence-config-'));
const emptyEnv = join(owned, 'empty.env');
const creationEnabled = join(owned, 'creation-enabled.yaml');
writeFileSync(emptyEnv, '');
const environment = {
  ...process.env,
  SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-compose-validation-token-only',
  SMARTSITE_AI_IDENTITY_TEMPLATE_ENCRYPTION_KEY: '',
  SMARTSITE_AI_IDENTITY_DEMO_MODE: 'false',
  AI_CONFIGURATION_CAMERA_IDS: '',
  SMARTSITE_WEB_API_URL: 'http://127.0.0.1:3000',
};
const args = [
  'compose',
  '--env-file',
  emptyEnv,
  '-f',
  'infra/compose.yaml',
  '-f',
  'infra/compose.evidence.yaml',
  'config',
  '--format',
  'json',
];
try {
  delete environment.EVIDENCE_LOCAL_HOST_ROOT;
  const missing = spawnSync('docker', args, {
    cwd: repo,
    env: environment,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(missing.error, undefined, 'Docker Compose CLI must be available');
  assert.notEqual(missing.status, 0, 'Missing evidence root must fail configuration');
  assert.match(missing.stderr, /EVIDENCE_LOCAL_HOST_ROOT/);
  const configured = spawnSync('docker', args, {
    cwd: repo,
    env: { ...environment, EVIDENCE_LOCAL_HOST_ROOT: owned },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(configured.error, undefined, 'Compose configuration must finish');
  assert.equal(configured.status, 0, 'Explicit evidence root must render');
  const config = JSON.parse(configured.stdout);
  // Verify this Compose version distinguishes forbidden creation from omitted false.
  // JSON is valid YAML; this synthetic overlay never starts a container.
  writeFileSync(
    creationEnabled,
    JSON.stringify({
      services: {
        backend: {
          volumes: [
            {
              type: 'bind',
              source: owned,
              target: '/var/lib/smartsite/evidence',
              read_only: true,
              bind: { create_host_path: true },
            },
          ],
        },
      },
    }),
  );
  const unsafe = spawnSync(
    'docker',
    [...args.slice(0, -3), '-f', creationEnabled, ...args.slice(-3)],
    {
      cwd: repo,
      env: { ...environment, EVIDENCE_LOCAL_HOST_ROOT: owned },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert.equal(unsafe.error, undefined);
  assert.equal(unsafe.status, 0, 'Synthetic creation-enabled control must render');
  const unsafeConfig = JSON.parse(unsafe.stdout);
  const unsafeCreation = unsafeConfig.services.backend.volumes.find(
    (volume) => volume.target === '/var/lib/smartsite/evidence',
  ).bind.create_host_path;
  assert.ok(unsafeCreation === true || unsafeCreation === undefined);
  const encoding = { falseIsOmitted: unsafeCreation === true };
  assertPrivateEvidenceConfig(config, owned, encoding);
  assert.throws(() => assertPrivateEvidenceConfig(unsafeConfig, owned, encoding));
  console.log(
    'PASS: required private evidence root, matching reader path, read-only mount, no implicit directory creation, no Web mount',
  );
} finally {
  assert.equal(dirname(resolve(owned)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(owned).startsWith('smartsite-evidence-config-'));
  unlinkSync(emptyEnv);
  if (existsSync(creationEnabled)) unlinkSync(creationEnabled);
  rmdirSync(owned);
}
