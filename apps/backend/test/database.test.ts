import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import AppDataSource from '../src/database/typeorm.data-source.js';
import { DatabaseService } from '../src/database/database.service.js';
import { resolveCliEnvironment } from '../src/config/cli-environment.js';
import { numericTransformer } from '../src/database/entities/numeric.transformer.js';

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
  assert.equal(
    AppDataSource.isInitialized,
    false,
    'AppDataSource must not initialize connection on import',
  );

  // Assert canonical typeorm.data-source.ts source file exists
  const backendRoot = path.resolve(
    import.meta.dirname,
    import.meta.dirname.includes('.test-build') ? '../..' : '..',
  );
  const expectedSourceFile = path.resolve(backendRoot, 'src/database/typeorm.data-source.ts');
  assert.ok(
    fs.existsSync(expectedSourceFile),
    'Canonical typeorm.data-source.ts source file must exist',
  );

  // Assert package.json migration scripts target dist/database/typeorm.data-source.js
  const pkgJsonPath = path.resolve(backendRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  for (const scriptName of ['db:migrate:run', 'db:migrate:revert', 'db:migrate:show']) {
    const script = pkg.scripts?.[scriptName] ?? '';
    assert.ok(
      script.includes('dist/database/typeorm.data-source.js'),
      `${scriptName} must target dist/database/typeorm.data-source.js`,
    );
  }
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

test('resolveCliEnvironment loads DATABASE_URL from .env file when process environment is empty', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsite-cli-env-'));
  const envFile = path.join(tmpDir, '.env');
  try {
    fs.writeFileSync(
      envFile,
      'DATABASE_URL=postgresql://file_user:file_pass@localhost:5432/file_db\n',
      'utf8',
    );
    const config = resolveCliEnvironment(envFile, {});
    assert.equal(config.DATABASE_URL, 'postgresql://file_user:file_pass@localhost:5432/file_db');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCliEnvironment prioritizes real process environment variables over .env file values', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartsite-cli-env-'));
  const envFile = path.join(tmpDir, '.env');
  try {
    fs.writeFileSync(
      envFile,
      'DATABASE_URL=postgresql://file_user:file_pass@localhost:5432/file_db\n',
      'utf8',
    );
    const config = resolveCliEnvironment(envFile, {
      DATABASE_URL: 'postgresql://process_user:process_pass@localhost:5432/process_db',
    });
    assert.equal(
      config.DATABASE_URL,
      'postgresql://process_user:process_pass@localhost:5432/process_db',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveCliEnvironment prefers a validated DIRECT_URL for migration commands only', () => {
  const config = resolveCliEnvironment(undefined, {
    DATABASE_URL: 'postgresql://pooled_user:pass@pooled.example.com:5432/app',
    DIRECT_URL: 'postgresql://direct_user:pass@direct.example.com:5432/app?sslmode=require',
  });

  assert.equal(
    config.DATABASE_URL,
    'postgresql://direct_user:pass@direct.example.com:5432/app?sslmode=require',
  );
});

test('resolveCliEnvironment rejects an invalid DIRECT_URL without exposing credentials', () => {
  assert.throws(
    () =>
      resolveCliEnvironment(undefined, {
        DATABASE_URL: 'postgresql://pooled_user:pass@pooled.example.com:5432/app',
        DIRECT_URL: 'https://secret-user:secret-pass@example.com/app',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /DIRECT_URL must be a PostgreSQL URL/);
      assert.doesNotMatch(error.message, /secret-user|secret-pass/);
      return true;
    },
  );
});

test('resolveCliEnvironment falls back safely when .env file does not exist', () => {
  const nonExistentPath = path.join(os.tmpdir(), 'does-not-exist', '.env');
  const config = resolveCliEnvironment(nonExistentPath, {});
  assert.equal(
    config.DATABASE_URL,
    'postgresql://smartsite:smartsite_local_only@localhost:5432/smartsite',
  );
});

test('numericTransformer converts finite numbers and strings correctly', () => {
  assert.equal(numericTransformer.to(0.95), 0.95);
  assert.equal(numericTransformer.to('0.95'), 0.95);
  assert.equal(numericTransformer.to(null), null);
  assert.equal(numericTransformer.to(undefined), undefined);
  assert.throws(() => numericTransformer.to('not-a-number'), TypeError);
  assert.throws(() => numericTransformer.to(Infinity), TypeError);

  assert.equal(numericTransformer.from('0.9500'), 0.95);
  assert.equal(numericTransformer.from(0.95), 0.95);
  assert.equal(numericTransformer.from(null), null);
  assert.equal(numericTransformer.from(undefined), null);
  assert.throws(() => numericTransformer.from('not-a-number'), TypeError);
});
