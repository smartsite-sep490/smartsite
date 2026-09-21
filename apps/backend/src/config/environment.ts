import { z } from 'zod';

const LOCAL_DATABASE_URL = 'postgresql://smartsite:smartsite_local_only@localhost:5432/smartsite';
const LOCAL_SERVICE_TOKEN = 'smartsite_local_dev_service_token_only';
const MAX_SAFE_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
// Throttler's in-memory expiry uses setTimeout; larger delays wrap to 1 ms in Node.
const MAX_TIMER_MS = 2_147_483_647;

function integer(fallback: number, minimum: number, maximum: number) {
  const error = `must be an integer between ${minimum} and ${maximum}`;
  return z
    .string({ error })
    .regex(/^\d+$/, error)
    .default(String(fallback))
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum, error);
}

export const postgresUrlSchema = z
  .string({ error: 'must be a PostgreSQL URL with a host and database name' })
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        ['postgres:', 'postgresql:'].includes(parsed.protocol) &&
        !!parsed.hostname &&
        parsed.pathname.length > 1
      );
    } catch {
      return false;
    }
  }, 'must be a PostgreSQL URL with a host and database name');

const databaseFields = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'must be development, test, or production',
    })
    .default('development'),
  DATABASE_URL: postgresUrlSchema.optional(),
  DATABASE_TIMEOUT_MS: integer(2000, 100, 30000),
};

function productionDatabase(
  config: { NODE_ENV: string; DATABASE_URL?: string },
  context: z.RefinementCtx,
) {
  if (config.NODE_ENV !== 'production') return;
  if (config.DATABASE_URL === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'must be set in production',
    });
    return;
  }
  try {
    const url = new URL(config.DATABASE_URL);
    if (
      [decodeURIComponent(url.password), ...url.searchParams.getAll('password')].includes(
        'smartsite_local_only',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'cannot use the local development credential in production',
      });
    }
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'must be a valid PostgreSQL URL',
    });
  }
}

export const databaseEnvironmentSchema = z
  .object(databaseFields)
  .superRefine(productionDatabase)
  .transform((config) => ({ ...config, DATABASE_URL: config.DATABASE_URL ?? LOCAL_DATABASE_URL }));
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;

const originsSchema = z
  .string({ error: 'must be a comma-separated origin list' })
  .transform((value) => [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ])
  .refine(
    (origins) =>
      origins.every((origin) => {
        try {
          const parsed = new URL(origin);
          return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin;
        } catch {
          return false;
        }
      }),
    'must contain exact HTTP(S) origins without paths, credentials, or wildcards',
  );

export const backendEnvironmentSchema = z
  .object({
    ...databaseFields,
    PORT: integer(3000, 1, 65535),
    CORS_ORIGINS: originsSchema.optional(),
    SMARTSITE_AI_SERVICE_TOKEN: z
      .string({ error: 'must be a string' })
      .refine(
        (value) => value.trim().length === 0 || !/\s/.test(value),
        'must not contain whitespace',
      )
      .optional(),
    ALERT_COOLDOWN_SECONDS: integer(60, 1, MAX_SAFE_SECONDS),
    MAX_PAST_EVENT_AGE_SECONDS: integer(300, 1, MAX_SAFE_SECONDS),
    MAX_FUTURE_CLOCK_SKEW_SECONDS: integer(30, 1, MAX_SAFE_SECONDS),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
        error: 'must be fatal, error, warn, info, debug, trace, or silent',
      })
      .default('info'),
    LOG_FORMAT: z.enum(['json', 'pretty'], { error: 'must be json or pretty' }).optional(),
    HTTP_RATE_LIMIT_TTL_MS: integer(60000, 1, MAX_TIMER_MS),
    HTTP_RATE_LIMIT_LIMIT: integer(120, 1, Number.MAX_SAFE_INTEGER),
    AI_RATE_LIMIT_TTL_MS: integer(60000, 1, MAX_TIMER_MS),
    AI_RATE_LIMIT_LIMIT: integer(600, 1, Number.MAX_SAFE_INTEGER),
  })
  .superRefine((config, context) => {
    productionDatabase(config, context);
    if (config.LOG_FORMAT === 'pretty' && config.NODE_ENV !== 'development') {
      context.addIssue({
        code: 'custom',
        path: ['LOG_FORMAT'],
        message: 'pretty is allowed only in development',
      });
    }
    if (config.NODE_ENV !== 'production') return;
    if (config.CORS_ORIGINS === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must be set explicitly in production (empty disables browser access)',
      });
    }
    if (!config.SMARTSITE_AI_SERVICE_TOKEN?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['SMARTSITE_AI_SERVICE_TOKEN'],
        message: 'must be an explicitly configured non-empty string in production',
      });
    } else if (config.SMARTSITE_AI_SERVICE_TOKEN === LOCAL_SERVICE_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['SMARTSITE_AI_SERVICE_TOKEN'],
        message: 'cannot use the default development token in production',
      });
    } else if (config.SMARTSITE_AI_SERVICE_TOKEN.length < 32) {
      context.addIssue({
        code: 'custom',
        path: ['SMARTSITE_AI_SERVICE_TOKEN'],
        message: 'must contain at least 32 characters in production',
      });
    }
  })
  .transform((config) => ({
    ...config,
    DATABASE_URL: config.DATABASE_URL ?? LOCAL_DATABASE_URL,
    CORS_ORIGINS: config.CORS_ORIGINS ?? ['http://localhost:5173'],
    SMARTSITE_AI_SERVICE_TOKEN: config.SMARTSITE_AI_SERVICE_TOKEN?.trim()
      ? config.SMARTSITE_AI_SERVICE_TOKEN
      : LOCAL_SERVICE_TOKEN,
    LOG_FORMAT: config.LOG_FORMAT ?? (config.NODE_ENV === 'development' ? 'pretty' : 'json'),
  }));

export type BackendEnvironment = z.infer<typeof backendEnvironmentSchema>;

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: ReadonlyArray<{ field: string; rule: string }>) {
    super(issues.map(({ field, rule }) => `${field} ${rule}`).join('; '));
    this.name = 'EnvironmentValidationError';
  }
}

// Never expose Zod's raw issues, which can retain secret input values.
export function parseEnvironment<T>(schema: z.ZodType<T>, input: Record<string, unknown>): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new EnvironmentValidationError(
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), rule: issue.message })),
    );
  }
  return result.data;
}

export function validateEnvironment(input: Record<string, unknown>): BackendEnvironment {
  return parseEnvironment(backendEnvironmentSchema, input);
}
