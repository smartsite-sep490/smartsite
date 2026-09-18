export interface BackendEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  DATABASE_TIMEOUT_MS: number;
  CORS_ORIGINS: string[];
  SMARTSITE_AI_SERVICE_TOKEN: string;
  ALERT_COOLDOWN_SECONDS: number;
  MAX_PAST_EVENT_AGE_SECONDS: number;
  MAX_FUTURE_CLOCK_SKEW_SECONDS: number;
}

function integer(
  input: unknown,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (input === undefined) return fallback;
  if (typeof input !== 'string' || !/^\d+$/.test(input)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function validateEnvironment(input: Record<string, unknown>): BackendEnvironment {
  const environment = input.NODE_ENV ?? 'development';
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  if (environment === 'production' && input.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL must be set in production');
  }
  const databaseUrl =
    input.DATABASE_URL ?? 'postgresql://smartsite:smartsite_local_only@localhost:5432/smartsite';
  try {
    if (typeof databaseUrl !== 'string') throw new Error();
    const parsed = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname.length <= 1
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with a host and database name');
  }
  if (environment === 'production' && input.CORS_ORIGINS === undefined) {
    throw new Error(
      'CORS_ORIGINS must be set explicitly in production (empty disables browser access)',
    );
  }
  const originsInput = input.CORS_ORIGINS ?? 'http://localhost:5173';
  if (typeof originsInput !== 'string')
    throw new Error('CORS_ORIGINS must be a comma-separated origin list');
  const origins = originsInput
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
        throw new Error();
    } catch {
      throw new Error(
        'CORS_ORIGINS must contain exact HTTP(S) origins without paths, credentials, or wildcards',
      );
    }
  }

  // SMARTSITE_AI_SERVICE_TOKEN rules
  let serviceToken: string;
  if (environment === 'production') {
    if (input.SMARTSITE_AI_SERVICE_TOKEN === undefined) {
      throw new Error('SMARTSITE_AI_SERVICE_TOKEN must be set in production');
    }
    if (
      typeof input.SMARTSITE_AI_SERVICE_TOKEN !== 'string' ||
      input.SMARTSITE_AI_SERVICE_TOKEN.trim().length === 0
    ) {
      throw new Error(
        'SMARTSITE_AI_SERVICE_TOKEN must be an explicitly configured non-empty string in production',
      );
    }
    serviceToken = input.SMARTSITE_AI_SERVICE_TOKEN;
  } else {
    if (
      typeof input.SMARTSITE_AI_SERVICE_TOKEN === 'string' &&
      input.SMARTSITE_AI_SERVICE_TOKEN.trim().length > 0
    ) {
      serviceToken = input.SMARTSITE_AI_SERVICE_TOKEN;
    } else {
      serviceToken = 'smartsite_local_dev_service_token_only';
    }
  }

  return {
    NODE_ENV: environment,
    PORT: integer(input.PORT, 'PORT', 3000, 1, 65535),
    DATABASE_URL: databaseUrl,
    DATABASE_TIMEOUT_MS: integer(
      input.DATABASE_TIMEOUT_MS,
      'DATABASE_TIMEOUT_MS',
      2000,
      100,
      30000,
    ),
    CORS_ORIGINS: [...new Set(origins)],
    SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
    ALERT_COOLDOWN_SECONDS: integer(
      input.ALERT_COOLDOWN_SECONDS,
      'ALERT_COOLDOWN_SECONDS',
      60,
      1,
      86400,
    ),
    MAX_PAST_EVENT_AGE_SECONDS: integer(
      input.MAX_PAST_EVENT_AGE_SECONDS,
      'MAX_PAST_EVENT_AGE_SECONDS',
      300,
      1,
      86400,
    ),
    MAX_FUTURE_CLOCK_SKEW_SECONDS: integer(
      input.MAX_FUTURE_CLOCK_SKEW_SECONDS,
      'MAX_FUTURE_CLOCK_SKEW_SECONDS',
      30,
      1,
      86400,
    ),
  };
}
