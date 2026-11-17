import { z } from 'zod';

const safeInteger = z.number().int();
const positiveInteger = safeInteger.min(1);
const pendingInteger = positiveInteger.max(Number.MAX_SAFE_INTEGER - 1);
const lowerUuid = z.uuid().refine((value) => value === value.toLowerCase(), 'must be lowercase');
const policySchema = z.strictObject({
  profile: z.strictObject({
    wireVersion: z.enum(['1.6.0', '1.7.0']),
    routeEpoch: lowerUuid,
    profileSha256: z.string().regex(/^[0-9a-f]{64}$/),
    allowedCameraIds: z
      .array(lowerUuid)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, 'must contain distinct camera IDs'),
    clockToleranceMs: safeInteger.min(0),
  }),
  pending: z.strictObject({
    pendingTtlMs: pendingInteger,
    maxPendingFrames: pendingInteger,
    maxPendingParts: pendingInteger,
    maxPendingPayloadBytes: pendingInteger,
  }),
  heads: z.strictObject({
    firstFramePolicy: z.literal('FIRST_COMMITTED_CAPTURE'),
    maxCaptureGapMs: safeInteger.min(0),
    maxSourceSequenceGap: z
      .string()
      .refine(
        (value) => /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n,
        'must be a positive unsigned 64-bit decimal',
      ),
    maxSegmentRows: positiveInteger,
  }),
  recovery: z.strictObject({
    intervalMs: positiveInteger.max(2_147_483_647),
    maxFramesPerCamera: positiveInteger,
  }),
  maxRecipients: positiveInteger.max(4096),
});

export const trackedRuntimePolicyEnvironment = z
  .string()
  .max(32_768)
  .transform((value, context) => {
    let candidate: unknown;
    try {
      candidate = JSON.parse(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'must contain a valid tracked runtime policy' });
      return z.NEVER;
    }
    const parsed = policySchema.safeParse(candidate);
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'must contain a valid tracked runtime policy' });
      return z.NEVER;
    }
    return parsed.data;
  });
