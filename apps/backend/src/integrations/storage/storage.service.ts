import { randomUUID, createHash } from 'node:crypto';
import { mkdir, realpath, open, opendir, unlink, lstat, link } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
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
  /^(?:c02-evidence-(?:[0-9]{13}-)?)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/.test(
    key,
  );
const AI_FRAME_LIMIT = 1_048_576;
const aiFrameHash = (value: string) => /^[0-9a-f]{64}$/.test(value);
const validAiFrame = (bytes: Buffer, sha256: string) =>
  Buffer.isBuffer(bytes) &&
  bytes.length >= 4 &&
  bytes.length <= AI_FRAME_LIMIT &&
  bytes[0] === 0xff &&
  bytes[1] === 0xd8 &&
  bytes[bytes.length - 2] === 0xff &&
  bytes[bytes.length - 1] === 0xd9 &&
  createHash('sha256').update(bytes).digest('hex') === sha256;
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
  private async root(create = true) {
    const root =
      this.config.get('STORAGE_LOCAL_ROOT', { infer: true }) ??
      this.config.get('SAFETY_UPLOAD_LOCAL_ROOT', { infer: true });
    if (!root) return unavailable();
    try {
      if (create) await mkdir(root, { recursive: true, mode: 0o700 });
      return await realpath(root);
    } catch {
      return unavailable();
    }
  }
  private async aiRoot(create: boolean): Promise<string> {
    const root =
      this.config.get('STORAGE_LOCAL_ROOT', { infer: true }) ??
      this.config.get('SAFETY_UPLOAD_LOCAL_ROOT', { infer: true });
    if (!root || !isAbsolute(root)) return unavailable();
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return unavailable();
    return realpath(root);
  }

  /** Private immutable frame namespace; deliberately excluded from C02 inventory/cleanup. */
  async saveAiFrame(bytes: Buffer, expectedSha256: string): Promise<void> {
    if (!aiFrameHash(expectedSha256) || !validAiFrame(bytes, expectedSha256)) return unavailable();
    const content = Buffer.from(bytes);
    const key = `ai-frame-${expectedSha256}.jpg`;
    try {
      const provider = this.config.get('STORAGE_PROVIDER', { infer: true });
      if (provider === 'R2') {
        const { client, bucket, sdk } = await this.r2();
        try {
          await client.send(
            new sdk.PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: content,
              ContentType: 'image/jpeg',
              ContentLength: content.length,
              IfNoneMatch: '*',
            }),
            { abortSignal: AbortSignal.timeout(30000) },
          );
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412
          )
            throw error;
          if (!(await this.readAiFrame(expectedSha256))) return unavailable();
        }
        // An ambiguous PUT must never delete an existing content-addressed object.
      } else if (provider === 'LOCAL' || provider === undefined) {
        const root = await this.aiRoot(true);
        const temporary = join(root, `.ai-frame-${randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        try {
          try {
            await handle.writeFile(content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          try {
            await link(temporary, join(root, key));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            if (!(await this.readAiFrame(expectedSha256))) return unavailable();
          }
        } finally {
          await unlink(temporary);
        }
      } else return unavailable();
    } catch {
      return unavailable();
    }
  }

  /** Missing, corrupt or unavailable media stays unavailable; caller cancellation propagates. */
  async readAiFrame(sha256: string, signal?: AbortSignal): Promise<Buffer | null> {
    signal?.throwIfAborted();
    if (!aiFrameHash(sha256)) return null;
    const key = `ai-frame-${sha256}.jpg`;
    try {
      let bytes: Buffer;
      const provider = this.config.get('STORAGE_PROVIDER', { infer: true });
      if (provider === 'R2') {
        const { client, bucket, sdk } = await this.r2();
        const abort = AbortSignal.any([AbortSignal.timeout(30000), ...(signal ? [signal] : [])]);
        const result = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: abort,
        });
        const body = result.Body;
        const destroy = () => {
          if (body && 'destroy' in body) body.destroy();
        };
        abort.addEventListener('abort', destroy, { once: true });
        try {
          abort.throwIfAborted();
          if (
            !body ||
            result.ContentType !== 'image/jpeg' ||
            !Number.isSafeInteger(result.ContentLength) ||
            result.ContentLength! < 4 ||
            result.ContentLength! > AI_FRAME_LIMIT
          )
            return null;
          const parts: Buffer[] = [];
          let size = 0;
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            abort.throwIfAborted();
            size += chunk.length;
            if (size > result.ContentLength!) return null;
            parts.push(Buffer.from(chunk));
          }
          if (size !== result.ContentLength) return null;
          bytes = Buffer.concat(parts);
        } finally {
          abort.removeEventListener('abort', destroy);
          destroy();
        }
      } else if (provider === 'LOCAL' || provider === undefined) {
        const root = await this.aiRoot(false);
        signal?.throwIfAborted();
        const path = join(root, key);
        const before = await lstat(path);
        signal?.throwIfAborted();
        if (!before.isFile() || before.isSymbolicLink() || (await realpath(path)) !== path)
          return null;
        const handle = await open(
          path,
          constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
        );
        try {
          const stat = await handle.stat();
          signal?.throwIfAborted();
          if (
            !stat.isFile() ||
            stat.size < 4 ||
            stat.size > AI_FRAME_LIMIT ||
            stat.dev !== before.dev ||
            stat.ino !== before.ino
          )
            return null;
          const buffer = Buffer.alloc(AI_FRAME_LIMIT + 1);
          let size = 0;
          while (size < buffer.length) {
            signal?.throwIfAborted();
            const result = await handle.read(buffer, size, buffer.length - size, size);
            if (!result.bytesRead) break;
            size += result.bytesRead;
          }
          if (size !== stat.size) return null;
          bytes = Buffer.from(buffer.subarray(0, size));
        } finally {
          await handle.close();
        }
      } else return null;
      signal?.throwIfAborted();
      return validAiFrame(bytes, sha256) ? bytes : null;
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }
  /** Enumerates flat JPEG keys only. The caller must verify ownership against receipts. */
  async *listEvidenceJpegKeyBatches(
    provider: StoredObject['storageProvider'],
    signal?: AbortSignal,
  ): AsyncGenerator<string[]> {
    const limit = 200;
    const isJpegKey = (key: string) => key.endsWith('.jpg') && validKey(key);
    signal?.throwIfAborted();
    if (provider === 'LOCAL') {
      const directory = await opendir(await this.root(false));
      let batch: string[] = [];
      for await (const entry of directory) {
        signal?.throwIfAborted();
        if (!entry.isFile() || !isJpegKey(entry.name)) continue;
        batch.push(entry.name);
        if (batch.length === limit) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length) yield batch;
      return;
    }
    if (provider !== 'R2') return unavailable();
    const { client, bucket, sdk } = await this.r2();
    let cursor: string | undefined;
    do {
      signal?.throwIfAborted();
      const response = await client.send(
        new sdk.ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: limit,
          ContinuationToken: cursor,
        }),
        {
          abortSignal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
            : AbortSignal.timeout(30000),
        },
      );
      if ((response.Contents?.length ?? 0) > limit) return unavailable();
      const next = response.IsTruncated ? response.NextContinuationToken : undefined;
      if (response.IsTruncated && (!next || next === cursor)) return unavailable();
      const keys = (response.Contents ?? []).flatMap(({ Key }) =>
        Key && isJpegKey(Key) ? [Key] : [],
      );
      if (keys.length) yield keys;
      cursor = next;
    } while (cursor);
  }

  async save(
    bytes: Buffer,
    mediaType: string,
    extension: string,
    namespace?: 'c02-evidence',
  ): Promise<StoredObject> {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      (namespace !== undefined &&
        (namespace !== 'c02-evidence' || mediaType !== 'image/jpeg' || extension !== 'jpg')) ||
      !/^[a-z0-9]{1,12}$/.test(extension) ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType)
    )
      return unavailable();
    const ref: StoredObject = {
      storageProvider: this.config.get('STORAGE_PROVIDER', { infer: true }) ?? 'LOCAL',
      storageKey:
        (namespace ? namespace + '-' + Date.now() + '-' : '') + randomUUID() + '.' + extension,
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
      await this.removeChecked(ref);
    } catch {
      this.logger.error({
        event: 'storage_cleanup_failed',
        provider: ref.storageProvider,
        objectId: ref.storageKey.split('.')[0],
      });
    }
  }

  async removeChecked(ref: Pick<StoredObject, 'storageProvider' | 'storageKey'>): Promise<void> {
    if (!validKey(ref.storageKey)) return unavailable();
    if (ref.storageProvider === 'R2') {
      const { client, bucket, sdk } = await this.r2();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: ref.storageKey }), {
        abortSignal: AbortSignal.timeout(30000),
      });
    } else if (ref.storageProvider === 'LOCAL') {
      await unlink(join(await this.root(false), ref.storageKey)).catch((error: unknown) => {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      });
    } else return unavailable();
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
