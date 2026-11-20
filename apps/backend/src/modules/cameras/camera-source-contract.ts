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
    applySupported: z.literal(false),
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
