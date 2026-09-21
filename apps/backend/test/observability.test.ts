import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { requestIdMiddleware } from '../src/common/http/request-id.js';
import { createHttpLoggerOptions } from '../src/observability/logger.js';
import { sanitizeError } from '../src/observability/sanitize-error.js';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';

const databaseUrl = 'postgresql://user:FAKE_DATABASE_PASSWORD@localhost/test';
const token = 'FAKE_SERVICE_TOKEN';
function config(input: Record<string, unknown> = {}) {
  return new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      SMARTSITE_AI_SERVICE_TOKEN: token,
      ...input,
    }),
  );
}

test('request IDs accept one bounded raw header and replace invalid or duplicate fields', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const cases = [
    { headers: ['x-request-id', 'A.valid_Id-1'], expected: 'A.valid_Id-1' },
    { headers: ['X-Request-Id', 'a'.repeat(64)], expected: 'a'.repeat(64) },
    { headers: [] },
    { headers: ['x-request-id', ''] },
    { headers: ['x-request-id', 'a'.repeat(65)] },
    { headers: ['x-request-id', '-not-starting-with-alphanumeric'] },
    { headers: ['x-request-id', 'has space'] },
    { headers: ['x-request-id', 'one,two'] },
    { headers: ['x-request-id', 'same', 'X-Request-Id', 'same'] },
  ];
  for (const { headers, expected } of cases) {
    const req = { rawHeaders: headers, id: 'must-not-be-trusted' } as Request;
    let responseId: unknown;
    let nextCalls = 0;
    const res = {
      setHeader(name: string, value: unknown) {
        assert.equal(name, 'X-Request-Id');
        responseId = value;
      },
    } as Response;
    requestIdMiddleware(req, res, () => {
      nextCalls += 1;
    });
    assert.equal(nextCalls, 1);
    assert.equal(req.id, responseId);
    if (expected) assert.equal(req.id, expected);
    else assert.match(String(req.id), uuid);
  }
});

test('JSON logging removes credentials and omits body, query, evidence and error/cause text', () => {
  const lines: string[] = [];
  const logger = pino(createHttpLoggerOptions(config()), {
    write: (line) => {
      lines.push(line);
    },
  });
  const secretError = Object.assign(
    new Error(`FAKE_BODY ${token} ${databaseUrl}`, {
      cause: new Error('FAKE_QUERY FAKE_COOKIE FAKE_AUTHORIZATION'),
    }),
    { code: 'ECONNREFUSED', body: 'FAKE_BODY', query: 'FAKE_QUERY' },
  );
  logger.error(secretError);
  logger.error({ err: secretError }, 'FAKE_BODY');
  logger.info(
    {
      body: 'FAKE_BODY',
      query: 'FAKE_QUERY',
      rawPayload: 'FAKE_EVIDENCE',
      headers: {
        authorization: 'FAKE_AUTHORIZATION',
        cookie: 'FAKE_COOKIE',
        'set-cookie': 'FAKE_SET_COOKIE',
      },
    },
    `Configured ${token} ${databaseUrl}`,
  );
  const output = lines.join('');
  for (const secret of [
    token,
    databaseUrl,
    'FAKE_BODY',
    'FAKE_QUERY',
    'FAKE_COOKIE',
    'FAKE_SET_COOKIE',
    'FAKE_AUTHORIZATION',
    'FAKE_EVIDENCE',
  ]) {
    assert.ok(!output.includes(secret), `Must omit ${secret}`);
  }
  assert.equal(lines.length, 3);
  const failure = JSON.parse(lines[0]!) as {
    err: { type: string; code: string; stack: string[]; cause: unknown };
  };
  assert.equal(failure.err.type, 'Error');
  assert.equal(failure.err.code, 'ECONNREFUSED');
  assert.ok(failure.err.stack.length > 0);
  assert.ok(failure.err.cause);
});

test('one HTTP completion log retains the response request ID and excludes sensitive HTTP data', async (t) => {
  const lines: string[] = [];
  const options = createHttpLoggerOptions(config());
  const logger = pinoHttp(options, {
    write: (line) => {
      lines.push(line);
    },
  });
  const server = createServer((req, res) => {
    requestIdMiddleware(req as Request, res as Response, () => {
      logger(req, res);
      res.setHeader('Set-Cookie', 'FAKE_SET_COOKIE');
      res.statusCode = 500;
      res.err = new Error('FAKE_BODY', { cause: new Error('FAKE_QUERY') });
      res.end(String(req.id));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const id = await new Promise<string>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/early-error?token=FAKE_QUERY',
        headers: [
          'Host',
          '127.0.0.1',
          'X-Request-Id',
          'duplicate',
          'x-request-id',
          'duplicate',
          'Authorization',
          'FAKE_AUTHORIZATION',
          'Cookie',
          'FAKE_COOKIE',
        ],
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          assert.equal(body, res.headers['x-request-id']);
          assert.notEqual(body, 'duplicate');
          resolve(body);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]!) as {
    requestId: string;
    req: { id: string; path: string };
    res: { statusCode: number };
    err: unknown;
  };
  assert.equal(record.requestId, id);
  assert.equal(record.req.id, id);
  assert.equal(record.req.path, '/early-error');
  assert.equal(record.res.statusCode, 500);
  assert.ok(record.err);
  for (const secret of [
    'FAKE_QUERY',
    'FAKE_BODY',
    'FAKE_AUTHORIZATION',
    'FAKE_COOKIE',
    'FAKE_SET_COOKIE',
  ]) {
    assert.ok(!lines[0]!.includes(secret));
  }
});

test('safe bootstrap diagnostics retain configuration field rules without values', () => {
  let failure: unknown;
  try {
    validateEnvironment({ NODE_ENV: 'test', PORT: 'FAKE_SECRET_INVALID_PORT' });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  const diagnostic = JSON.stringify(sanitizeError(failure));
  assert.match(diagnostic, /PORT/);
  assert.match(diagnostic, /integer/);
  assert.ok(!diagnostic.includes('FAKE_SECRET_INVALID_PORT'));
});

test('real bootstrap exits unsuccessfully with safe configuration diagnostics', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../src/main.js', import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: 'FAKE_BOOTSTRAP_SECRET',
        DATABASE_URL: databaseUrl,
        CORS_ORIGINS: '',
        SMARTSITE_AI_SERVICE_TOKEN: token,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /Backend failed to start/);
  assert.match(output, /PORT/);
  assert.doesNotMatch(output, /FAKE_BOOTSTRAP_SECRET|FAKE_DATABASE_PASSWORD|FAKE_SERVICE_TOKEN/);
});

test('JSON mode never configures pino-pretty, while development pretty mode does', () => {
  assert.equal(createHttpLoggerOptions(config()).transport, undefined);
  assert.equal(
    createHttpLoggerOptions(config({ NODE_ENV: 'production', CORS_ORIGINS: '' })).transport,
    undefined,
  );
  const pretty = createHttpLoggerOptions(config({ NODE_ENV: 'development' })).transport;
  assert.deepEqual(pretty, {
    target: 'pino-pretty',
    options: { colorize: true, singleLine: true },
  });
});
