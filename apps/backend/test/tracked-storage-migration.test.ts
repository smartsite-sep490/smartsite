import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { TrackedSubjectStorage1795046400003 } from '../src/database/migrations/1795046400003-TrackedSubjectStorage.js';

test('tracked storage refuses nontransactional application or reversal before issuing SQL', async () => {
  let calls = 0;
  const runner = {
    isTransactionActive: false,
    async query() {
      calls++;
    },
  } as unknown as QueryRunner;
  const migration = new TrackedSubjectStorage1795046400003();
  await assert.rejects(migration.up(runner), /transaction/);
  await assert.rejects(migration.down(runner), /transaction/);
  assert.equal(calls, 0);
});

test('tracked storage reversal refuses any recorded technical history before dropping storage', async () => {
  const statements: string[] = [];
  const runner = {
    isTransactionActive: true,
    async query(sql: string) {
      statements.push(sql);
      return [{ has_history: true }];
    },
  } as unknown as QueryRunner;
  await assert.rejects(new TrackedSubjectStorage1795046400003().down(runner), /history/);
  assert.ok(!statements.some((sql) => /DROP /i.test(sql)));
});
