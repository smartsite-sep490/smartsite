import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { mock, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

const jpeg = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const scope = { eventId: '11111111-1111-4111-8111-111111111111', payloadHash: 'a'.repeat(64) };
const frameKey = (sha: string) => `ai-frame-${scope.eventId}-${scope.payloadHash}-${sha}.jpg`;
const unavailable = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'SERVICE_UNAVAILABLE';
const storage = (root?: string) =>
  new StorageService(
    new ConfigService(validateEnvironment({ NODE_ENV: 'test', STORAGE_LOCAL_ROOT: root })),
  );

test('AI frames are immutable, bounded, content-addressed and excluded from C02 enumeration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-frame-'));
  try {
    const service = storage(root);
    const sha = hash(jpeg);
    await service.saveAiFrame(jpeg, sha, scope);
    await service.saveAiFrame(jpeg, sha, scope);
    assert.deepEqual(await service.readAiFrame(sha, scope), jpeg);
    assert.deepEqual(await readFile(join(root, frameKey(sha))), jpeg);
    assert.equal(
      await service.readAiFrame(sha, { ...scope, eventId: '22222222-2222-4222-8222-222222222222' }),
      null,
    );
    assert.equal(await service.readAiFrame(sha, { ...scope, payloadHash: 'b'.repeat(64) }), null);
    const keys = [];
    for await (const batch of service.listEvidenceJpegKeyBatches('LOCAL')) keys.push(...batch);
    assert.deepEqual(keys, []);
    await assert.rejects(service.saveAiFrame(jpeg, '0'.repeat(64), scope), unavailable);
    await assert.rejects(
      service.saveAiFrame(Buffer.from('not jpeg'), hash(Buffer.from('not jpeg')), scope),
      unavailable,
    );
    const oversized = Buffer.concat([
      jpeg.subarray(0, 2),
      Buffer.alloc(1048576),
      jpeg.subarray(-2),
    ]);
    await assert.rejects(service.saveAiFrame(oversized, hash(oversized), scope), unavailable);
    assert.equal(await service.readAiFrame('../escape', scope), null);
    assert.equal(await service.readAiFrame('0'.repeat(64), scope), null);
    await writeFile(join(root, frameKey(sha)), Buffer.from('corrupt'));
    assert.equal(await service.readAiFrame(sha, scope), null);
    await assert.rejects(service.saveAiFrame(jpeg, sha, scope), unavailable);
    await writeFile(join(root, frameKey(sha)), oversized);
    assert.equal(await service.readAiFrame(sha, scope), null);
    const cancelled = AbortSignal.abort();
    await assert.rejects(service.readAiFrame(sha, scope, cancelled), { name: 'AbortError' });
    assert.equal(await storage().readAiFrame(sha, scope), null);
    await assert.rejects(storage().saveAiFrame(jpeg, sha, scope), unavailable);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('AI local frame reads and writes reject a symlink outside the configured root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ai-frame-links-'));
  const outside = await mkdtemp(join(tmpdir(), 'ai-frame-outside-'));
  try {
    const target = join(outside, 'outside.jpg');
    await writeFile(target, jpeg);
    try {
      await symlink(target, join(root, frameKey(hash(jpeg))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      t.skip('OS does not permit creating test symlinks');
      return;
    }
    assert.equal(await storage(root).readAiFrame(hash(jpeg), scope), null);
    await assert.rejects(storage(root).saveAiFrame(jpeg, hash(jpeg), scope), unavailable);
    assert.deepEqual(await readFile(target), jpeg);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('AI R2 frames verify metadata and stream size; ambiguous PUT never deletes a key', async () => {
  let mode = 'valid';
  const cancellation = new AbortController();
  const calls: string[] = [];
  const send = mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      calls.push('put');
      assert.equal(command.input.Key, frameKey(hash(jpeg)));
      assert.equal(command.input.IfNoneMatch, '*');
      if (mode === 'exists') throw { $metadata: { httpStatusCode: 412 } };
      if (mode === 'timeout') throw Error('private transport detail');
      return {};
    }
    if (command instanceof GetObjectCommand) {
      calls.push('get');
      if (mode === 'abort') {
        const body = new Readable({ read() {} });
        setImmediate(() => cancellation.abort());
        return { ContentLength: jpeg.length, ContentType: 'image/jpeg', Body: body };
      }
      return {
        ContentLength: mode === 'size' ? 1048577 : jpeg.length,
        ContentType: mode === 'type' ? 'text/plain' : 'image/jpeg',
        Body: Readable.from([
          mode === 'stream'
            ? Buffer.alloc(1048577)
            : mode === 'hash'
              ? Buffer.alloc(jpeg.length)
              : jpeg,
        ]),
      };
    }
    calls.push('unexpected-delete');
    throw Error('unexpected operation');
  });
  try {
    const service = new StorageService(
      new ConfigService(
        validateEnvironment({
          NODE_ENV: 'test',
          STORAGE_PROVIDER: 'R2',
          R2_ENDPOINT: 'https://fakeaccount.r2.cloudflarestorage.com',
          R2_BUCKET: 'synthetic-bucket',
          R2_ACCESS_KEY_ID: 'fake-access-key',
          R2_SECRET_ACCESS_KEY: 'fake-secret',
        }),
      ),
    );
    await service.saveAiFrame(jpeg, hash(jpeg), scope);
    assert.deepEqual(await service.readAiFrame(hash(jpeg), scope), jpeg);
    mode = 'exists';
    await service.saveAiFrame(jpeg, hash(jpeg), scope);
    for (mode of ['size', 'type', 'stream', 'hash'])
      assert.equal(await service.readAiFrame(hash(jpeg), scope), null);
    mode = 'timeout';
    await assert.rejects(service.saveAiFrame(jpeg, hash(jpeg), scope), unavailable);
    assert.equal(calls.includes('unexpected-delete'), false);
    mode = 'valid';
    assert.deepEqual(await service.readAiFrame(hash(jpeg), scope), jpeg);
    mode = 'abort';
    await assert.rejects(service.readAiFrame(hash(jpeg), scope, cancellation.signal), {
      name: 'AbortError',
    });
  } finally {
    send.mock.restore();
  }
});
