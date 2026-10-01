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
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { createLoggerParams } from '../src/observability/logger.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { ObservationIdentityController } from '../src/modules/safety/identity/observation-identity.controller.js';
import { ObservationIdentityContextService } from '../src/modules/safety/identity/observation-identity-context.service.js';
import { ObservationIdentityResolutionService } from '../src/modules/safety/identity/observation-identity-resolution.service.js';
import { ObservationIdentityAccessGuard } from '../src/modules/safety/identity/observation-identity-access.guard.js';

test('normal application keeps identity endpoints gated until the approved Worker reader registration', async (t) => {
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({ NODE_ENV: 'test', LOG_FORMAT: 'json' }),
  );
  const db = {
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
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const prefix = `${await app.getUrl()}/api/v1/sites/${randomUUID()}/safety-alerts/${randomUUID()}/detections/${randomUUID()}/identity-subjects`;
  for (const suffix of ['', '/workers', '/0/decisions'])
    assert.equal((await fetch(`${prefix}${suffix}`)).status, 404);
  assert.equal(
    (
      await fetch(`${prefix}/0/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    404,
  );
});

test('identity HTTP requires same-Site Safety Officer for context/picker/history/command; runtime registration stays gated', async (t) => {
  const siteId = randomUUID(),
    alertId = randomUUID(),
    eventId = randomUUID(),
    actorId = randomUUID(),
    otherSite = randomUUID();
  const prefix = `/api/v1/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/identity-subjects`;
  const jwt = (c: string) => `${c.repeat(16)}.${c.repeat(16)}.${c.repeat(16)}`;
  const roleSets: Record<string, { role: UserRole; siteId: string | null }[]> = {
    S: [{ role: UserRole.SAFETY_OFFICER, siteId }],
    A: [{ role: UserRole.ADMIN, siteId: null }],
    X: [{ role: UserRole.SAFETY_OFFICER, siteId: otherSite }],
    N: [{ role: UserRole.SAFETY_OFFICER, siteId: null }],
    B: [
      { role: UserRole.ADMIN, siteId: null },
      { role: UserRole.SAFETY_OFFICER, siteId },
    ],
    W: [{ role: UserRole.WORKER, siteId }],
    R: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
    M: [{ role: UserRole.SITE_MANAGER, siteId }],
    T: [{ role: UserRole.SAFETY_OFFICER, siteId }],
    D: [{ role: UserRole.SAFETY_OFFICER, siteId }],
  };
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({ NODE_ENV: 'test', LOG_FORMAT: 'json', HTTP_RATE_LIMIT_LIMIT: '1000' }),
  );
  const db = {
    isInitialized: true,
    query: async () => [{ ok: 1 }],
    destroy: async () => undefined,
  };
  const context = {
    eventId,
    payloadHash: 'a'.repeat(64),
    eventConsistent: true,
    frames: [],
    subjects: [],
  };
  let calls = 0;
  const services = {
    get: async () => {
      calls++;
      return context;
    },
    listWorkers: async () => {
      calls++;
      return { items: [], total: 0 };
    },
  };
  const decisions = {
    listDecisions: async () => {
      calls++;
      return { items: [], total: 0 };
    },
    readContextRecords: async () => ({ event: { eventId }, heads: [] }),
    decide: async () => {
      calls++;
      throw new Error('Synthetic unhandled internal failure');
    },
  };
  const module = await Test.createTestingModule({
    imports: [AppModule, AuthModule],
    controllers: [ObservationIdentityController],
    providers: [
      ObservationIdentityAccessGuard,
      { provide: ObservationIdentityContextService, useValue: services },
      { provide: ObservationIdentityResolutionService, useValue: decisions },
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(AuthService)
    .useValue({
      authenticate: async (token: string) => {
        const c = token[0]!;
        return {
          user: {
            id: actorId,
            username: 'synthetic',
            displayName: 'Synthetic reviewer',
            roleAssignments: roleSets[c] ?? [],
            isActive: c !== 'D',
            mustChangePassword: c === 'T',
          },
          sessionId: randomUUID(),
          clientType: 'WEB',
        };
      },
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = await app.getUrl();
  for (const endpoint of [prefix, `${prefix}/workers`, `${prefix}/0/decisions`]) {
    for (const c of ['S', 'B']) {
      const response = await fetch(`${base}${endpoint}`, {
        headers: { Authorization: `Bearer ${jwt(c)}` },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    }
    for (const c of ['A', 'X', 'N', 'W', 'R', 'M', 'T', 'D']) {
      const before = calls;
      const response = await fetch(`${base}${endpoint}`, {
        headers: { Authorization: `Bearer ${jwt(c)}` },
      });
      assert.equal(response.status, 403);
      assert.equal(calls, before);
    }
    assert.equal((await fetch(`${base}${endpoint}`)).status, 401);
  }
  const body = {
    commandId: randomUUID(),
    expectedRevision: 0,
    expectedEventHash: 'a'.repeat(64),
    action: 'CLEAR',
    reason: 'Synthetic identity withdrawn.',
  };
  for (const c of ['A', 'X', 'W', 'R', 'M', 'T', 'D'])
    assert.equal(
      (
        await fetch(`${base}${prefix}/0/decisions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt(c)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status,
      403,
    );
  for (const url of [
    `${prefix}/workers?surprise=true`,
    `${prefix}/workers?limit=101`,
    `${prefix}/workers?offset=-1`,
    `${prefix}/workers?limit=1&limit=2`,
    `${prefix}?unexpected=true`,
    `${prefix}/00/decisions`,
    `${prefix}/256/decisions`,
  ]) {
    const response = await fetch(`${base}${url}`, {
      headers: { Authorization: `Bearer ${jwt('S')}` },
    });
    assert.equal(response.status, 400);
  }
  const invalid = await fetch(`${base}${prefix}/0/decisions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt('S')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, workerId: randomUUID() }),
  });
  assert.equal(invalid.status, 400);
  const internal = await fetch(`${base}${prefix}/0/decisions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt('S')}`,
      'Content-Type': 'application/json',
      'X-Request-Id': 'identity-review-request',
    },
    body: JSON.stringify(body),
  });
  assert.equal(internal.status, 500);
  const error = (await internal.json()) as { requestId: string; message: string; code: string };
  assert.equal(error.requestId, 'identity-review-request');
  assert.equal(error.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(!error.message.includes('Synthetic'));
  const tooLarge = await fetch(`${base}${prefix}/0/decisions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt('S')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, reason: 'a'.repeat(1024 * 1024) }),
  });
  assert.equal(tooLarge.status, 413);
});
