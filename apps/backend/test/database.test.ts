import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import AppDataSource from '../src/database/data-source.js';
import { DatabaseService } from '../src/database/database.service.js';

test('buildTypeOrmOptions enforces production safety invariants and connection limits', () => {
  const options = buildTypeOrmOptions({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DATABASE_TIMEOUT_MS: 2000,
  });

  assert.equal(options.type, 'postgres');
  assert.equal(options.url, 'postgresql://user:pass@localhost:5432/db');
  assert.equal(options.synchronize, false, 'synchronize must always be false in all environments');
  assert.equal(options.migrationsRun, false, 'migrations must not auto-run on boot');
  assert.equal(options.connectTimeoutMS, 2000);

  const extra = (options as { extra?: Record<string, unknown> }).extra;
  assert.ok(extra);
  assert.equal(extra.max, 5, 'Connection pool max must not exceed 5 for Neon budget');
  assert.equal(extra.connectionTimeoutMillis, 2000);
  assert.equal(extra.query_timeout, 2000);
  assert.equal(extra.statement_timeout, 2000);
  assert.equal(extra.application_name, 'smartsite-backend');

  assert.ok(Array.isArray(options.migrations) && options.migrations.length > 0);
  assert.ok(Array.isArray(options.entities) && options.entities.length > 0);
});

test('AppDataSource is a configured TypeORM DataSource instance ready for CLI', () => {
  assert.ok(AppDataSource instanceof DataSource);
  assert.equal(AppDataSource.options.type, 'postgres');
  assert.equal(AppDataSource.options.synchronize, false);
});

test('DatabaseService.isReachable checks connectivity via TypeORM DataSource without leaking credentials', async () => {
  let executedSql = '';
  const mockHealthyDataSource = {
    isInitialized: true,
    async query(sql: string) {
      executedSql = sql;
      return [{ '?column?': 1 }];
    },
  } as unknown as DataSource;

  const service = new DatabaseService(mockHealthyDataSource);
  assert.equal(await service.isReachable(), true);
  assert.equal(executedSql, 'SELECT 1');

  const mockFailingDataSource = {
    isInitialized: true,
    async query() {
      throw new Error('postgresql://secret:pass@private-db/prod connection refused');
    },
  } as unknown as DataSource;

  const failingService = new DatabaseService(mockFailingDataSource);
  assert.equal(await failingService.isReachable(), false);

  const mockUninitializedDataSource = {
    isInitialized: false,
    async query() {
      throw new Error('DataSource is not initialized');
    },
  } as unknown as DataSource;

  const uninitializedService = new DatabaseService(mockUninitializedDataSource);
  assert.equal(await uninitializedService.isReachable(), false);
});
