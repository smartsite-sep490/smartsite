import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { ZoneTeamAuthorityHistory1792886400000 } from '../src/database/migrations/1792886400000-ZoneTeamAuthorityHistory.js';

test('team journal refuses unbounded seed before creating tables', async () => {
  const statements: string[] = [];
  const runner = {
    isTransactionActive: true,
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('c.relname AS name')) return [{ name: 'mf06_authority_command' }];
      if (sql.includes('seed_rows')) return [{ n: 2049, bytes: '1' }];
      return [];
    },
  } as unknown as QueryRunner;
  await assert.rejects(new ZoneTeamAuthorityHistory1792886400000().up(runner), /seed exceeds/);
  assert(!statements.some((sql) => sql.includes('CREATE TABLE')));
});

test('team journal requires an active transaction before any SQL', async () => {
  let queries = 0;
  await assert.rejects(
    new ZoneTeamAuthorityHistory1792886400000().up({
      isTransactionActive: false,
      query: async () => {
        queries++;
      },
    } as unknown as QueryRunner),
    /requires a transaction/,
  );
  assert.equal(queries, 0);
});
