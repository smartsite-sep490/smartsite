import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { SafetyEvidenceEntity } from '../../database/entities/safety-workflow.entity.js';
export interface SafetyUpload {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
export const MAX_SAFETY_UPLOAD = 1024 * 1024;
const unavailable = (): never => {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Safety evidence unavailable',
  });
};
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
  constructor(private readonly config: ConfigService<BackendEnvironment, true>) {}
  private async root() {
    const root = this.config.get('SAFETY_UPLOAD_LOCAL_ROOT', { infer: true });
    if (!root) return unavailable();
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      return await realpath(root);
    } catch {
      return unavailable();
    }
  }
  async save(file: SafetyUpload) {
    const sha256 = validateSafetyJpeg(file);
    const root = await this.root(),
      storageKey = randomUUID() + '.jpg',
      path = join(root, storageKey);
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(file.buffer);
      } finally {
        await handle.close();
      }
      return { storageKey, sha256, size: file.size, mediaType: 'image/jpeg' };
    } catch {
      await unlink(path).catch(() => undefined);
      return unavailable();
    }
  }
  async remove(storageKey: string) {
    if (!/^[0-9a-f-]{36}\.jpg$/.test(storageKey)) return;
    await unlink(join(await this.root(), storageKey)).catch(() => undefined);
  }
  async read(evidence: SafetyEvidenceEntity): Promise<Buffer> {
    if (!/^[0-9a-f-]{36}\.jpg$/.test(evidence.storageKey)) return unavailable();
    const root = await this.root(),
      path = join(root, evidence.storageKey);
    try {
      if ((await realpath(path)) !== path) return unavailable();
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== evidence.size || stat.size > MAX_SAFETY_UPLOAD)
          return unavailable();
        const bytes = await handle.readFile();
        if (
          validateSafetyJpeg({
            buffer: bytes,
            mimetype: evidence.mediaType,
            size: bytes.length,
          }) !== evidence.sha256
        )
          return unavailable();
        return bytes;
      } finally {
        await handle.close();
      }
    } catch {
      return unavailable();
    }
  }
}
