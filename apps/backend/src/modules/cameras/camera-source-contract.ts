import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const secret = z.string().max(256);
export const sourceDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WEBCAM'), deviceId: id }).strict(),
  z.object({ kind: z.literal('VIDEO'), assetId: id }).strict(),
  z
    .object({
      kind: z.literal('RTSP'),
      endpoint: z.string().min(1).max(2048),
      username: secret.optional(),
      password: secret.optional(),
    })
    .strict(),
]);
export const sourceCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    hostId: id,
    label: z.string().min(1).max(128),
    sourceKinds: z.array(z.enum(['WEBCAM', 'RTSP', 'VIDEO'])).max(3),
    webcams: z.array(z.object({ id, label: z.string().min(1).max(128) }).strict()).max(32),
    videos: z.array(z.object({ id, label: z.string().min(1).max(255) }).strict()).max(128),
    browserCameraSupported: z.literal(false),
    applySupported: z.boolean(),
    configurationResumeSupported: z.boolean().optional(),
    sourceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export const sourceProbeSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    state: z.literal('TESTED'),
    receiptId: z.uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    sourceKind: z.enum(['LIVE', 'REPLAY']),
    frame: z
      .object({
        width: z.number().int().min(1).max(8192),
        height: z.number().int().min(1).max(8192),
        capturedAt: z.string().datetime({ offset: true }),
        imageDataUrl: z
          .string()
          .max(350000)
          .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict(),
  })
  .strict();

export const sourceHostsSchema = z
  .array(
    z
      .object({
        id,
        label: z.string().min(1).max(128),
        siteIds: z.array(z.uuid()).min(1).max(128),
        origin: z.string().url(),
      })
      .strict(),
  )
  .max(16);

export const sourceActivationCommandSchema = z
  .object({
    commandId: z.uuid(),
    receiptId: z.uuid(),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export const sourceActivationStateSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    state: z.enum(['PREPARED', 'RUNNING']),
    commandId: z.uuid(),
    sourceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sourceKind: z.literal('LIVE'),
    currentGenerationId: z.uuid(),
  })
  .strict();

export const sourceConfigurationResumeSchema = z
  .object({
    commandId: z.uuid(),
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expectedConfigurationVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const resumeBindingSchema = z
  .object({ cameraId: z.uuid(), workerGenerationId: z.uuid(), streamSessionId: z.uuid() })
  .strict();
export const sourceResumeStatusSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    commandId: z.uuid(),
    sourceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    sourceKind: z.literal('LIVE'),
    state: z.enum(['PREPARED', 'RUNNING', 'STOPPING', 'STARTING']),
    generationBinding: resumeBindingSchema,
    configuration: z
      .object({
        configurationVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        viewRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    newGenerationBinding: resumeBindingSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.state !== 'RUNNING' ||
      Boolean(
        v.newGenerationBinding &&
        v.newGenerationBinding.cameraId === v.generationBinding.cameraId &&
        v.newGenerationBinding.workerGenerationId !== v.generationBinding.workerGenerationId &&
        v.newGenerationBinding.streamSessionId !== v.generationBinding.streamSessionId,
      ),
  );
