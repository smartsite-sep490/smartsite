import { randomUUID, createHash } from 'node:crypto';
import { mkdir, realpath, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { S3Client } from '@aws-sdk/client-s3';
import type { BackendEnvironment } from '../../config/environment.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
export interface StoredObject {
  storageProvider: 'LOCAL' | 'R2';
  storageKey: string;
  sha256: string;
  size: number;
  mediaType: string;
}
const unavailable = (): never => {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Stored file unavailable',
  });
};
const validKey = (key: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/.test(key);
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  constructor(private readonly config: ConfigService<BackendEnvironment, true>) {}
  private async r2() {
    const endpoint = this.config.get('R2_ENDPOINT', { infer: true }),
      bucket = this.config.get('R2_BUCKET', { infer: true }),
      accessKeyId = this.config.get('R2_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey = this.config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return unavailable();
    const sdk = await import('@aws-sdk/client-s3');
    this.client ??= new sdk.S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return { client: this.client, bucket, sdk };
  }
  private async root() {
    const root =
      this.config.get('STORAGE_LOCAL_ROOT', { infer: true }) ??
      this.config.get('SAFETY_UPLOAD_LOCAL_ROOT', { infer: true });
    if (!root) return unavailable();
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      return await realpath(root);
    } catch {
      return unavailable();
    }
  }
  async save(bytes: Buffer, mediaType: string, extension: string): Promise<StoredObject> {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      !/^[a-z0-9]{1,12}$/.test(extension) ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)
    )
      return unavailable();
    const ref: StoredObject = {
      storageProvider: this.config.get('STORAGE_PROVIDER', { infer: true }) ?? 'LOCAL',
      storageKey: randomUUID() + '.' + extension,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      mediaType,
    };
    try {
      if (ref.storageProvider === 'R2') {
        const { client, bucket, sdk } = await this.r2();
        await client.send(
          new sdk.PutObjectCommand({
            Bucket: bucket,
            Key: ref.storageKey,
            Body: bytes,
            ContentType: mediaType,
            ContentLength: bytes.length,
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } else {
        const handle = await open(join(await this.root(), ref.storageKey), 'wx', 0o600);
        try {
          await handle.writeFile(bytes);
        } finally {
          await handle.close();
        }
      }
      return ref;
    } catch {
      // A timed-out PUT may still have reached storage; remove the server-generated key.
      await this.remove(ref);
      return unavailable();
    }
  }
  async remove(ref: Pick<StoredObject, 'storageProvider' | 'storageKey'>): Promise<void> {
    if (!validKey(ref.storageKey)) return;
    try {
      if (ref.storageProvider === 'R2') {
        const { client, bucket, sdk } = await this.r2();
        await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: ref.storageKey }), {
          abortSignal: AbortSignal.timeout(30000),
        });
      } else
        await unlink(join(await this.root(), ref.storageKey)).catch((error: unknown) => {
          if ((error as { code?: string }).code !== 'ENOENT') throw error;
        });
    } catch {
      this.logger.error({
        event: 'storage_cleanup_failed',
        provider: ref.storageProvider,
        objectId: ref.storageKey.split('.')[0],
      });
    }
  }
  async read(ref: StoredObject): Promise<Buffer> {
    if (
      !validKey(ref.storageKey) ||
      !Number.isSafeInteger(ref.size) ||
      ref.size < 1 ||
      !/^[0-9a-f]{64}$/.test(ref.sha256)
    )
      return unavailable();
    try {
      let bytes: Buffer;
      if (ref.storageProvider === 'R2') {
        const { client, bucket, sdk } = await this.r2();
        const result = await client.send(
          new sdk.GetObjectCommand({ Bucket: bucket, Key: ref.storageKey }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
        if (
          result.ContentLength !== ref.size ||
          result.ContentType !== ref.mediaType ||
          !result.Body
        ) {
          if (result.Body && 'destroy' in result.Body) result.Body.destroy();
          return unavailable();
        }
        const parts: Buffer[] = [];
        let size = 0;
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > ref.size) {
            if ('destroy' in result.Body) result.Body.destroy();
            return unavailable();
          }
          parts.push(Buffer.from(chunk));
        }
        bytes = Buffer.concat(parts);
      } else if (ref.storageProvider === 'LOCAL') {
        const path = join(await this.root(), ref.storageKey);
        if ((await realpath(path)) !== path) return unavailable();
        const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size !== ref.size) return unavailable();
          bytes = await handle.readFile();
        } finally {
          await handle.close();
        }
      } else return unavailable();
      if (
        bytes.length !== ref.size ||
        createHash('sha256').update(bytes).digest('hex') !== ref.sha256
      )
        return unavailable();
      return bytes;
    } catch {
      return unavailable();
    }
  }
}
