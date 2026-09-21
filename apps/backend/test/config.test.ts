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
    SMARTSITE_AI_SERVICE_TOKEN: 'prod-service-token',
  });
  assert.equal(config.NODE_ENV, 'production');
  assert.equal(config.PORT, 8080);
  assert.equal(config.DATABASE_TIMEOUT_MS, 1500);
  assert.deepEqual(config.CORS_ORIGINS, ['https://app.example.com', 'https://admin.example.com']);
  assert.equal(config.SMARTSITE_AI_SERVICE_TOKEN, 'prod-service-token');
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

test('development and test defaults include local-only service token and timing values', () => {
  const devConfig = validateEnvironment({});
  assert.equal(devConfig.SMARTSITE_AI_SERVICE_TOKEN, 'smartsite_local_dev_service_token_only');
  assert.equal(devConfig.ALERT_COOLDOWN_SECONDS, 60);
  assert.equal(devConfig.MAX_PAST_EVENT_AGE_SECONDS, 300);
  assert.equal(devConfig.MAX_FUTURE_CLOCK_SKEW_SECONDS, 30);

  const testConfig = validateEnvironment({ NODE_ENV: 'test' });
  assert.equal(testConfig.SMARTSITE_AI_SERVICE_TOKEN, 'smartsite_local_dev_service_token_only');
});

test('production requires an explicit non-empty SMARTSITE_AI_SERVICE_TOKEN and never leaks it', () => {
  const validBase = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app:example@localhost:5432/app',
    CORS_ORIGINS: 'https://app.example.com',
  };

  // Missing token throws
  assert.throws(
    () => validateEnvironment(validBase),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
      return true;
    },
  );

  // Empty string token throws
  assert.throws(
    () => validateEnvironment({ ...validBase, SMARTSITE_AI_SERVICE_TOKEN: '' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
      return true;
    },
  );

  // Whitespace-only token throws
  assert.throws(
    () => validateEnvironment({ ...validBase, SMARTSITE_AI_SERVICE_TOKEN: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
      return true;
    },
  );

  // Local development fallback token explicitly passed in production throws and does not leak value
  assert.throws(
    () =>
      validateEnvironment({
        ...validBase,
        SMARTSITE_AI_SERVICE_TOKEN: 'smartsite_local_dev_service_token_only',
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
      assert.doesNotMatch(error.message, /smartsite_local_dev_service_token_only/);
      return true;
    },
  );

  // Whitespace-bearing explicit token throws in production and does not leak value
  for (const whitespaceToken of [' prod-token ', 'prod token', 'prod-token\t', '\nprod-token']) {
    assert.throws(
      () =>
        validateEnvironment({
          ...validBase,
          SMARTSITE_AI_SERVICE_TOKEN: whitespaceToken,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
        assert.doesNotMatch(error.message, /prod-token/);
        return true;
      },
    );
  }

  // Whitespace-bearing explicit token throws in development as well
  assert.throws(
    () =>
      validateEnvironment({
        NODE_ENV: 'development',
        SMARTSITE_AI_SERVICE_TOKEN: ' dev-token ',
      }),
    /SMARTSITE_AI_SERVICE_TOKEN/,
  );

  // Non-string token throws
  assert.throws(
    () => validateEnvironment({ ...validBase, SMARTSITE_AI_SERVICE_TOKEN: 12345 }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SMARTSITE_AI_SERVICE_TOKEN/);
      assert.doesNotMatch(error.message, /12345/);
      return true;
    },
  );

  // Valid token accepted
  const valid = validateEnvironment({
    ...validBase,
    SMARTSITE_AI_SERVICE_TOKEN: 'prod-secret-token-xyz',
  });
  assert.equal(valid.SMARTSITE_AI_SERVICE_TOKEN, 'prod-secret-token-xyz');
});

test('timing variables reject non-positive, non-integer, or out-of-range values and accept values above 86400', () => {
  for (const invalid of ['0', '-1', '1.5', 'sixty', '']) {
    assert.throws(
      () => validateEnvironment({ ALERT_COOLDOWN_SECONDS: invalid }),
      /ALERT_COOLDOWN_SECONDS/,
    );
    assert.throws(
      () => validateEnvironment({ MAX_PAST_EVENT_AGE_SECONDS: invalid }),
      /MAX_PAST_EVENT_AGE_SECONDS/,
    );
    assert.throws(
      () => validateEnvironment({ MAX_FUTURE_CLOCK_SKEW_SECONDS: invalid }),
      /MAX_FUTURE_CLOCK_SKEW_SECONDS/,
    );
  }

  // Values above 86400 (one day) must be accepted when within safe integer/millisecond arithmetic
  const aboveDay = validateEnvironment({
    ALERT_COOLDOWN_SECONDS: '100000',
    MAX_PAST_EVENT_AGE_SECONDS: '259200',
    MAX_FUTURE_CLOCK_SKEW_SECONDS: '90000',
  });
  assert.equal(aboveDay.ALERT_COOLDOWN_SECONDS, 100000);
  assert.equal(aboveDay.MAX_PAST_EVENT_AGE_SECONDS, 259200);
  assert.equal(aboveDay.MAX_FUTURE_CLOCK_SKEW_SECONDS, 90000);

  const custom = validateEnvironment({
    ALERT_COOLDOWN_SECONDS: '120',
    MAX_PAST_EVENT_AGE_SECONDS: '600',
    MAX_FUTURE_CLOCK_SKEW_SECONDS: '45',
  });
  assert.equal(custom.ALERT_COOLDOWN_SECONDS, 120);
  assert.equal(custom.MAX_PAST_EVENT_AGE_SECONDS, 600);
  assert.equal(custom.MAX_FUTURE_CLOCK_SKEW_SECONDS, 45);
});
