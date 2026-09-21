import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import type { BackendEnvironment } from '../src/config/environment.js';
import { createLoggerParams } from '../src/observability/logger.js';

class InputDto {
  @IsInt()
  @Min(1)
  count!: number;
}

class QueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  count!: number;
}

@Controller('test-foundation')
class FoundationTestController {
  @Post('dto')
  @HttpCode(200)
  validate(@Body() input: InputDto) {
    return input;
  }

  @Get('query')
  query(@Query() input: QueryDto) {
    new Logger('FoundationTestController').log('Validated query');
    return input;
  }

  @Get('conflict')
  conflict() {
    throw new ConflictException('Event already exists');
  }

  @Get('failure')
  failure() {
    throw new Error('postgresql://user:fake-secret@internal/db', {
      cause: new Error('Bearer fake-cause-token'),
    });
  }
}

@Controller('test-payload')
class PayloadTestController {
  @Post('json')
  @HttpCode(200)
  json(@Body() body: unknown) {
    return { ok: true, size: JSON.stringify(body).length };
  }

  @Post('urlencoded')
  @HttpCode(200)
  urlencoded(@Body() body: unknown) {
    return { ok: true, keys: Object.keys((body as Record<string, unknown>) ?? {}) };
  }
}

async function startApplication(
  t: TestContext,
  options: {
    production?: boolean;
    unavailable?: boolean;
    httpLimit?: number;
    aiLimit?: number;
  } = {},
) {
  const dataSource = {
    isInitialized: !options.unavailable,
    destroyed: false,
    async query(sql: string) {
      assert.equal(sql, 'SELECT 1');
      if (this.isInitialized === false) {
        throw new Error('postgresql://app:private-password@private-host/db');
      }
      return [{ '?column?': 1 }];
    },
    async destroy() {
      this.destroyed = true;
      this.isInitialized = false;
    },
    async close() {
      await this.destroy();
    },
  };
  const config = validateEnvironment({
    NODE_ENV: options.production ? 'production' : 'development',
    DATABASE_URL: 'postgresql://app:example@localhost:5432/app',
    CORS_ORIGINS: 'http://localhost:5173,https://app.example.com',
    SMARTSITE_AI_SERVICE_TOKEN: options.production ? 'prod-explicit-service-token' : undefined,
    LOG_FORMAT: 'json',
    HTTP_RATE_LIMIT_LIMIT: String(options.httpLimit ?? 120),
    AI_RATE_LIMIT_LIMIT: String(options.aiLimit ?? 600),
  });
  const logLines: string[] = [];
  const configService = new ConfigService<BackendEnvironment, true>(config);
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [FoundationTestController, PayloadTestController],
  })
    .overrideProvider(ConfigService)
    .useValue(configService)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(
      createLoggerParams(configService, {
        write: (line) => {
          logLines.push(line);
        },
      }),
    )
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);

  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, dataSource, logLines, url: await app.getUrl() };
}

test('liveness reports the exact public contract independently of database failure', async (t) => {
  const { url } = await startApplication(t, { unavailable: true });
  const response = await fetch(`${url}/api/v1/health/live`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'smartsite-backend' });
});

test('readiness tracks database failure and recovery without exposing connection details', async (t) => {
  const { url, dataSource } = await startApplication(t);
  const healthy = await fetch(`${url}/api/v1/health/ready`);
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), {
    status: 'ok',
    service: 'smartsite-backend',
    database: 'up',
  });
  dataSource.isInitialized = false;
  const unavailable = await fetch(`${url}/api/v1/health/ready`);
  assert.equal(unavailable.status, 503);
  const body = await assertError(unavailable, 503);
  assert.equal(body.status, 'error');
  assert.equal(body.service, 'smartsite-backend');
  assert.equal(body.database, 'down');
  dataSource.isInitialized = true;
  assert.equal((await fetch(`${url}/api/v1/health/ready`)).status, 200);
});

async function assertError(response: Response, status: number) {
  assert.equal(response.status, status);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.success, false);
  assert.equal(body.statusCode, status);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.match(String(body.requestId), /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
  assert.match(String(body.code), /^[A-Z_]+$/);
  assert.equal(new Date(String(body.timestamp)).toISOString(), body.timestamp);
  assert.ok(!String(body.path).includes('?'));
  return body;
}

test('validation rejects extra properties and implicit conversion; explicit query conversion works', async (t) => {
  const { url } = await startApplication(t);
  for (const payload of [{ count: 1, admin: true }, { count: '1' }, { count: 0 }]) {
    const response = await fetch(`${url}/api/v1/test-foundation/dto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const error = await assertError(response, 400);
    assert.ok(Array.isArray(error.message));
  }
  const valid = await fetch(`${url}/api/v1/test-foundation/dto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"count":1}',
  });
  assert.deepEqual(await valid.json(), { count: 1 });
  const query = await fetch(`${url}/api/v1/test-foundation/query?count=2`);
  assert.deepEqual(await query.json(), { count: 2 });
});

test('error contract covers missing route, unauthorized ingestion, conflict and unexpected failure', async (t) => {
  const { url, logLines } = await startApplication(t, { production: true });
  for (const [path, status, code] of [
    ['/missing', 404, 'NOT_FOUND'],
    ['/api/v1/test-foundation/conflict', 409, 'CONFLICT'],
    ['/api/v1/test-foundation/failure', 500, 'INTERNAL_SERVER_ERROR'],
  ] as const) {
    const response = await fetch(`${url}${path}?token=fake-query-secret`, {
      headers: { 'X-Request-Id': 'test.request_42' },
    });
    const error = await assertError(response, status);
    assert.equal(error.code, code);
    assert.equal(error.path, path);
    assert.equal(error.requestId, 'test.request_42');
    assert.doesNotMatch(JSON.stringify(error), /fake-|postgresql|internal\/db|stack/);
  }
  await assertError(await fetch(`${url}/api/v1/integrations/ai/events`, { method: 'POST' }), 401);
  const records = logLines.map(
    (line) =>
      JSON.parse(line) as {
        requestId?: string;
        req?: { id: string };
        res?: { statusCode: number };
        err?: unknown;
      },
  );
  const failures = records.filter((record) => record.res?.statusCode === 500);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.requestId, 'test.request_42');
  assert.equal(failures[0]?.req?.id, 'test.request_42');
  assert.ok(failures[0]?.err);
  assert.doesNotMatch(
    logLines.join(''),
    /fake-secret|fake-query-secret|fake-cause-token|postgresql:/,
  );
});

test('request ID survives parser failures and CORS preflight; invalid IDs are replaced', async (t) => {
  const { url, logLines } = await startApplication(t);
  for (const [body, status] of [
    ['{"secret":"fake-parser-secret",', 400],
    ['x'.repeat(1_048_577), 413],
  ] as const) {
    const response = await fetch(`${url}/api/v1/test-foundation/dto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'early-error-id' },
      body,
    });
    const error = await assertError(response, status);
    assert.equal(error.requestId, 'early-error-id');
    assert.doesNotMatch(JSON.stringify(error), /fake-parser-secret/);
  }
  for (const id of ['bad id', 'x'.repeat(65), '_bad-first', 'first, second']) {
    const response = await fetch(`${url}/api/v1/health/live`, { headers: { 'X-Request-Id': id } });
    assert.notEqual(response.headers.get('x-request-id'), id);
    assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
  }
  const response = await fetch(`${url}/api/v1/test-foundation/dto`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://app.example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-request-id',
      'X-Request-Id': 'preflight-id',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('x-request-id'), 'preflight-id');
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /x-request-id/i);
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /x-request-id/i);
  const records = logLines.map(
    (line) => JSON.parse(line) as { requestId?: string; res?: { statusCode: number } },
  );
  assert.deepEqual(
    records
      .filter((record) => record.requestId === 'early-error-id')
      .map((record) => record.res?.statusCode),
    [400, 413],
  );
  assert.equal(
    records.filter(
      (record) => record.requestId === 'preflight-id' && record.res?.statusCode === 204,
    ).length,
    1,
  );
  assert.doesNotMatch(logLines.join(''), /fake-parser-secret/);
});

test('Nest service logs carry the same request ID and Helmet sets security headers', async (t) => {
  const { url, logLines } = await startApplication(t);
  const response = await fetch(`${url}/api/v1/test-foundation/query?count=1&token=fake-query`, {
    headers: {
      'X-Request-Id': 'service-context-id',
      Cookie: 'fake-cookie',
      Authorization: 'Bearer fake-token',
    },
  });
  // The unknown query field is rejected at the boundary; then exercise a valid service call.
  await assertError(response, 400);
  const valid = await fetch(`${url}/api/v1/test-foundation/query?count=1`, {
    headers: { 'X-Request-Id': 'service-context-id' },
  });
  assert.equal(valid.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(valid.headers.get('content-security-policy'));
  assert.equal(valid.headers.get('x-powered-by'), null);
  const records = logLines.map((line) => JSON.parse(line) as { msg: string; requestId?: string });
  const serviceLog = records.find((record) => record.msg === 'Validated query');
  assert.equal(serviceLog?.requestId, valid.headers.get('x-request-id'));
  assert.doesNotMatch(logLines.join(''), /fake-query|fake-cookie|fake-token/);
});

test('body parser client errors retain 400/413/415 with safe messages', async (t) => {
  const { url } = await startApplication(t);
  const cases = [
    {
      headers: { 'Content-Type': 'application/json; charset=FAKE_CHARSET_SECRET' },
      body: '{}',
      status: 415,
    },
    {
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'FAKE_ENCODING_SECRET' },
      body: '{}',
      status: 415,
    },
    {
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: 'invalid gzip',
      status: 400,
    },
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Array.from({ length: 1001 }, (_, i) => `field${i}=x`).join('&'),
      status: 413,
    },
  ];
  for (const { headers, body, status } of cases) {
    const response = await fetch(`${url}/api/v1/test-payload/urlencoded`, {
      method: 'POST',
      headers: headers as Record<string, string>,
      body,
    });
    const error = await assertError(response, status);
    assert.doesNotMatch(JSON.stringify(error), /FAKE_|fake_|invalid gzip/);
  }
});

test('HTTP and AI limits are independent, health is exempt, forwarded IP cannot bypass limits', async (t) => {
  const { url } = await startApplication(t, { httpLimit: 1, aiLimit: 3 });
  assert.equal((await fetch(`${url}/api/v1/test-foundation/query?count=1`)).status, 200);
  const limited = await fetch(`${url}/api/v1/test-foundation/query?count=1`, {
    headers: { 'X-Forwarded-For': '203.0.113.2' },
  });
  await assertError(limited, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  for (let i = 0; i < 4; i++) {
    assert.equal((await fetch(`${url}/api/v1/health/live`)).status, 200);
    assert.equal((await fetch(`${url}/api/v1/health/ready`)).status, 200);
  }
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${url}/api/v1/integrations/ai/events`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer smartsite_local_dev_service_token_only',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const error = await assertError(response, 400);
    assert.ok(Array.isArray(error.issues));
  }
  const aiLimited = await fetch(`${url}/api/v1/integrations/ai/events`, { method: 'POST' });
  await assertError(aiLimited, 429);
  assert.ok(Number(aiLimited.headers.get('retry-after')) > 0);
});

test('CORS grants exact allowed origins and excludes lookalikes and null origins', async (t) => {
  const { url } = await startApplication(t);
  for (const origin of ['http://localhost:5173', 'https://app.example.com']) {
    const response = await fetch(`${url}/api/v1/health/live`, { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
  }
  for (const origin of ['https://app.example.com.evil.example', 'http://localhost:51730', 'null']) {
    const response = await fetch(`${url}/api/v1/health/live`, { headers: { Origin: origin } });
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  const preflight = await fetch(`${url}/api/v1/health/live`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.com');
});

test('development OpenAPI describes both real health routes', async (t) => {
  const { url } = await startApplication(t);
  assert.equal((await fetch(`${url}/api/docs`)).status, 200);
  const response = await fetch(`${url}/api/docs-json`);
  assert.equal(response.status, 200);
  const schema = (await response.json()) as { paths: Record<string, unknown> };
  assert.ok(schema.paths['/api/v1/health/live']);
  assert.ok(schema.paths['/api/v1/health/ready']);
});

test('production does not publish Swagger UI or its schema', async (t) => {
  const { url } = await startApplication(t, { production: true });
  assert.equal((await fetch(`${url}/api/docs`)).status, 404);
  assert.equal((await fetch(`${url}/api/docs-json`)).status, 404);
});

test('application shutdown closes its PostgreSQL connection', async (t) => {
  const { app, dataSource } = await startApplication(t);
  await app.close();
  assert.equal(dataSource.destroyed, true);
});

test('1 MB body boundary: JSON payload exact 1048576 bytes is accepted (200) and 1048577 bytes is rejected (413)', async (t) => {
  const { url } = await startApplication(t);

  // Exactly 1,048,576 bytes (1 MB) -> 200 OK
  const exact1MbJson = '{"d":"' + 'a'.repeat(1_048_576 - 8) + '"}';
  assert.equal(Buffer.byteLength(exact1MbJson, 'utf8'), 1_048_576);
  const exactRes = await fetch(`${url}/api/v1/test-payload/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: exact1MbJson,
  });
  assert.equal(exactRes.status, 200);
  const exactBody = (await exactRes.json()) as { ok: boolean };
  assert.equal(exactBody.ok, true);

  // Exactly 1,048,577 bytes (1 MB + 1 byte) -> 413 Payload Too Large
  const over1MbJson = '{"d":"' + 'a'.repeat(1_048_577 - 8) + '"}';
  assert.equal(Buffer.byteLength(over1MbJson, 'utf8'), 1_048_577);
  const overRes = await fetch(`${url}/api/v1/test-payload/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: over1MbJson,
  });
  assert.equal(overRes.status, 413);
});

test('1 MB body boundary: urlencoded payload exact 1048576 bytes is accepted (200) and 1048577 bytes is rejected (413)', async (t) => {
  const { url } = await startApplication(t);

  // Exactly 1,048,576 bytes (1 MB) -> 200 OK
  const exact1MbUrl = 'd=' + 'a'.repeat(1_048_576 - 2);
  assert.equal(Buffer.byteLength(exact1MbUrl, 'utf8'), 1_048_576);
  const exactRes = await fetch(`${url}/api/v1/test-payload/urlencoded`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: exact1MbUrl,
  });
  assert.equal(exactRes.status, 200);
  const exactBody = (await exactRes.json()) as { ok: boolean; keys: string[] };
  assert.equal(exactBody.ok, true);
  assert.deepEqual(exactBody.keys, ['d']);

  // Exactly 1,048,577 bytes (1 MB + 1 byte) -> 413 Payload Too Large
  const over1MbUrl = 'd=' + 'a'.repeat(1_048_577 - 2);
  assert.equal(Buffer.byteLength(over1MbUrl, 'utf8'), 1_048_577);
  const overRes = await fetch(`${url}/api/v1/test-payload/urlencoded`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: over1MbUrl,
  });
  assert.equal(overRes.status, 413);
});
