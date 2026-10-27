import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { createLoggerParams } from '../src/observability/logger.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { ObservationIdentityContextService } from '../src/modules/safety/identity/observation-identity-context.service.js';
import { ObservationIdentityResolutionService } from '../src/modules/safety/identity/observation-identity-resolution.service.js';
import { createTestConfig } from './support/config.js';

test('identity reads refuse data when session or scoped capability is revoked during I/O', async (t) => {
  const siteId = randomUUID(), actorId = randomUUID(), eventId = randomUUID();
  const config = createTestConfig({ HTTP_RATE_LIMIT_LIMIT: '1000', LOG_FORMAT: 'json' });
  let access: 'allowed' | 'logout' | 'deactivated' | 'role-moved' = 'allowed';
  let entered!: () => void, release!: () => void;
  let gate: Promise<void> = Promise.resolve();
  const hold = async () => { entered(); await gate; };
  const context = { eventId, payloadHash: 'a'.repeat(64), eventConsistent: true, frames: [], subjects: [] };
  const db = { isInitialized: true, query: async () => [{ ok: 1 }], destroy: async () => undefined };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService).useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN).useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken()).useValue(db)
    .overrideProvider(DataSource).useValue(db)
    .overrideProvider(AuthService).useValue({ authenticate: async () => {
      if (access === 'logout' || access === 'deactivated') throw new UnauthorizedException();
      return { user: { id: actorId, username: 'synthetic-reviewer', displayName: 'Synthetic',
        isActive: true, mustChangePassword: false,
        roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: access === 'role-moved' ? randomUUID() : siteId }] },
        sessionId: 'synthetic-session', clientType: 'WEB' };
    } })
    .overrideProvider(ObservationIdentityContextService).useValue({
      get: async () => { await hold(); return context; },
      listWorkers: async () => { await hold(); return { items: [], total: 0 }; },
    })
    .overrideProvider(ObservationIdentityResolutionService).useValue({
      listDecisions: async () => { await hold(); return { items: [], total: 0 }; },
      readContextRecords: async () => ({ event: { eventId }, heads: [] }),
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ bufferLogs: true, bodyParser: false });
  t.after(() => app.close());
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const prefix = `${await app.getUrl()}/api/v1/sites/${siteId}/safety-alerts/${randomUUID()}/detections/${eventId}/identity-subjects`;
  for (const suffix of ['', '/workers', '/0/decisions']) {
    for (const revoke of ['logout', 'deactivated', 'role-moved'] as const) {
      await t.test(`${suffix || 'context'}: ${revoke}`, async () => {
        access = 'allowed';
        const reached = new Promise<void>((done) => { entered = done; });
        gate = new Promise<void>((done) => { release = done; });
        const request = fetch(`${prefix}${suffix}`, {
          headers: { Authorization: `Bearer ${'a'.repeat(16)}.${'b'.repeat(16)}.${'c'.repeat(16)}` },
          signal: AbortSignal.timeout(5000),
        });
        await reached;
        access = revoke;
        release();
        const response = await request;
        assert.equal(response.status, revoke === 'role-moved' ? 403 : 401);
        const body = await response.json() as Record<string, unknown>;
        for (const privateField of ['eventId', 'subjects', 'frames', 'items', 'total'])
          assert.equal(privateField in body, false, `Denied response must omit ${privateField}`);
      });
    }
    await t.test(`${suffix || 'context'}: authorization retained`, async () => {
      access = 'allowed'; entered = () => undefined; gate = Promise.resolve();
      const response = await fetch(`${prefix}${suffix}`, {
        headers: { Authorization: `Bearer ${'a'.repeat(16)}.${'b'.repeat(16)}.${'c'.repeat(16)}` },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    });
  }
});
