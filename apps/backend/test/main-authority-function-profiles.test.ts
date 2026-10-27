import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { Mf06MainAuthorityJournal1791590400002 } from '../src/database/migrations/1791590400002-Mf06MainAuthorityJournal.js';
import { MAIN_AUTHORITY_FUNCTION_PROFILES } from '../src/common/configuration/main-authority-function-profiles.js';

test('pinned function inventory matches every canonical migration-emitted body and execution profile', async () => {
  const queries: string[] = [];
  // Collect SQL, never execute this migration or inspect live application data.
  const collector = {
    hasColumn: async () => true,
    query: async (sql: string) => {
      queries.push(sql);
    },
  } as unknown as QueryRunner;
  await new Mf06MainAuthorityJournal1791590400002().up(collector);
  const digest = (body: string) => createHash('sha256').update(body).digest('hex');
  const emitted = [
    ...queries
      .join('\n')
      .matchAll(
        /CREATE FUNCTION (\w+)\(([^)]*)\) RETURNS (\w+) LANGUAGE (\w+)([\s\S]*?)AS \$\$([\s\S]*?)\$\$;/g,
      ),
  ].map(([, name, args, result, language, settings, body]) => {
    assert.ok(name && result && language && settings !== undefined && body !== undefined);
    const lf = body.replaceAll('\r\n', '\n');
    assert.ok(!lf.includes('\r'));
    return {
      name,
      arguments: args
        ? args
            .split(',')
            .map((arg) => arg.trim().split(/\s+/).at(-1)!.toLowerCase())
            .join(', ')
        : '',
      return_type: result.toLowerCase(),
      language,
      volatility: /\bSTABLE\b/.test(settings) ? 's' : 'v',
      search_path: /SET search_path FROM CURRENT/.test(settings),
      utc: /SET timezone='UTC'/.test(settings),
      body_sha256: [digest(lf), digest(lf.replaceAll('\n', '\r\n'))],
    };
  });
  assert.equal(emitted.length, 16);
  assert.equal(new Set(emitted.map((profile) => profile.name)).size, 16);
  assert.deepEqual(MAIN_AUTHORITY_FUNCTION_PROFILES, emitted);
});
