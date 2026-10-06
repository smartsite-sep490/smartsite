import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { StorageService } from '../src/integrations/storage/storage.service.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
const unavailable = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'SERVICE_UNAVAILABLE';
test('shared storage supports Local and mocked R2, retains old provider and is not limited to Safety JPEG', async () => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-storage-'));
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const calls: string[] = [];
  const send = mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    if (command instanceof PutObjectCommand) {
      calls.push('put');
      objects.set(command.input.Key!, {
        bytes: Buffer.from(command.input.Body as Buffer),
        type: command.input.ContentType!,
      });
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      calls.push('delete');
      objects.delete(command.input.Key!);
      return {};
    }
    if (command instanceof GetObjectCommand) {
      calls.push('get');
      const file = objects.get(command.input.Key!);
      if (!file) throw Error('missing');
      return {
        ContentLength: file.bytes.length,
        ContentType: file.type,
        Body: Readable.from([file.bytes]),
      };
    }
    throw Error('Unexpected SDK operation');
  });
  try {
    const local = new StorageService(
      new ConfigService(validateEnvironment({ NODE_ENV: 'test', STORAGE_LOCAL_ROOT: root })),
    );
    const bytes = Buffer.alloc(1048577, 1),
      old = await local.save(bytes, 'application/octet-stream', 'bin');
    const cloud = new StorageService(
      new ConfigService(
        validateEnvironment({
          NODE_ENV: 'test',
          STORAGE_PROVIDER: 'R2',
          STORAGE_LOCAL_ROOT: root,
          R2_ENDPOINT: 'https://fakeaccount.r2.cloudflarestorage.com',
          R2_BUCKET: 'synthetic-bucket',
          R2_ACCESS_KEY_ID: 'fake-access-key',
          R2_SECRET_ACCESS_KEY: 'fake-secret',
        }),
      ),
    );
    assert.deepEqual(await cloud.read(old), bytes);
    assert.deepEqual(calls, []);
    const fresh = await cloud.save(Buffer.from('synthetic'), 'text/plain', 'txt');
    assert.equal(fresh.storageProvider, 'R2');
    assert.deepEqual(await cloud.read(fresh), Buffer.from('synthetic'));
    await assert.rejects(cloud.read({ ...fresh, storageKey: '../bad.txt' }), unavailable);
    await assert.rejects(cloud.read({ ...fresh, sha256: '0'.repeat(64) }), unavailable);
    objects.set(fresh.storageKey, {
      bytes: Buffer.from('more bytes than expected'),
      type: 'text/plain',
    });
    await assert.rejects(cloud.read(fresh), unavailable);
    await cloud.remove(fresh);
    await assert.rejects(cloud.read(fresh), unavailable);
    assert.equal(calls.filter((c) => c === 'put').length, 1);
    await local.remove(old);
    await assert.rejects(
      new StorageService(
        new ConfigService(validateEnvironment({ NODE_ENV: 'test', STORAGE_PROVIDER: 'R2' })),
      ).save(Buffer.from('x'), 'text/plain', 'txt'),
      unavailable,
    );
  } finally {
    send.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});
test('R2 configuration rejects unsafe endpoints and logs redact credentials', () => {
  for (const endpoint of [
    'http://fake.r2.cloudflarestorage.com',
    'https://example.com',
    'https://user:pass@fake.r2.cloudflarestorage.com',
    'https://fake.r2.cloudflarestorage.com/path',
  ])
    assert.throws(() => validateEnvironment({ R2_ENDPOINT: endpoint }));
  assert.equal(
    validateEnvironment({ STORAGE_PROVIDER: 'R2', R2_ENDPOINT: '' }).R2_ENDPOINT,
    undefined,
  );
});

test('Local storage bootstrap does not load the unused R2 SDK', () => {
  const target = new URL('../src/integrations/storage/storage.service.js', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createRequire } from 'node:module';
    await import(${JSON.stringify(target)});
    const modules = Object.keys(createRequire(import.meta.url).cache);
    if (modules.some(path => path.includes('client-s3'))) process.exit(1);
  `,
    ],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
