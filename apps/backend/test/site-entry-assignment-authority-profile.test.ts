import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  SITE_ENTRY_ASSIGNMENT_RESPONSE_BODY,
  SITE_ENTRY_ASSIGNMENT_RESPONSE_SHA256,
} from '../src/common/configuration/site-entry-assignment-authority-profile-v1.js';
import { MAIN_AUTHORITY_V2_FUNCTION_PROFILES } from '../src/common/configuration/main-team-authority-function-profiles.js';
import { MAIN_AUTHORITY_CUTOVER_RELEASE_FILES } from '../src/modules/zones/main-authority-cutover-release.js';

test('current assignment response pins exact LF/CRLF bytes without retired gate data', () => {
  const lf = SITE_ENTRY_ASSIGNMENT_RESPONSE_BODY.replaceAll('\r\n', '\n');
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  assert.equal(sha(lf), SITE_ENTRY_ASSIGNMENT_RESPONSE_SHA256[0]);
  assert.equal(sha(lf.replaceAll('\n', '\r\n')), SITE_ENTRY_ASSIGNMENT_RESPONSE_SHA256[1]);
  assert(!/gate_id|gateId/.test(lf));
  assert(lf.includes("'zoneIds',zone_ids,'status',status"));
});

test('frozen legacy assignment response profile is not widened or replaced', () => {
  const profile = MAIN_AUTHORITY_V2_FUNCTION_PROFILES.find(
    (p) => p.name === 'mf06_assignment_response',
  );
  assert.deepEqual(profile?.body_sha256, [
    '1543c3e4859837d2f765e915cfe8bf39358a2982408d41e1757120ccd4d55917',
    '9419d6b4ab054aa17cb9279fd7a3707943ec48a083f8f3aae68503a0e5d1c0ff',
  ]);
});

test('release pins include the new profile used by capture preflight', () => {
  assert(
    MAIN_AUTHORITY_CUTOVER_RELEASE_FILES.includes(
      'apps/backend/src/common/configuration/site-entry-assignment-authority-profile-v1.ts',
    ),
  );
});
