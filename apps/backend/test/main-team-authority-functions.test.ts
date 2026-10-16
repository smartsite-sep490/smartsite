import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { MAIN_AUTHORITY_V2_FUNCTION_PROFILES } from '../src/common/configuration/main-team-authority-function-profiles.js';
import { Mf06TeamAuthorityHistory1792281600000 } from '../src/database/migrations/1792281600000-Mf06TeamAuthorityHistory.js';

for (const functionName of ['mf06_authority_baseline_capture', 'mf06_capture_main_authority']) {
  test(`V2 ${functionName} fingerprint matches emitted SQL including exact LF/CRLF bodies`, async () => {
    const statements: string[] = [];
    const runner = {
      hasColumn: async () => true,
      query: async (sql: string) => {
        statements.push(sql);
      },
    } as unknown as QueryRunner;
    await new Mf06TeamAuthorityHistory1792281600000().up(runner);
    const match = statements
      .join('\n')
      .match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${functionName}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`,
        ),
      );
    assert.ok(match?.[1]);
    const body = match[1].replaceAll('\r\n', '\n');
    const profile = MAIN_AUTHORITY_V2_FUNCTION_PROFILES.find((item) => item.name === functionName);
    assert.ok(profile);
    for (const variant of [body, body.replaceAll('\n', '\r\n')]) {
      assert(
        profile.body_sha256.some(
          (digest) => digest === createHash('sha256').update(variant).digest('hex'),
        ),
      );
    }
    assert.equal(profile.search_path, true);
    assert.equal(profile.utc, true);
  });
}
