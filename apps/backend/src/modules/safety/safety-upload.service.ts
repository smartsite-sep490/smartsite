import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { StorageService, type StoredObject } from '../../integrations/storage/storage.service.js';
export interface SafetyUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
export const MAX_SAFETY_UPLOAD = 1024 * 1024;
export function validateSafetyJpeg(file: SafetyUpload): string {
  if (
    !Buffer.isBuffer(file.buffer) ||
    file.size !== file.buffer.length ||
    file.size > MAX_SAFETY_UPLOAD
  )
    throw new PublicHttpException(413, {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'JPEG must be at most 1 MiB',
    });
  const bytes = file.buffer;
  if (
    file.mimetype !== 'image/jpeg' ||
    bytes.length < 5 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    throw new PublicHttpException(415, {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'A JPEG image is required',
    });
  return createHash('sha256').update(bytes).digest('hex');
}
@Injectable()
export class SafetyUploadService {
  constructor(private readonly storage: StorageService) {}
  async save(file: SafetyUpload) {
    validateSafetyJpeg(file);
    return this.storage.save(file.buffer, 'image/jpeg', 'jpg');
  }
  async remove(reference: StoredObject) {
    await this.storage.remove(reference);
  }
  async read(reference: StoredObject) {
    const bytes = await this.storage.read(reference);
    validateSafetyJpeg({ buffer: bytes, size: bytes.length, mimetype: reference.mediaType });
    return bytes;
  }
}
