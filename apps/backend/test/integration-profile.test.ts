import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';

test('default integration profile uses the complete release graph, not the frozen branch catalog', async () => {
  const previous = process.env.TEST_DATABASE_URL;
  const url =
    'postgresql://smartsite_test:synthetic-not-a-credential@127.0.0.1:5433/smartsite_test';
  process.env.TEST_DATABASE_URL = url;
  let source: DataSource;
  try {
    source = (await import('./support/test-data-source.js')).default;
  } finally {
    if (previous === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = previous;
  }
  const release = buildTypeOrmOptions({ DATABASE_URL: url });
  assert.equal(source.constructor, DataSource);
  assert.deepEqual(source.options.migrations, release.migrations);
  assert.deepEqual(source.options.entities, release.entities);
  assert.equal(source.options.synchronize, false);
  assert.equal(source.options.migrationsRun, false);
  assert.equal(source.isInitialized, false);
});
