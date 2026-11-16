import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { conflict, invalid } from '../../../common/configuration/commands.js';

const gridSize = 10_000;
const maxBytes = 1_048_576;
const maxPixels = 16_000_000;
const coordinate = z.number().int().min(0).max(gridSize);
const mask = z
  .strictObject({
    left: coordinate,
    top: coordinate,
    right: coordinate,
    bottom: coordinate,
  })
  .refine(({ left, top, right, bottom }) => left < right && top < bottom);
const inputSchema = z.strictObject({
  episodeId: z.uuid(),
  alertId: z.uuid(),
  eventId: z.uuid(),
  personObservationIndex: z.number().int().min(0).max(255),
  evidenceIndex: z.number().int().min(0).max(255),
  masks: z.array(mask).max(32),
});

export function parseEvidencePreviewInput(body: unknown) {
  const input = inputSchema.safeParse(body);
  if (!input.success) invalid('Invalid evidence preview source or masks');
  return input.data;
}

export async function renderEvidencePreview(bytes: Buffer, masks: z.infer<typeof mask>[]) {
  if (bytes.length > maxBytes) conflict('Identification evidence is unavailable');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: maxPixels });
    const metadata = await image.metadata();
    if (
      metadata.format !== 'jpeg' ||
      (metadata.pages ?? 1) !== 1 ||
      (metadata.orientation !== undefined && metadata.orientation !== 1)
    ) {
      conflict('Identification evidence is unavailable');
    }
    const {
      data,
      info: { width, height, channels },
    } = await image.toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    for (const mask of masks) {
      const left = Math.floor((mask.left * width) / gridSize);
      const top = Math.floor((mask.top * height) / gridSize);
      const right = Math.ceil((mask.right * width) / gridSize);
      const bottom = Math.ceil((mask.bottom * height) / gridSize);
      for (let y = top; y < bottom; y++) {
        data.fill(0, (y * width + left) * channels, (y * width + right) * channels);
      }
    }
    const jpeg = await sharp(data, { raw: { width, height, channels } })
      .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
      .toBuffer();
    if (jpeg.length > maxBytes) conflict('Identification evidence is unavailable');
    return { bytes: jpeg, sha256: createHash('sha256').update(jpeg).digest('hex') };
  } catch {
    conflict('Identification evidence is unavailable');
  }
}
