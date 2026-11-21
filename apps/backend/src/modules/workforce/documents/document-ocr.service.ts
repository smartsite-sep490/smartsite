import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { DocumentOcrResult, DocumentImageQuality } from '@smartsite/contracts';
import { LocalDocumentOcr } from './local-document-ocr.js';

export const unavailableOcr = (): DocumentOcrResult => ({
  status: 'UNAVAILABLE',
  issuedOn: null,
  expiresOn: null,
  warnings: ['OCR_UNAVAILABLE_REVIEW_ORIGINAL'],
});
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-'))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
@Injectable()
export class DocumentOcrService {
  private readonly cache = new Map<
    string,
    { expires: number; result: { quality: DocumentImageQuality; ocr: DocumentOcrResult } }
  >();
  constructor(private readonly local: LocalDocumentOcr) {}

  async inspect(
    bytes: Buffer,
    mediaType: string,
    scope = '',
  ): Promise<{ quality: DocumentImageQuality; ocr: DocumentOcrResult }> {
    const key = createHash('sha256')
      .update(scope)
      .update('\0inspect-v1\0')
      .update(mediaType)
      .update(bytes)
      .digest('hex');
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    this.cache.delete(key);
    if (mediaType !== 'application/pdf') {
      try {
        await sharp(bytes, { limitInputPixels: 20_000_000 }).stats();
      } catch {
        throw new PublicHttpException(422, {
          code: 'VALIDATION_FAILED',
          message: 'Choose a readable image up to 20 megapixels',
        });
      }
    }
    const output = await this.local.run(bytes, mediaType, 'inspect');
    if (mediaType === 'application/pdf' && output?.valid !== true) {
      const checked =
        output?.valid === false
          ? { valid: false }
          : await this.local.run(bytes, mediaType, 'validate');
      if (checked?.valid === false)
        throw new PublicHttpException(422, {
          code: 'VALIDATION_FAILED',
          message: 'Choose a readable PDF with at most four pages',
        });
      if (checked?.valid !== true)
        throw new PublicHttpException(503, {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Document file validation is unavailable. Retry before submitting.',
        });
    }

    const qualitySchema = z.object({
      status: z.enum(['ACCEPTED', 'RETAKE', 'UNAVAILABLE']),
      reason: z.enum([
        'IMAGE_ACCEPTED',
        'IMAGE_BLURRY',
        'IMAGE_TOO_SMALL',
        'IMAGE_TOO_LARGE',
        'IMAGE_EXPOSURE',
        'IMAGE_INVALID',
        'PDF_TOO_MANY_PAGES',
        'OCR_ENGINE_UNAVAILABLE',
      ]),
    });
    const evidenceSchema = z.object({
      status: z.enum(['READ', 'UNREADABLE', 'UNAVAILABLE']),
      issuedOn: z.string().refine(isCalendarDate).nullable(),
      expiresOn: z.string().refine(isCalendarDate).nullable(),
      nationalIds: z
        .array(z.string().regex(/^[0-9]{12}$/))
        .max(5)
        .optional(),
      warnings: z.array(z.string().regex(/^[A-Z0-9_]{1,100}$/)).max(10),
    });
    const parsed = z
      .object({ quality: qualitySchema, ocr: evidenceSchema })
      .refine(
        ({ quality }) =>
          (quality.status === 'ACCEPTED') === (quality.reason === 'IMAGE_ACCEPTED') &&
          (quality.status === 'UNAVAILABLE') === (quality.reason === 'OCR_ENGINE_UNAVAILABLE'),
      )
      .safeParse(output);
    const result: { quality: DocumentImageQuality; ocr: DocumentOcrResult } = parsed.success
      ? parsed.data
      : {
          quality: { status: 'UNAVAILABLE', reason: 'OCR_ENGINE_UNAVAILABLE' },
          ocr: unavailableOcr(),
        };
    if (
      result.quality.reason === 'IMAGE_INVALID' ||
      result.quality.reason === 'PDF_TOO_MANY_PAGES'
    ) {
      throw new PublicHttpException(422, {
        code: 'VALIDATION_FAILED',
        message: 'Choose a readable document within the file limits',
      });
    }
    if (result.quality.status !== 'UNAVAILABLE') {
      while (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + 300000, result });
    }
    return result;
  }
  async read(bytes: Buffer, mediaType: string): Promise<DocumentOcrResult> {
    const data = await this.local.run(bytes, mediaType, 'ocr');
    if (!data) return unavailableOcr();
    if (
      !['READ', 'UNREADABLE', 'UNAVAILABLE'].includes(String(data.status)) ||
      (data.issuedOn !== null && !isCalendarDate(data.issuedOn)) ||
      (data.expiresOn !== null && !isCalendarDate(data.expiresOn)) ||
      !Array.isArray(data.warnings) ||
      data.warnings.length > 10 ||
      data.warnings.some((w) => typeof w !== 'string' || !/^[A-Z0-9_]{1,100}$/.test(w))
    )
      return unavailableOcr();
    if (
      data.nationalIds !== undefined &&
      (!Array.isArray(data.nationalIds) ||
        data.nationalIds.length > 5 ||
        data.nationalIds.some((id) => typeof id !== 'string' || !/^[0-9]{12}$/.test(id)))
    )
      return unavailableOcr();
    return {
      status: data.status as DocumentOcrResult['status'],
      issuedOn: data.issuedOn as string | null,
      expiresOn: data.expiresOn as string | null,
      ...(data.nationalIds !== undefined
        ? { nationalIds: [...new Set(data.nationalIds as string[])] }
        : {}),
      warnings: data.warnings as string[],
    };
  }
}
