import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { SafetyAlertAccessGuard } from '../src/modules/safety/alerts/safety-alert-access.guard.js';
import { SafetyObservationFindingsController } from '../src/modules/safety/alerts/safety-observation-findings.controller.js';
import { SafetyObservationFindingsService } from '../src/modules/safety/alerts/safety-observation-findings.service.js';

test('findings HTTP preserves real auth/Site guards, strict inputs and private response boundaries', async (t) => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const alertId = '22222222-2222-4222-8222-222222222222';
  const eventId = '33333333-3333-4333-8333-333333333333';
  const otherSiteId = '44444444-4444-4444-8444-444444444444';
  let role = UserRole.SAFETY_OFFICER;
  let assignedSite: string | null = siteId;
  let mustChangePassword = false;
  let transactions = 0;
  const manager = {
    getRepository: () => ({
      existsBy: async (where: { id: string; siteId: string }) =>
        where.id === alertId && where.siteId === siteId,
      findOneBy: async (where: { alertId: string; eventId: string }) =>
        where.alertId === alertId && where.eventId === eventId
          ? { personObservationIndex: null }
          : null,
    }),
  };
  const module = await Test.createTestingModule({
    controllers: [SafetyObservationFindingsController],
    providers: [
      UserAuthGuard,
      SafetyAlertAccessGuard,
      SafetyObservationFindingsService,
      {
        provide: AuthService,
        useValue: {
          async authenticate(token: string) {
            if (token !== 'valid.session.signature') throw new UnauthorizedException();
            return {
              user: {
                id: alertId,
                mustChangePassword,
                roleAssignments: [{ role, siteId: assignedSite }],
              },
              sessionId: eventId,
              clientType: 'WEB',
            };
          },
        },
      },
      {
        provide: DataSource,
        useValue: {
          async transaction(isolation: string, work: (value: typeof manager) => Promise<unknown>) {
            assert.equal(isolation, 'REPEATABLE READ');
            transactions++;
            return work(manager);
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = `${await app.getUrl()}/api/v1/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/findings`;
  const headers = { Authorization: 'Bearer valid.session.signature' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { headers: { Authorization: 'Bearer bad.session.signature' } })).status,
    401,
  );
  for (role of [UserRole.WORKER, UserRole.CONTRACTOR_REPRESENTATIVE, UserRole.SITE_MANAGER]) {
    assert.equal((await fetch(url, { headers })).status, 403);
  }
  role = UserRole.SAFETY_OFFICER;
  assignedSite = otherSiteId;
  assert.equal((await fetch(url, { headers })).status, 403);
  assignedSite = siteId;
  mustChangePassword = true;
  assert.equal((await fetch(url, { headers })).status, 403);
  mustChangePassword = false;
  for (const query of [
    '?unknown=1',
    '?offset=0&offset=1',
    '?limit=abc',
    '?offset=-1',
    '?limit=101',
  ]) {
    assert.equal((await fetch(url + query, { headers })).status, 400);
  }
  assert.equal((await fetch(url.replace(alertId, 'invalid'), { headers })).status, 400);
  assert.equal(transactions, 0);
  for (role of [UserRole.SAFETY_OFFICER, UserRole.ADMIN]) {
    assignedSite = role === UserRole.ADMIN ? null : siteId;
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { subject: null, items: [], total: 0 });
  }
  assert.equal((await fetch(url.replace(siteId, otherSiteId), { headers })).status, 404);
  assert.equal((await fetch(url.replace(eventId, otherSiteId), { headers })).status, 404);
});
