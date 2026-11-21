import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { executeMainConfigurationCommand } from '../src/common/configuration/main-configuration-authority.js';

test('installed authority capture never executes a command without authenticated context', async () => {
  let writes = 0;
  const manager = {
    query: async (sql: string) =>
      sql.includes('FILTER(WHERE c.relname')
        ? [{ n: 8, legacy: 0, baseline: 1 }]
        : [{ valid: true }],
  } as unknown as EntityManager;
  const source = {
    transaction: async (work: (manager: EntityManager) => Promise<unknown>) => work(manager),
  } as unknown as DataSource;
  await assert.rejects(
    executeMainConfigurationCommand(
      source,
      undefined,
      'CONTRACTOR_CREATE',
      { name: 'Synthetic' },
      async () => {
        writes++;
        return 'written';
      },
    ),
    (error) => (error as { getStatus(): number }).getStatus() === 503,
  );
  assert.equal(writes, 0);
});

test('pre-journal internal fixture compatibility remains available', async () => {
  const manager = {
    query: async () => [{ n: 0, legacy: 0, baseline: 0 }],
  } as unknown as EntityManager;
  const source = {
    transaction: async (work: (manager: EntityManager) => Promise<unknown>) => work(manager),
  } as unknown as DataSource;
  assert.equal(
    await executeMainConfigurationCommand(
      source,
      undefined,
      'CONTRACTOR_CREATE',
      { name: 'Synthetic' },
      async () => 'synthetic-result',
    ),
    'synthetic-result',
  );
});
