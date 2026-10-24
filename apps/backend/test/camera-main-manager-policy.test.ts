import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import type { SiteConfigurationService } from '../src/modules/sites/site-configuration.service.js';
import type { ZoneConfigurationService } from '../src/modules/zones/zone-configuration.service.js';
import { MainWorkforceCreateService } from '../src/modules/workforce/main-workforce-create.service.js';

const actor = '11111111-1111-4111-8111-111111111111';
const site = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const denied = (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === 403;

function fixture(initialRoles: { role: string; siteId: string | null }[]) {
  let roles = initialRoles;
  const writes: unknown[] = [];
  let rechecks = 0;
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app_user')) return [{ id: actor }];
      if (sql.includes('FROM user_role_assignment')) {
        if (sql.includes("role='CONTRACTOR_REPRESENTATIVE'"))
          return roles.filter(
            (r) =>
              (r.role === 'CONTRACTOR_REPRESENTATIVE' && r.siteId === params[1]) ||
              (sql.includes("role='ADMIN'") && r.role === 'ADMIN' && r.siteId === null),
          );
        if (sql.includes("role='SITE_MANAGER'"))
          return roles.filter((r) => r.role === 'SITE_MANAGER' && r.siteId === params[1]);
        if (sql.includes("role='ADMIN'"))
          return roles.filter((r) => r.role === 'ADMIN' && r.siteId === null);
      }
      if (sql.includes('FROM pg_class')) return [{ n: 0 }];
      if (sql.includes('FROM contractor_representative_grant')) return [{ id: actor }];
      if (sql.includes('FROM contractor_site_participation')) return [{ id: other }];
      if (sql.includes('FROM contractor')) return [{ id: other, is_active: true }];
      throw new Error(`Unexpected test database operation: ${sql}`);
    },
    getRepository: () => ({
      save: async (value: unknown) => {
        writes.push(value);
        return value;
      },
    }),
  } as unknown as EntityManager;
  const source = {
    transaction: async (_isolation: string, work: (m: EntityManager) => Promise<unknown>) =>
      work(manager),
  } as unknown as DataSource;
  const service = new CameraConfigurationService(
    source,
    undefined as unknown as ZoneConfigurationService,
    { get: async () => ({ id: site }) } as unknown as SiteConfigurationService,
  );
  const context = {
    actorUserId: actor,
    reauthorize: async () => {
      rechecks++;
    },
  };
  return {
    create: () =>
      service.create(site, { externalId: 'synthetic-camera', code: 'C1', name: 'Gate' }, context),
    createWorker: () =>
      new MainWorkforceCreateService(source).createWorker(
        other,
        { siteId: site, externalId: 'synthetic-worker', displayName: 'Worker' },
        context,
      ),
    revoke: () => {
      roles = [];
    },
    writes,
    rechecks: () => rechecks,
  };
}

test('Main scoped Site Manager can create a camera through the attributed command', async () => {
  const f = fixture([{ role: 'SITE_MANAGER', siteId: site }]);
  const camera = await f.create();
  assert.equal(camera.siteId, site);
  assert.equal(f.writes.length, 1);
  assert.equal(f.rechecks(), 1);
});

test('Main read-only Admin cannot write through the retained attributed camera service', async () => {
  const f = fixture([{ role: 'ADMIN', siteId: null }]);
  await assert.rejects(f.create(), denied);
  assert.equal(f.writes.length, 0);
});

test('foreign-Site and revoked manager roles cannot create a camera', async () => {
  const foreign = fixture([{ role: 'SITE_MANAGER', siteId: other }]);
  await assert.rejects(foreign.create(), denied);
  assert.equal(foreign.writes.length, 0);
  const revoked = fixture([{ role: 'SITE_MANAGER', siteId: site }]);
  revoked.revoke();
  await assert.rejects(revoked.create(), denied);
  assert.equal(revoked.writes.length, 0);
});

test('read-only Admin cannot create a Contractor Worker through the attributed service', async () => {
  const f = fixture([{ role: 'ADMIN', siteId: null }]);
  await assert.rejects(f.createWorker(), denied);
  assert.equal(f.writes.length, 0);
});

test('scoped Representative creates a Contractor profile without inventing an account link', async () => {
  const f = fixture([{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: site }]);
  const worker = await f.createWorker();
  assert.equal(worker.siteId, site);
  assert.equal(worker.contractorId, other);
  assert.equal(worker.userId, undefined);
  assert.equal(f.writes.length, 1);
});
