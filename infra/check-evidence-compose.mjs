import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Validate the actual Compose merge without a daemon, runtime .env, or real media.
const repo = fileURLToPath(new URL('../', import.meta.url));
const owned = mkdtempSync(join(tmpdir(), 'smartsite-evidence-config-'));
const emptyEnv = join(owned, 'empty.env');
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
  const mount = config.services.backend.volumes.find(
    (v) => v.target === '/var/lib/smartsite/evidence',
  );
  assert.equal(mount.type, 'bind');
  assert.equal(resolve(mount.source), resolve(owned));
  assert.equal(mount.read_only, true);
  assert.equal(mount.bind.create_host_path, false);
  assert.equal(config.services.backend.environment.EVIDENCE_LOCAL_ROOT, mount.target);
  assert.equal(config.services.web.volumes?.some((v) => v.target === mount.target) ?? false, false);
  console.log(
    'PASS: required private evidence root, matching reader path, read-only mount, no implicit directory creation, no Web mount',
  );
} finally {
  assert.equal(dirname(resolve(owned)).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert.ok(basename(owned).startsWith('smartsite-evidence-config-'));
  unlinkSync(emptyEnv);
  rmdirSync(owned);
}
