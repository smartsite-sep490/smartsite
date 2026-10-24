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
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  UserRole,
  UserEntity,
  SiteEntity,
  UserRoleAssignmentEntity,
  AuthClientType,
} from '../../src/database/entities/index.js';
import { ObservationIdentityContextService } from '../../src/modules/safety/identity/observation-identity-context.service.js';
import { ObservationIdentityResolutionService } from '../../src/modules/safety/identity/observation-identity-resolution.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test(
  'real sessions and PostgreSQL revoke in-flight identity reads without returning private data',
  { timeout: 30000 },
  async (t) => {
    const isolated = createIsolatedTestDatabase({ legacy: true });
    const db = isolated.dataSource;
    let app: NestExpressApplication | undefined;
    let release: () => void = () => undefined;
    try {
      await isolated.initialize();
      const siteId = randomUUID(),
        otherSiteId = randomUUID(),
        actorId = randomUUID(),
        roleId = randomUUID(),
        eventId = randomUUID();
      await db.getRepository(SiteEntity).insert(
        [siteId, otherSiteId].map((id) => ({
          id,
          code: `S-${id}`,
          name: 'Synthetic revocation Site',
        })),
      );
      const username = `review-${actorId.slice(0, 8)}`,
        password = 'SyntheticRead1!';
      await db.getRepository(UserEntity).insert({
        id: actorId,
        username,
        displayName: 'Synthetic reviewer',
        passwordHash: await hashPassword(password),
        isActive: true,
        mustChangePassword: false,
      });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .insert({ id: roleId, userId: actorId, role: UserRole.SAFETY_OFFICER, siteId });
      const config = createTestConfig({ HTTP_RATE_LIMIT_LIMIT: '1000', LOG_FORMAT: 'json' });
      let entered: () => void = () => undefined;
      let gate: Promise<void> = Promise.resolve();
      const hold = async () => {
        entered();
        await gate;
      };
      const context = {
        eventId,
        payloadHash: 'a'.repeat(64),
        eventConsistent: true,
        frames: [],
        subjects: [],
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
        // Only the slow read is synthetic. AuthService, tokens, guards and account/role/session readers are real.
        .overrideProvider(ObservationIdentityContextService)
        .useValue({
          get: async () => {
            await hold();
            return context;
          },
          listWorkers: async () => {
            await hold();
            return { items: [], total: 0 };
          },
        })
        .overrideProvider(ObservationIdentityResolutionService)
        .useValue({
          listDecisions: async () => {
            await hold();
            return { items: [], total: 0 };
          },
          readContextRecords: async () => ({ event: { eventId }, heads: [] }),
        })
        .compile();
      app = module.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
        bodyParser: false,
      });
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const auth = app.get(AuthService);
      const prefix = `${await app.getUrl()}/api/v1/sites/${siteId}/safety-alerts/${randomUUID()}/detections/${eventId}/identity-subjects`;
      for (const suffix of ['', '/workers', '/0/decisions']) {
        for (const revoke of ['logout', 'deactivated', 'role-moved'] as const) {
          await t.test(`${suffix || 'context'}: ${revoke}`, async () => {
            await db.getRepository(UserEntity).update({ id: actorId }, { isActive: true });
            await db.getRepository(UserRoleAssignmentEntity).update({ id: roleId }, { siteId });
            const actor = await auth.login(username, password, AuthClientType.MOBILE);
            const reached = new Promise<void>((done) => {
              entered = done;
            });
            gate = new Promise<void>((done) => {
              release = done;
            });
            const request = fetch(`${prefix}${suffix}`, {
              headers: { Authorization: `Bearer ${actor.accessToken}` },
              signal: AbortSignal.timeout(5000),
            });
            await Promise.race([
              reached,
              request.then(() => {
                throw new Error('Read failed before the held I/O boundary');
              }),
            ]);
            if (revoke === 'logout') await auth.logout(actor.refreshToken, AuthClientType.MOBILE);
            if (revoke === 'deactivated')
              await db.getRepository(UserEntity).update({ id: actorId }, { isActive: false });
            if (revoke === 'role-moved')
              await db
                .getRepository(UserRoleAssignmentEntity)
                .update({ id: roleId }, { siteId: otherSiteId });
            release();
            const response = await request;
            assert.equal(response.status, revoke === 'role-moved' ? 403 : 401);
            const body = (await response.json()) as Record<string, unknown>;
            for (const field of ['eventId', 'subjects', 'frames', 'items', 'total'])
              assert.equal(field in body, false);
          });
        }
        await t.test(`${suffix || 'context'}: retained authorization`, async () => {
          await db.getRepository(UserEntity).update({ id: actorId }, { isActive: true });
          await db.getRepository(UserRoleAssignmentEntity).update({ id: roleId }, { siteId });
          const actor = await auth.login(username, password, AuthClientType.MOBILE);
          gate = Promise.resolve();
          entered = () => undefined;
          const response = await fetch(`${prefix}${suffix}`, {
            headers: { Authorization: `Bearer ${actor.accessToken}` },
          });
          assert.equal(response.status, 200);
          assert.match(response.headers.get('cache-control') ?? '', /no-store/);
        });
      }
    } finally {
      release();
      if (app) await app.close();
      await isolated.dispose();
    }
  },
);
