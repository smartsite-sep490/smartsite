import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment.js';

test('development starts with local PostgreSQL and a restrictive browser origin', () => {
  const config = validateEnvironment({});
  assert.equal(config.PORT, 3000);
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(
    config.DATABASE_URL,
    'postgresql://smartsite:smartsite_local_only@localhost:5432/smartsite',
  );
  assert.deepEqual(config.CORS_ORIGINS, ['http://localhost:5173']);
});

test('accepts explicit production configuration and exact origin list', () => {
  const config = validateEnvironment({
    NODE_ENV: 'production',
    PORT: '8080',
    DATABASE_URL: 'postgresql://app:example@db.example.com/app?sslmode=require',
    DATABASE_TIMEOUT_MS: '1500',
    CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
  });
  assert.equal(config.NODE_ENV, 'production');
  assert.equal(config.PORT, 8080);
  assert.equal(config.DATABASE_TIMEOUT_MS, 1500);
  assert.deepEqual(config.CORS_ORIGINS, ['https://app.example.com', 'https://admin.example.com']);
});

test('rejects invalid ports, environment names and database timeout values', () => {
  for (const PORT of ['0', '65536', '3000suffix', '1.5', '']) {
    assert.throws(() => validateEnvironment({ PORT }), /PORT/);
  }
  assert.throws(() => validateEnvironment({ NODE_ENV: 'prod' }), /NODE_ENV/);
  for (const DATABASE_TIMEOUT_MS of ['0', '30001', 'no-timeout']) {
    assert.throws(() => validateEnvironment({ DATABASE_TIMEOUT_MS }), /DATABASE_TIMEOUT_MS/);
  }
});

test('rejects wildcard, opaque and non-origin CORS entries', () => {
  for (const CORS_ORIGINS of [
    '*',
    'null',
    'ftp://site.example',
    'https://site.example/path',
    'https://user:pass@site.example',
    'https://site.example?query=1',
    'https://site.example#fragment',
  ]) {
    assert.throws(() => validateEnvironment({ CORS_ORIGINS }), /CORS_ORIGINS/);
  }
  assert.deepEqual(validateEnvironment({ CORS_ORIGINS: '' }).CORS_ORIGINS, []);
});

test('production requires an explicit database URL and CORS configuration', () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: 'production' }), /DATABASE_URL/);
  assert.throws(
    () =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://app:example@db.example/app',
      }),
    /CORS_ORIGINS/,
  );
});

test('database validation rejects non-PostgreSQL URLs without revealing credentials', () => {
  for (const DATABASE_URL of [
    '',
    'mysql://app:private-password@db.example/app',
    'not-a-url-private-password',
    'postgresql:///app',
  ]) {
    assert.throws(
      () => validateEnvironment({ DATABASE_URL }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /DATABASE_URL/);
        assert.doesNotMatch(error.message, /private-password/);
        return true;
      },
    );
  }
});
