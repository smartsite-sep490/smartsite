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
export const MAX_CHECKLIST_FILE = 5 * 1024 * 1024;
export const MAX_CHECKLIST_TOTAL = 20 * 1024 * 1024;
export function validateChecklistFile(file: SafetyUpload) {
  if (
    !Buffer.isBuffer(file.buffer) ||
    file.size !== file.buffer.length ||
    file.size < 1 ||
    file.size > MAX_CHECKLIST_FILE
  )
    throw new PublicHttpException(413, {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Each checklist file must be at most 5 MiB',
    });
  const b = file.buffer;
  const jpeg =
    file.mimetype === 'image/jpeg' &&
    b.length >= 5 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217;
  const png =
    file.mimetype === 'image/png' &&
    b.length >= 33 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  const pdf =
    file.mimetype === 'application/pdf' &&
    /^%PDF-(?:1\.[0-9]|2\.0)/.test(b.subarray(0, 8).toString('ascii')) &&
    /%%EOF\s*$/.test(b.subarray(-1024).toString('ascii'));
  if (!jpeg && !png && !pdf)
    throw new PublicHttpException(415, {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Choose a JPEG, PNG or PDF with a matching signature',
    });
  return {
    sha256: createHash('sha256').update(b).digest('hex'),
    extension: jpeg ? 'jpg' : png ? 'png' : 'pdf',
    mediaType: file.mimetype as 'image/jpeg' | 'image/png' | 'application/pdf',
  };
}
export function validateChecklistFiles(files: SafetyUpload[]) {
  if (files.reduce((n, f) => n + f.size, 0) > MAX_CHECKLIST_TOTAL)
    throw new PublicHttpException(413, {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Checklist files must total at most 20 MiB',
    });
  return files.map(validateChecklistFile);
}

@Injectable()
export class SafetyUploadService {
  constructor(private readonly storage: StorageService) {}
  async save(file: SafetyUpload) {
    validateSafetyJpeg(file);
    return this.storage.save(file.buffer, 'image/jpeg', 'jpg');
  }
  async saveChecklist(file: SafetyUpload) {
    const validated = validateChecklistFile(file);
    return this.storage.save(file.buffer, validated.mediaType, validated.extension);
  }
  async readChecklist(reference: StoredObject) {
    const bytes = await this.storage.read(reference);
    validateChecklistFile({ buffer: bytes, size: bytes.length, mimetype: reference.mediaType });
    return bytes;
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
