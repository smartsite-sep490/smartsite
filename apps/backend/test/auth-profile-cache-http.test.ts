import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { AuthClientType } from '../src/database/entities/auth-session.entity.js';
import { createTestConfig } from './support/config.js';
import { createLoggerParams } from '../src/observability/logger.js';

test('HTTP account profiles forbid storage and expose the current role snapshot', async (t) => {
  const config = createTestConfig();
  const siteId = randomUUID();
  const user = {
    id: randomUUID(),
    username: 'synthetic-profile',
    displayName: 'Synthetic Profile',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
  };
  let reads = 0;
  const database = {
    isInitialized: true,
    query: async () => [{ ok: 1 }],
    destroy: async () => undefined,
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(database)
    .overrideProvider(DataSource)
    .useValue(database)
    .overrideProvider(AuthService)
    .useValue({
      authenticate: async () => {
        reads += 1;
        return { user, sessionId: randomUUID(), clientType: AuthClientType.WEB };
      },
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  t.after(() => app.close());
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/api/v1/auth/me`;
  const headers = { Authorization: `Bearer ${'A'.repeat(16)}.${'A'.repeat(16)}.${'A'.repeat(16)}` };
  const first = await fetch(url, { headers });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await first.json()).roleAssignments, user.roleAssignments);
  user.roleAssignments = [{ role: UserRole.SECURITY_OFFICER, siteId }];
  const second = await fetch(url, { headers });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await second.json()).roleAssignments, user.roleAssignments);
  assert.equal(reads, 2);
});
