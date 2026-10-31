import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { ExactMf06AuthorityTime1794787200000 } from '../src/database/migrations/1794787200000-ExactMf06AuthorityTime.js';

function fixture(name: string, parents = true, temporary = false) {
  const stop = new Error('Validated lock reached; no DDL executed');
  const calls: string[] = [];
  const runner = {
    isTransactionActive: true,
    async query(sql: string) {
      calls.push(sql);
      if (sql === 'SELECT current_schema() AS name') return [{ name }];
      if (sql.includes('pg_my_temp_schema()')) return temporary ? [{}] : [];
      if (sql.includes("relkind='r'"))
        return parents
          ? [
              { relname: 'ai_observation_event' },
              { relname: 'zone_entry_assessment_request' },
              { relname: 'zone_entry_authority_artifact' },
            ]
          : [];
      if (sql.startsWith('SET LOCAL lock_timeout')) return [];
      if (sql.startsWith('LOCK TABLE')) throw stop;
      throw new Error('Unexpected migration query');
    },
  } as unknown as QueryRunner;
  return { runner, calls, stop };
}

test('default public application schema is accepted without executing DDL in the unit fixture', async () => {
  const f = fixture('public');
  await assert.rejects(new ExactMf06AuthorityTime1794787200000().up(f.runner), (e) => e === f.stop);
  assert(f.calls.some((sql) => sql.includes('"public".zone_entry_assessment_request')));
});

test('system schema, missing owned parents and temporary shadows fail before migration lock', async () => {
  for (const [name, parents, temporary] of [
    ['pg_catalog', true, false],
    ['pg_toast', true, false],
    ['information_schema', true, false],
    ['isolated_test_fixture', false, false],
    ['isolated_test_fixture', true, true],
  ] as const) {
    const f = fixture(name, parents, temporary);
    await assert.rejects(
      new ExactMf06AuthorityTime1794787200000().up(f.runner),
      (e) => e !== f.stop,
    );
    assert.equal(
      f.calls.some((sql) => sql.startsWith('LOCK TABLE')),
      false,
    );
  }
});
