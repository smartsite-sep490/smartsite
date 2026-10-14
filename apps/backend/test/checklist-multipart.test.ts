import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { checklistMultipartStorage } from '../src/modules/safety/checklist-multipart.storage.js';
test('multipart byte budget spans all files in one submission and releases stored bytes', async () => {
  const storage = checklistMultipartStorage(),
    request = {};
  const add = (bytes: number) =>
    new Promise<{ buffer?: Buffer; size?: number }>((resolve, reject) =>
      storage._handleFile(
        request,
        { stream: Readable.from([Buffer.alloc(bytes)]) },
        (error, info) => (error ? reject(error) : resolve(info!)),
      ),
    );
  const file = await add(5 * 1024 * 1024);
  assert.equal(file.size, 5 * 1024 * 1024);
  await add(5 * 1024 * 1024);
  await add(5 * 1024 * 1024);
  await add(5 * 1024 * 1024);
  await assert.rejects(add(1), (e) => (e as { status?: number }).status === 413);
  storage._removeFile(request, file, () => {});
  assert.equal(file.buffer, undefined);
});
