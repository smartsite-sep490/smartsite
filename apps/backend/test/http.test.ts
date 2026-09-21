import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';

async function startApplication(
  t: TestContext,
  options: { production?: boolean; unavailable?: boolean } = {},
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
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(config))
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  configureApplication(app);

  // Test-only routes to verify body parser limits without altering production routing
  interface MockExpressRequest {
    body: unknown;
  }
  interface MockExpressResponse {
    status(code: number): MockExpressResponse;
    json(body: unknown): void;
  }
  const expressApp = app.getHttpAdapter().getInstance() as {
    post(path: string, handler: (req: MockExpressRequest, res: MockExpressResponse) => void): void;
  };
  expressApp.post(
    '/api/v1/test-payload/json',
    (req: MockExpressRequest, res: MockExpressResponse) => {
      res.status(200).json({ ok: true, size: JSON.stringify(req.body).length });
    },
  );
  expressApp.post(
    '/api/v1/test-payload/urlencoded',
    (req: MockExpressRequest, res: MockExpressResponse) => {
      res.status(200).json({
        ok: true,
        keys: Object.keys((req.body as Record<string, unknown>) ?? {}),
      });
    },
  );

  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, dataSource, url: await app.getUrl() };
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
  assert.deepEqual(await unavailable.json(), {
    status: 'error',
    service: 'smartsite-backend',
    database: 'down',
  });
  dataSource.isInitialized = true;
  assert.equal((await fetch(`${url}/api/v1/health/ready`)).status, 200);
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
