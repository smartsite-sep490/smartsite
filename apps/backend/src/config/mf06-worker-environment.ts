import { isAbsolute } from 'node:path';
import { z } from 'zod';

const cutoverAbsolutePathSchema = z
  .string({ error: 'must be a string' })
  .trim()
  .min(1, 'must not be empty')
  .max(2048, 'must contain at most 2048 characters')
  .regex(/^[^\p{Cc}]+$/u, 'must not contain control characters')
  .refine(isAbsolute, 'must be an absolute path');

export const mf06EnvironmentFields = {
  MF06_ENQUEUE_ENABLED: z
    .enum(['false', 'true'])
    .default('false')
    .transform((value) => value === 'true'),
  MF06_ASSESSMENT_READ_ENABLED: z
    .enum(['false', 'true'])
    .default('false')
    .transform((value) => value === 'true'),
  MF06_ENQUEUE_MAX_OUTSTANDING: z
    .string()
    .regex(/^\d+$/, 'must be an integer between 1 and 10000')
    .transform(Number)
    .refine(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 10000,
      'must be an integer between 1 and 10000',
    )
    .optional(),
  MF06_WORKER_ENABLED: z
    .enum(['false', 'true'], { error: 'must be false or true' })
    .default('false')
    .transform((value) => value === 'true'),
  MF06_CUTOVER_MANIFEST_PATH: cutoverAbsolutePathSchema.optional(),
  MF06_CUTOVER_MANIFEST_SHA256: z
    .string({ error: 'must be a 64-character lowercase hex SHA-256 digest' })
    .regex(/^[0-9a-f]{64}$/, 'must be a 64-character lowercase hex SHA-256 digest')
    .optional(),
  MF06_CUTOVER_RELEASE_ROOT: cutoverAbsolutePathSchema.optional(),
  MF06_CUTOVER_RELEASE_COMMIT: z
    .string({ error: 'must be a 40-character lowercase hex commit SHA' })
    .regex(/^[0-9a-f]{40}$/, 'must be a 40-character lowercase hex commit SHA')
    .optional(),
  MF06_FACE_MODEL_VERSION: z
    .string({ error: 'must be a string' })
    .min(1, 'must not be empty')
    .max(128, 'must contain at most 128 characters')
    .regex(/^[^\p{Cc}\p{Cs}]+$/u, 'must not contain control or surrogate characters')
    .refine((value) => value.trim() === value, 'must not contain leading or trailing whitespace')
    .optional(),
};

export interface Mf06RefinementInput {
  readonly NODE_ENV: string;
  readonly SMARTSITE_AI_SERVICE_TOKEN?: string;
  readonly SMARTSITE_AI_IDENTITY_URL?: string;
  readonly EVIDENCE_LOCAL_ROOT?: string;
  readonly MF06_ENQUEUE_ENABLED: boolean;
  readonly MF06_ENQUEUE_MAX_OUTSTANDING?: number;
  readonly MF06_WORKER_ENABLED: boolean;
  readonly MF06_CUTOVER_MANIFEST_PATH?: string;
  readonly MF06_CUTOVER_MANIFEST_SHA256?: string;
  readonly MF06_CUTOVER_RELEASE_ROOT?: string;
  readonly MF06_CUTOVER_RELEASE_COMMIT?: string;
  readonly MF06_FACE_MODEL_VERSION?: string;
}

export function refineMf06Environment(
  config: Mf06RefinementInput,
  context: z.RefinementCtx,
  localServiceToken: string,
): void {
  if (config.MF06_ENQUEUE_ENABLED && config.MF06_ENQUEUE_MAX_OUTSTANDING === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['MF06_ENQUEUE_MAX_OUTSTANDING'],
      message: 'must be explicitly set when MF06 enqueue is enabled',
    });
  }
  if (!config.MF06_WORKER_ENABLED) {
    return;
  }
  for (const field of [
    'MF06_CUTOVER_MANIFEST_PATH',
    'MF06_CUTOVER_MANIFEST_SHA256',
    'MF06_CUTOVER_RELEASE_ROOT',
    'MF06_CUTOVER_RELEASE_COMMIT',
  ] as const) {
    if (config[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'must be explicitly set when MF06 worker is enabled',
      });
    }
  }
  const hasIdentityUrl = config.SMARTSITE_AI_IDENTITY_URL !== undefined;
  const hasFaceModelVersion = config.MF06_FACE_MODEL_VERSION !== undefined;
  if (!hasIdentityUrl && !hasFaceModelVersion) {
    return;
  }
  if (!hasIdentityUrl) {
    context.addIssue({
      code: 'custom',
      path: ['SMARTSITE_AI_IDENTITY_URL'],
      message: 'must be explicitly set when MF06 worker face identity is configured',
    });
  } else if (typeof config.SMARTSITE_AI_IDENTITY_URL === 'string') {
    try {
      const parsedIdentityUrl = new URL(config.SMARTSITE_AI_IDENTITY_URL);
      if (parsedIdentityUrl.search || parsedIdentityUrl.hash) {
        context.addIssue({
          code: 'custom',
          path: ['SMARTSITE_AI_IDENTITY_URL'],
          message: 'must not contain query parameters or fragments',
        });
      }
    } catch {
      /* Field-level SMARTSITE_AI_IDENTITY_URL refinement already reports invalid URLs without leaking input. */
    }
  }
  if (config.EVIDENCE_LOCAL_ROOT === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['EVIDENCE_LOCAL_ROOT'],
      message: 'must be explicitly set when MF06 worker face identity is configured',
    });
  }
  if (!hasFaceModelVersion) {
    context.addIssue({
      code: 'custom',
      path: ['MF06_FACE_MODEL_VERSION'],
      message: 'must be explicitly set when MF06 worker face identity is configured',
    });
  }
  if (
    config.SMARTSITE_AI_SERVICE_TOKEN === undefined ||
    typeof config.SMARTSITE_AI_SERVICE_TOKEN === 'string'
  ) {
    const effectiveToken = config.SMARTSITE_AI_SERVICE_TOKEN?.trim()
      ? config.SMARTSITE_AI_SERVICE_TOKEN
      : config.NODE_ENV === 'production'
        ? ''
        : localServiceToken;
    if (
      effectiveToken.length < 32 ||
      effectiveToken.length > 4096 ||
      !/^[\x21-\x7e]+$/.test(effectiveToken)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['SMARTSITE_AI_SERVICE_TOKEN'],
        message:
          'must contain between 32 and 4096 printable ASCII characters when MF06 worker face identity is configured',
      });
    }
  }
}
