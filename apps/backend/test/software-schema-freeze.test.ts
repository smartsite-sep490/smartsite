import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { withSoftwareSchemaFreeze } from '../src/database/software-schema-freeze.js';
const schema = `isolated_test_${'a'.repeat(32)}`;
for (const [label, changes] of [
  ['unknown/default namespace', { schema: 'public' }],
  ['wrong port', { url: 'postgresql://smartsite_test:fake-secret@127.0.0.1:5434/smartsite_test' }],
  [
    'cloud target',
    { url: 'postgresql://smartsite_test:fake-secret@cloud.invalid:5433/smartsite_test' },
  ],
  [
    'untrusted URL options',
    { url: 'postgresql://smartsite_test:fake-secret@127.0.0.1:5433/smartsite_test?options=unsafe' },
  ],
  ['automatic migrations', { migrationsRun: true }],
] as const) {
  test(`software freeze refuses ${label} before any query and omits private input`, async () => {
    let queries = 0;
    const db = {
      isInitialized: true,
      options: {
        type: 'postgres',
        schema,
        synchronize: false,
        migrationsRun: false,
        url: 'postgresql://smartsite_test:fake-secret@127.0.0.1:5433/smartsite_test',
        ...changes,
      },
      createQueryRunner() {
        queries++;
        throw Error('No query expected');
      },
    } as unknown as DataSource;
    await assert.rejects(
      withSoftwareSchemaFreeze(db, schema, async () => undefined),
      (error) => {
        assert(error instanceof Error);
        assert(!error.message.includes('fake-secret'));
        return error.message === 'Explicit dedicated software schema target required';
      },
    );
    assert.equal(queries, 0);
  });
}
