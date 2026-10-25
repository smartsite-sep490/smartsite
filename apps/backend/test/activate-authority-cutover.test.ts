import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import {
  assertOperationalCutoverManifest,
  formatCutoverStdoutReceipt,
  formatSanitizedCutoverError,
  MAX_CUTOVER_STDIN_BYTES,
  parseCutoverStdinPayload,
  readCutoverStdinPayload,
  resolveCutoverOperatorEnvironment,
} from '../src/scripts/activate-authority-cutover.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
const CUTOVER_MANIFEST_PATH =
  process.platform === 'win32'
    ? 'D:/Ky9-FPT/SmartSiteData/release/manifest.json'
    : join(tmpdir(), 'smartsite-data', 'release', 'manifest.json');
const CUTOVER_RELEASE_ROOT =
  process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSite' : join(tmpdir(), 'smartsite');
const VALID_ENV: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://operator:strong_prod_pass_123@db.example.internal:5432/smartsite',
  CORS_ORIGINS: 'https://smartsite.example.com',
  AUTH_JWT_SECRET: 'prod_jwt_secret_minimum_32_characters_long_ok',
  SMARTSITE_AI_SERVICE_TOKEN: 'prod_ai_service_token_minimum_32_characters_ok',
  MF06_CUTOVER_MANIFEST_PATH: CUTOVER_MANIFEST_PATH,
  MF06_CUTOVER_MANIFEST_SHA256: 'a'.repeat(64),
  MF06_CUTOVER_RELEASE_ROOT: CUTOVER_RELEASE_ROOT,
  MF06_CUTOVER_RELEASE_COMMIT: 'b'.repeat(40),
};

test('stdin payload parser accepts strict ACTIVATE payload and normalizes epoch UUID', async () => {
  const nullEpoch = parseCutoverStdinPayload(
    JSON.stringify({ action: 'ACTIVATE', accessToken: TOKEN, expectedPreviousEpochId: null }),
  );
  assert.deepEqual(nullEpoch, {
    action: 'ACTIVATE',
    accessToken: TOKEN,
    expectedPreviousEpochId: null,
  });

  const stream = Readable.from([
    Buffer.from(
      JSON.stringify({
        action: 'ACTIVATE',
        accessToken: TOKEN,
        expectedPreviousEpochId: 'BA41B54E-6522-4579-818E-CC46E9CDFAC5',
      }),
    ),
  ]);
  const withEpoch = await readCutoverStdinPayload(stream);
  assert.equal(withEpoch.expectedPreviousEpochId, 'ba41b54e-6522-4579-818e-cc46e9cdfac5');
});

test('stdin payload parser rejects oversized input, unknown keys, and malformed fields', async () => {
  for (const invalidJson of ['', '{', 'null', '[]'])
    assert.throws(() => parseCutoverStdinPayload(invalidJson));
  const oversized = Readable.from([Buffer.alloc(MAX_CUTOVER_STDIN_BYTES + 1, 0x61)]);
  await assert.rejects(() => readCutoverStdinPayload(oversized), /stdin payload/i);

  for (const invalid of [
    { action: 'ACTIVATE', accessToken: TOKEN, expectedPreviousEpochId: null, approved: true },
    { action: 'DRY_RUN', accessToken: TOKEN, expectedPreviousEpochId: null },
    { action: 'ACTIVATE', accessToken: TOKEN },
    { action: 'ACTIVATE', accessToken: TOKEN, expectedPreviousEpochId: 'not-an-epoch' },
    { action: 'ACTIVATE', accessToken: 'token with spaces', expectedPreviousEpochId: null },
  ]) {
    assert.throws(() => parseCutoverStdinPayload(JSON.stringify(invalid)));
  }
});

test('environment guard requires explicit DB/NODE_ENV/release pins and rejects worker/enqueue or argv', () => {
  const resolved = resolveCutoverOperatorEnvironment(VALID_ENV, []);
  assert.equal(resolved.env.NODE_ENV, 'production');
  assert.equal(resolved.env.MF06_ENQUEUE_ENABLED, false);
  assert.equal(resolved.env.MF06_WORKER_ENABLED, false);
  assert.equal(resolved.release.reviewedManifestSha256, 'a'.repeat(64));

  assert.throws(() => resolveCutoverOperatorEnvironment(VALID_ENV, ['--token=secret']));
  assert.throws(() =>
    resolveCutoverOperatorEnvironment(
      { ...VALID_ENV, NODE_ENV: 'test', AUTH_JWT_SECRET: undefined },
      [],
    ),
  );
  assert.throws(() => resolveCutoverOperatorEnvironment({ ...VALID_ENV, DATABASE_URL: undefined }));
  assert.throws(() => resolveCutoverOperatorEnvironment({ ...VALID_ENV, NODE_ENV: undefined }));
  assert.throws(() =>
    resolveCutoverOperatorEnvironment({ ...VALID_ENV, MF06_CUTOVER_MANIFEST_PATH: undefined }),
  );
  assert.throws(() =>
    resolveCutoverOperatorEnvironment({ ...VALID_ENV, MF06_ENQUEUE_ENABLED: 'true' }),
  );
  assert.throws(() =>
    resolveCutoverOperatorEnvironment({ ...VALID_ENV, MF06_WORKER_ENABLED: 'true' }),
  );
});

test('manifest provenance, receipt formatter, and sanitized error behave safely', async () => {
  assert.equal(
    assertOperationalCutoverManifest({ provenance: 'OPERATIONAL_REVIEWED' }).provenance,
    'OPERATIONAL_REVIEWED',
  );
  assert.throws(() => assertOperationalCutoverManifest({ provenance: 'SYNTHETIC_TEST' }));

  const stdout = formatCutoverStdoutReceipt({
    epochId: 'ba41b54e-6522-4579-818e-cc46e9cdfac5',
    commandId: '11111111-2222-4333-8444-555555555555',
    capturedAt: '2026-10-22T01:00:00.000000Z',
    snapshotHash: 'c'.repeat(64),
    manifestSha256: 'a'.repeat(64),
    provenance: 'OPERATIONAL_REVIEWED',
    commitStatus: 'COMMITTED',
    witnessConfirmed: true,
    accessToken: 'secret-token-must-not-leak',
  } as never);
  assert.equal(stdout.includes('secret-token-must-not-leak'), false);
  assert.equal(JSON.parse(stdout).commitStatus, 'COMMITTED');

  const errText = formatSanitizedCutoverError(
    new PublicHttpException(503, { code: 'SERVICE_UNAVAILABLE', message: 'secret://db' }),
  );
  assert.equal(errText.includes('secret://db'), false);
  assert.match(errText, /commit may have occurred/i);
  assert.match(errText, /inspect/i);
  assert.equal(/rollback|rolled back/i.test(errText), false);
});
