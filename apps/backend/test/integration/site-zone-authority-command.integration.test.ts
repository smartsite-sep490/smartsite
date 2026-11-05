import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { SiteAccessSetupService } from '../../src/modules/workforce/access/site-access-setup.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Site Zone commands preserve scoped authority, retry and atomic audit', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      contractor = randomUUID(),
      managerId = randomUUID(),
      repId = randomUUID(),
      repAssignment = randomUUID(),
      worker = randomUUID(),
      zone = randomUUID(),
      unassignedZone = randomUUID(),
      participation = randomUUID(),
      assignment = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const id of [managerId, repId])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$5,'CONTRACTOR_REPRESENTATIVE',$3)",
      [randomUUID(), managerId, site, randomUUID(), repId],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    const addRepAssignment = () =>
      db.query(
        'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
        [repAssignment, repId, site, contractor],
      );
    await addRepAssignment();
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2045-01-01T00:00:00Z')",
      [participation, contractor, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    for (const id of [zone, unassignedZone])
      await db.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
        [id, site],
      );
    await db.query(
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id,site_manager_decided_by_user_id) VALUES($1,$2,$3,$4,$5,'APPROVED','2040-01-01T00:00:00Z','2043-01-01T00:00:00Z',$6,$7)",
      [assignment, worker, site, participation, [zone], repId, managerId],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig()),
      auth = new AuthService(db, tokens);
    const authenticated = async (userId: string) => {
      const sessionId = randomUUID();
      await db.query(
        "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
        [sessionId, userId, sessionId.replaceAll('-', '').repeat(2)],
      );
      const token = await tokens.issueAccessToken(userId, sessionId);
      return {
        sessionId,
        actor: (await auth.authenticate(token.accessToken)).user,
        context: {
          actorUserId: userId,
          reauthorize: async (manager: EntityManager) => {
            assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, userId);
          },
        },
      };
    };
    const manager = await authenticated(managerId),
      rep = await authenticated(repId),
      service = new SiteAccessSetupService(db);
    const contractorGrant = {
      requestId: randomUUID(),
      siteContractorId: participation,
      zoneId: zone,
      validFrom: '2040-01-01T00:00:00Z',
      validUntil: '2043-01-01T00:00:00Z',
    };
    const workerGrant = {
      requestId: randomUUID(),
      workerAssignmentId: assignment,
      contractorZonePermissionId: contractorGrant.requestId,
      validFrom: '2041-01-01T00:00:00Z',
      validUntil: '2042-01-01T00:00:00Z',
    };
    const grantContractor = (input = contractorGrant) =>
      Reflect.apply(service.grantContractor, service, [
        manager.actor,
        site,
        input,
        manager.context,
      ]) as ReturnType<SiteAccessSetupService['grantContractor']>;
    const grantWorker = (input = workerGrant) =>
      Reflect.apply(service.grantWorker, service, [
        rep.actor,
        site,
        input,
        rep.context,
      ]) as ReturnType<SiteAccessSetupService['grantWorker']>;
    const revoke = (kind: 'contractor' | 'worker') => {
      const caller = kind === 'contractor' ? manager : rep;
      const { requestId } = kind === 'contractor' ? contractorGrant : workerGrant;
      return Reflect.apply(service.revoke, service, [
        caller.actor,
        site,
        requestId,
        kind,
        caller.context,
      ]);
    };
    const snapshot = async () => [
      await db.query('SELECT * FROM contractor_zone_permission ORDER BY id'),
      await db.query('SELECT * FROM worker_zone_permission ORDER BY id'),
      await db.query('SELECT * FROM audit_log ORDER BY id'),
      await db.query('SELECT id,access_policy_version FROM site ORDER BY id'),
    ];
    const rejectUnchanged = async (work: () => Promise<unknown>, status: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === status,
      );
      assert.deepEqual(await snapshot(), before);
    };
    const auditCount = async (id: string, action: string) =>
      (await db.query('SELECT id FROM audit_log WHERE entity_id=$1 AND action=$2', [id, action]))
        .length;

    await t.test(
      'concurrent exact Contractor grant creates one permission and one business audit',
      async () => {
        const [first, second] = await Promise.all([grantContractor(), grantContractor()]);
        assert.equal(first.id, contractorGrant.requestId);
        assert.equal(second.id, first.id);
        assert.equal(await auditCount(first.id, 'CONTRACTOR_ZONE_GRANTED'), 1);
      },
    );
    await t.test('one request ID cannot overwrite a grant when the parents differ', async () => {
      const otherParticipation = randomUUID();
      await db.query(
        "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2020-01-01','2045-01-01')",
        [otherParticipation, contractor, site],
      );
      const input = { ...contractorGrant, requestId: randomUUID() };
      const outcomes = await Promise.allSettled([
        grantContractor(input),
        grantContractor({ ...input, siteContractorId: otherParticipation }),
      ]);
      const saved = outcomes.find((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      assert.ok(saved);
      assert.equal(rejected?.reason.getStatus?.(), 409);
      const [row] = await db.query(
        'SELECT site_contractor_id FROM contractor_zone_permission WHERE id=$1',
        [input.requestId],
      );
      assert.equal(row.site_contractor_id, saved.value.siteContractorId);
      assert.equal(await auditCount(input.requestId, 'CONTRACTOR_ZONE_GRANTED'), 1);
    });
    await t.test(
      'Worker moved to another Site cannot receive a permission tied to the old assignment',
      async () => {
        await db.query('UPDATE worker SET site_id=$1 WHERE id=$2', [otherSite, worker]);
        try {
          await rejectUnchanged(
            () =>
              grantWorker({
                ...workerGrant,
                requestId: randomUUID(),
                validFrom: '2041-02-01T00:00:00Z',
              }),
            409,
          );
        } finally {
          await db.query('UPDATE worker SET site_id=$1 WHERE id=$2', [site, worker]);
        }
      },
    );
    await t.test(
      'removed representative assignment refuses the Worker grant with a valid bearer',
      async () => {
        await db.query('DELETE FROM contractor_representative_assignment WHERE id=$1', [
          repAssignment,
        ]);
        try {
          await rejectUnchanged(grantWorker, 409);
        } finally {
          await addRepAssignment();
        }
      },
    );
    await t.test(
      'Worker grant refuses a parent permission for a Zone outside the approved assignment',
      async () => {
        await db.query('UPDATE worker_site_zone_assignment SET zone_ids=$1 WHERE id=$2', [
          [unassignedZone],
          assignment,
        ]);
        try {
          await rejectUnchanged(
            () =>
              grantWorker({
                ...workerGrant,
                requestId: randomUUID(),
                validFrom: '2041-03-01T00:00:00Z',
              }),
            409,
          );
        } finally {
          await db.query('UPDATE worker_site_zone_assignment SET zone_ids=$1 WHERE id=$2', [
            [zone],
            assignment,
          ]);
        }
      },
    );
    await t.test(
      'authorized Worker grant and both revoke paths record one audit per operation',
      async () => {
        const permission = await grantWorker();
        assert.equal(permission.id, workerGrant.requestId);
        assert.equal((await grantWorker()).id, permission.id);
        assert.equal(await auditCount(permission.id, 'WORKER_ZONE_GRANTED'), 1);
        for (const kind of ['worker', 'contractor'] as const) {
          const id = kind === 'worker' ? workerGrant.requestId : contractorGrant.requestId;
          assert.deepEqual(await revoke(kind), { id });
          const before = await snapshot();
          assert.deepEqual(await revoke(kind), { id });
          assert.deepEqual(await snapshot(), before);
          assert.equal(await auditCount(id, 'ZONE_PERMISSION_REVOKED'), 1);
        }
      },
    );
    await t.test('revoked bearers are rejected even on exact existing commands', async () => {
      for (const sessionId of [manager.sessionId, rep.sessionId])
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          sessionId,
        ]);
      try {
        await rejectUnchanged(grantContractor, 401);
        await rejectUnchanged(() => revoke('contractor'), 401);
        await rejectUnchanged(() => revoke('worker'), 401);
      } finally {
        for (const sessionId of [manager.sessionId, rep.sessionId])
          await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [sessionId]);
      }
    });
    await t.test('partial journal blocks authority writes and revocation replays', async () => {
      await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
      await rejectUnchanged(
        () => grantContractor({ ...contractorGrant, requestId: randomUUID() }),
        503,
      );
      await rejectUnchanged(() => revoke('contractor'), 503);
      await rejectUnchanged(() => revoke('worker'), 503);
    });
  } finally {
    await owned.dispose();
  }
});
