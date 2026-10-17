import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { MainAssignmentCommandService } from '../src/modules/zones/main-assignment-command.service.js';
import { MainZonePermissionCommandService } from '../src/modules/zones/main-zone-permission-command.service.js';
import { SiteAccessSetupQueryService } from '../src/modules/workforce/site-access-setup-query.service.js';

const actor = '11111111-1111-4111-8111-111111111111';
const site = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const assignmentId = '44444444-4444-4444-8444-444444444444';
const contractor = '55555555-5555-4555-8555-555555555555';
const permissionId = '66666666-6666-4666-8666-666666666666';
const denied = (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 403;
const conflict = (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 409;
type Role = { role: string; site_id: string | null };

function fixture(
  roles: Role[],
  options: { requester?: string; assignedSite?: string; active?: boolean } = {},
) {
  const writes: { sql: string; params: unknown[] }[] = [];
  const assignment = {
    id: assignmentId,
    workerId: other,
    siteId: site,
    siteContractorId: contractor,
    zoneIds: [other],
    gateId: null,
    status: 'PENDING',
    version: 1,
    validFrom: '2026-10-01T00:00:00.000Z',
    validUntil: '2026-11-01T00:00:00.000Z',
    requestedByUserId: options.requester ?? other,
    safetyReviewedByUserId: null as string | null,
    siteManagerDecidedByUserId: null as string | null,
    reviewedAt: null as string | null,
    reviewNote: null as string | null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM app_user')) return options.active === false ? [] : [{ id: actor }];
      if (sql.includes('FROM user_role_assignment')) {
        return roles.filter(
          (r) =>
            (sql.includes("role='ADMIN'") && r.role === 'ADMIN' && r.site_id === null) ||
            (r.site_id === (params[2] ?? params[1]) &&
              (sql.includes("role IN ('SITE_MANAGER','CONTRACTOR_REPRESENTATIVE')")
                ? ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'].includes(r.role)
                : r.role === params[1])),
        );
      }
      if (sql.includes('FROM pg_class')) return [{ n: 0 }];
      if (sql.includes('FROM contractor_representative_assignment'))
        return params.at(-1) === options.assignedSite
          ? [{ id: other, contractor_id: contractor }]
          : [];
      if (sql.includes('FROM contractor_representative_grant'))
        return [{ id: other, contractor_id: contractor }];
      if (sql.startsWith('SELECT id FROM site')) return [{ id: site }];
      if (sql.includes('SELECT p.id,p.contractor_id'))
        return params[1] || (params[2] as string[]).includes(contractor)
          ? [
              {
                id: contractor,
                contractorId: contractor,
                name: 'Synthetic Contractor',
                validFrom: new Date('2026-10-01Z'),
                validUntil: null,
              },
            ]
          : [];
      if (sql.includes('AS value FROM worker_site_zone_assignment'))
        return [{ value: { ...assignment } }];
      if (sql.startsWith('SELECT revoked_at FROM')) return [{ revoked_at: null }];
      if (
        sql.includes('SELECT a.site_id,s.contractor_id') ||
        sql.includes('SELECT s.site_id,s.contractor_id')
      )
        return [{ site_id: site, contractor_id: contractor }];
      if (sql.startsWith('UPDATE') || sql.startsWith('INSERT INTO audit_log')) {
        writes.push({ sql, params });
        if (sql.includes("SET status='SAFETY_REVIEWED'")) {
          assignment.status = 'SAFETY_REVIEWED';
          assignment.version++;
          assignment.safetyReviewedByUserId = params[1] as string;
        } else if (sql.includes('UPDATE worker_site_zone_assignment SET status=$2')) {
          assignment.status = params[1] as string;
          assignment.version++;
          assignment.siteManagerDecidedByUserId = params[2] as string;
          assignment.reviewedAt = '2026-10-17T00:00:00.000Z';
          assignment.reviewNote = params[3] as string | null;
        }
        return [{ id: site }];
      }
      if (
        sql.includes('FROM worker') ||
        sql.includes('FROM contractor_zone_permission') ||
        sql.includes('FROM zone')
      )
        return [];
      throw new Error(`Unexpected synthetic query: ${sql}`);
    },
  } as unknown as EntityManager;
  const source = {
    query: async (sql: string) => {
      assert.equal(sql, 'SELECT site_id FROM worker_site_zone_assignment WHERE id=$1');
      return [{ site_id: site }];
    },
    transaction: async (_isolation: string, work: (m: EntityManager) => Promise<unknown>) =>
      work(manager),
  } as unknown as DataSource;
  let rechecks = 0;
  const context = {
    actorUserId: actor,
    reauthorize: async () => {
      rechecks++;
    },
  };
  return {
    review: () =>
      new MainAssignmentCommandService(source).publicSafetyReview(assignmentId, context),
    decide: () =>
      new MainAssignmentCommandService(source).publicDecision(
        assignmentId,
        { approve: false, expectedVersion: 1 },
        context,
      ),
    revoke: (kind: 'contractor' | 'worker' = 'worker') =>
      new MainZonePermissionCommandService(source).publicRevoke(site, permissionId, kind, context),
    options: () => new SiteAccessSetupQueryService(source).options(site, context),
    writes,
    rechecks: () => rechecks,
  };
}

test('Admin remains read-only across assignment review, decision and Zone permissions', async () => {
  const f = fixture([{ role: 'ADMIN', site_id: null }]);
  for (const command of [f.review, f.decide, f.revoke]) await assert.rejects(command(), denied);
  assert.deepEqual(f.writes, []);
});

for (const role of ['SAFETY_OFFICER', 'SITE_MANAGER']) {
  test(`${role} cannot review their own assignment request`, async () => {
    const f = fixture([{ role, site_id: site }], { requester: actor });
    await assert.rejects(role === 'SAFETY_OFFICER' ? f.review() : f.decide(), denied);
    assert.deepEqual(f.writes, []);
  });
  test(`${role} can review another request only in the assigned Site`, async () => {
    const f = fixture([{ role, site_id: site }]);
    const result = await (role === 'SAFETY_OFFICER' ? f.review() : f.decide());
    assert.equal(result.status, role === 'SAFETY_OFFICER' ? 'SAFETY_REVIEWED' : 'REJECTED');
    assert.ok(
      f.writes.some((q) => q.sql.startsWith('INSERT INTO audit_log') && q.params[1] === actor),
    );
    assert.equal(f.rechecks(), 1);
    const foreign = fixture([{ role, site_id: other }]);
    await assert.rejects(role === 'SAFETY_OFFICER' ? foreign.review() : foreign.decide(), denied);
    assert.deepEqual(foreign.writes, []);
  });
}

test('Worker permission needs a Representative assignment in this Site, not just a global grant', async () => {
  for (const assignedSite of [undefined, other]) {
    const f = fixture([{ role: 'CONTRACTOR_REPRESENTATIVE', site_id: site }], { assignedSite });
    await assert.rejects(f.revoke(), conflict);
    assert.deepEqual(f.writes, []);
  }
  const allowed = fixture([{ role: 'CONTRACTOR_REPRESENTATIVE', site_id: site }], {
    assignedSite: site,
  });
  assert.deepEqual(await allowed.revoke(), { id: permissionId });
  assert.ok(allowed.writes.some((q) => q.sql.startsWith('UPDATE worker_zone_permission')));
});

test('only the Site Manager can revoke Contractor permissions', async () => {
  const allowed = fixture([{ role: 'SITE_MANAGER', site_id: site }]);
  assert.deepEqual(await allowed.revoke('contractor'), { id: permissionId });
  for (const roles of [
    [],
    [{ role: 'SITE_MANAGER', site_id: other }],
    [{ role: 'CONTRACTOR_REPRESENTATIVE', site_id: site }],
  ]) {
    const f = fixture(roles);
    await assert.rejects(f.revoke('contractor'), denied);
    assert.deepEqual(f.writes, []);
  }
});

test('access setup read rejects wrong-Site and inactive actors', async () => {
  for (const roles of [[{ role: 'SITE_MANAGER', site_id: other }], []])
    await assert.rejects(fixture(roles).options(), denied);
  await assert.rejects(
    fixture([{ role: 'SITE_MANAGER', site_id: site }], { active: false }).options(),
    denied,
  );
});

test('Main Admin can observe access setup without gaining any write capability', async () => {
  const f = fixture([{ role: 'ADMIN', site_id: null }]);
  const result = await f.options();
  assert.equal(result.participations.length, 1);
  assert.equal(result.canReviewAssignments, false);
  assert.equal(result.canGrantContractorZones, false);
  assert.equal(result.canGrantWorkerZones, false);
  assert.deepEqual(f.writes, []);
  await assert.rejects(f.revoke(), denied);
});

test('access options use Site-scoped Representative assignments and current read capabilities', async () => {
  const manager = await fixture([{ role: 'SITE_MANAGER', site_id: site }]).options();
  assert.equal(manager.canReviewAssignments, true);
  assert.equal(manager.canGrantContractorZones, true);
  assert.equal(manager.canGrantWorkerZones, false);
  for (const assignedSite of [undefined, other, site]) {
    const f = fixture([{ role: 'CONTRACTOR_REPRESENTATIVE', site_id: site }], { assignedSite });
    const result = await f.options();
    assert.equal(result.participations.length, assignedSite === site ? 1 : 0);
    assert.equal(result.canReviewAssignments, false);
    assert.equal(result.canGrantWorkerZones, true);
    assert.equal(f.rechecks(), 1);
  }
});
