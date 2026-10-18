import 'reflect-metadata';
import assert from 'node:assert/strict';
import childProcess, { type ExecFileOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { LocalDocumentOcr } from '../src/modules/workforce/documents/local-document-ocr.js';
import { createTestConfig } from './support/config.js';

test('local OCR confines originals, strips secrets, serializes work and releases its temporary directory', async (t) => {
  let calls = 0;
  let complete: (error: Error | null, stdout: string, stderr: string) => void;
  let options: ExecFileOptions = {};
  let input: Buffer | undefined;
  const fakeExec = (...args: unknown[]) => {
    calls++;
    assert.equal(args[0], process.execPath);
    const argv = args[1] as string[];
    assert.equal(argv[0], '-I');
    assert.equal(path.basename(argv[1]!), 'worker_document_ocr.py');
    assert.equal(argv[2], 'ocr');
    assert.equal(argv[3], 'image/png');
    options = args[2] as ExecFileOptions;
    complete = args[3] as typeof complete;
    const stdin = new PassThrough();
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    stdin.on('finish', () => {
      input = Buffer.concat(chunks);
    });
    return { stdin };
  };
  t.mock.method(childProcess, 'execFile', fakeExec);
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const runner = new LocalDocumentOcr(
    createTestConfig({ WORKER_DOCUMENT_PYTHON: process.execPath }),
  );
  const bytes = Buffer.from('synthetic original');
  const pending = runner.run(bytes, 'image/png', 'ocr');
  while (!calls) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await runner.run(bytes, 'image/png', 'ocr'), null);
  assert.equal(calls, 1);
  assert.equal(options.timeout, 60_000);
  assert.equal(options.maxBuffer, 8192);
  assert.equal(options.windowsHide, true);
  assert.equal(options.env?.DATABASE_URL, undefined);
  assert.equal(options.env?.SMARTSITE_AI_SERVICE_TOKEN, undefined);
  assert.equal(options.env?.OMP_THREAD_LIMIT, '1');
  const folder = String(options.cwd);
  assert.equal(options.env?.TEMP, folder);
  assert.ok(existsSync(folder));
  complete!(null, JSON.stringify({ status: 'UNAVAILABLE' }), '');
  assert.deepEqual(await pending, { status: 'UNAVAILABLE' });
  assert.deepEqual(input, bytes);
  assert.equal(existsSync(folder), false);
  const retry = runner.run(bytes, 'image/png', 'ocr');
  while (calls < 2) await new Promise<void>((resolve) => setImmediate(resolve));
  complete!(new Error('Synthetic engine failure containing private details'), '', '');
  assert.equal(await retry, null);
  assert.equal(existsSync(String(options.cwd)), false);
});

test('local OCR never starts a child without explicit configuration or for invalid/oversized input', async (t) => {
  let calls = 0;
  t.mock.method(childProcess, 'execFile', () => {
    calls++;
    throw new Error('Unexpected child');
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const absent = new LocalDocumentOcr(createTestConfig());
  assert.equal(await absent.run(Buffer.from('synthetic'), 'image/png', 'ocr'), null);
  const runner = new LocalDocumentOcr(
    createTestConfig({ WORKER_DOCUMENT_PYTHON: process.execPath }),
  );
  assert.equal(await runner.run(Buffer.alloc(0), 'image/png', 'ocr'), null);
  assert.equal(await runner.run(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png', 'ocr'), null);
  assert.equal(await runner.run(Buffer.from('synthetic'), 'text/html', 'ocr'), null);
  assert.equal(calls, 0);
});
