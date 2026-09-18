import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { DATABASE_POOL } from '../src/database/database.service.js';

async function startApplication(
  t: TestContext,
  options: { production?: boolean; unavailable?: boolean } = {},
) {
  const database = {
    unavailable: options.unavailable ?? false,
    closed: false,
    async query(sql: string) {
      assert.equal(sql, 'SELECT 1');
      if (this.unavailable) throw new Error('postgresql://app:private-password@private-host/db');
      return { rows: [{ '?column?': 1 }], rowCount: 1, fields: [], command: 'SELECT', oid: 0 };
    },
    async end() {
      this.closed = true;
    },
  };
  const config = validateEnvironment({
    NODE_ENV: options.production ? 'production' : 'development',
    DATABASE_URL: 'postgresql://app:example@localhost:5432/app',
    CORS_ORIGINS: 'http://localhost:5173,https://app.example.com',
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(config))
    .overrideProvider(DATABASE_POOL)
    .useValue(database)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  return { app, database, url: await app.getUrl() };
}

test('liveness reports the exact public contract independently of database failure', async (t) => {
  const { url } = await startApplication(t, { unavailable: true });
  const response = await fetch(`${url}/api/v1/health/live`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', service: 'smartsite-backend' });
});

test('readiness tracks database failure and recovery without exposing connection details', async (t) => {
  const { url, database } = await startApplication(t);
  const healthy = await fetch(`${url}/api/v1/health/ready`);
  assert.equal(healthy.status, 200);
  assert.deepEqual(await healthy.json(), {
    status: 'ok',
    service: 'smartsite-backend',
    database: 'up',
  });
  database.unavailable = true;
  const unavailable = await fetch(`${url}/api/v1/health/ready`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    status: 'error',
    service: 'smartsite-backend',
    database: 'down',
  });
  database.unavailable = false;
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

test('application shutdown closes its PostgreSQL pool', async (t) => {
  const { app, database } = await startApplication(t);
  await app.close();
  assert.equal(database.closed, true);
});
