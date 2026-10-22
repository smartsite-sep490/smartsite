import { Injectable } from '@nestjs/common';
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
  constructor(private readonly local: LocalDocumentOcr) {}
  async quality(bytes: Buffer, mediaType: string): Promise<DocumentImageQuality> {
    const unavailable: DocumentImageQuality = {
      status: 'UNAVAILABLE',
      reason: 'OCR_ENGINE_UNAVAILABLE',
    };
    const data = await this.local.run(bytes, mediaType, 'image-quality');
    if (
      !data ||
      !['ACCEPTED', 'RETAKE', 'UNAVAILABLE'].includes(String(data.status)) ||
      ![
        'IMAGE_ACCEPTED',
        'IMAGE_BLURRY',
        'IMAGE_TOO_SMALL',
        'IMAGE_EXPOSURE',
        'IMAGE_INVALID',
        'PDF_TOO_MANY_PAGES',
        'OCR_ENGINE_UNAVAILABLE',
      ].includes(String(data.reason))
    )
      return unavailable;
    if ((data.status === 'ACCEPTED') !== (data.reason === 'IMAGE_ACCEPTED')) return unavailable;
    if ((data.status === 'UNAVAILABLE') !== (data.reason === 'OCR_ENGINE_UNAVAILABLE'))
      return unavailable;
    return {
      status: data.status as DocumentImageQuality['status'],
      reason: data.reason as DocumentImageQuality['reason'],
    };
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
