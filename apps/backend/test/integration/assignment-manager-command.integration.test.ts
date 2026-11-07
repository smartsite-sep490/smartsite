import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import type { WorkerSiteZoneAssignmentEntity } from '../../src/database/entities/worker-site-zone-assignment.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Manager assignment decisions and revocations retain scope, exact retry and atomic audit', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      zone = randomUUID(),
      worker = randomUUID(),
      contractor = randomUUID(),
      participation = randomUUID(),
      managerId = randomUUID(),
      wrongManagerId = randomUUID(),
      adminId = randomUUID(),
      requester = randomUUID(),
      managerRole = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const id of [managerId, wrongManagerId, adminId, requester])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$2,'SAFETY_OFFICER',$5),($6,$7,'SITE_MANAGER',$5),($8,$9,'ADMIN',NULL)",
      [
        managerRole,
        managerId,
        site,
        randomUUID(),
        otherSite,
        randomUUID(),
        wrongManagerId,
        randomUUID(),
        adminId,
      ],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
      [zone, site],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2045-01-01T00:00:00Z')",
      [participation, contractor, site],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig()),
      auth = new AuthService(db, tokens);
    const authenticated = async (userId: string) => {
      const sessionId = randomUUID();
      await db.query(
        "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
        [sessionId, userId, sessionId.replaceAll('-', '').repeat(2)],
      );
      const token = await tokens.issueAccessToken(userId, sessionId),
        actor = (await auth.authenticate(token.accessToken)).user;
      return {
        sessionId,
        actor,
        context: {
          actorUserId: userId,
          reauthorize: async (transaction: EntityManager) => {
            assert.equal((await auth.authenticate(token.accessToken, transaction)).user.id, userId);
          },
        },
      };
    };
    const manager = await authenticated(managerId),
      wrongManager = await authenticated(wrongManagerId),
      administrator = await authenticated(adminId),
      service = new ContractorOperationsService(db);
    const pending = async (requestedBy = requester) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,version,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,$5,'PENDING',1,'2041-01-01T00:00:00Z','2042-01-01T00:00:00Z',$6)",
        [id, worker, site, participation, [zone], requestedBy],
      );
      return id;
    };
    const decision = (
      id: string,
      approve: boolean,
      caller = manager,
      expectedVersion = 1,
      context = caller.context,
    ) =>
      Reflect.apply(service.siteManagerDecision, service, [
        caller.actor,
        id,
        { approve, expectedVersion, reviewNote: 'Synthetic decision' },
        context,
      ]) as Promise<WorkerSiteZoneAssignmentEntity>;
    const revoke = (
      id: string,
      caller = manager,
      expectedVersion = 2,
      context = caller.context,
      reviewNote = 'Synthetic revocation',
    ) =>
      Reflect.apply(service.revokeAssignment, service, [
        caller.actor,
        id,
        { expectedVersion, reviewNote },
        context,
      ]) as Promise<WorkerSiteZoneAssignmentEntity>;
    const snapshot = async () => [
      await db.query('SELECT * FROM worker_site_zone_assignment ORDER BY id'),
      await db.query('SELECT * FROM audit_log ORDER BY id'),
      await db.query('SELECT id,access_policy_version FROM site ORDER BY id'),
    ];
    const siteVersion = async () =>
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      );
    const rejectUnchanged = async (work: () => Promise<unknown>, expected?: number) => {
      const before = await snapshot();
      if (expected === undefined) await assert.rejects(work);
      else
        await assert.rejects(
          work,
          (error) => (error as { getStatus?: () => number }).getStatus?.() === expected,
        );
      assert.deepEqual(await snapshot(), before);
    };
    let revokedId: string;
    await t.test(
      'approval refuses a Worker moved outside the assignment Site without updating policy or audit',
      async () => {
        const id = await pending();
        await db.query('UPDATE worker SET site_id=$1 WHERE id=$2', [otherSite, worker]);
        try {
          await rejectUnchanged(() => decision(id, true), 409);
        } finally {
          await db.query('UPDATE worker SET site_id=$1 WHERE id=$2', [site, worker]);
        }
      },
    );
    await t.test(
      'manager may approve directly from PENDING or reject, with one version and policy increment per decision',
      async () => {
        for (const approve of [true, false]) {
          const id = await pending(),
            beforeVersion = await siteVersion();
          const result = await decision(id, approve);
          assert.equal(result.status, approve ? 'APPROVED' : 'REJECTED');
          assert.equal(result.version, 2);
          assert.equal(result.siteManagerDecidedByUserId, managerId);
          assert.equal(await siteVersion(), beforeVersion + 1);
          assert.deepEqual(
            await db.query(
              'SELECT action,actor_account_id,site_id FROM audit_log WHERE entity_id=$1',
              [id],
            ),
            [{ action: 'WORKER_ASSIGNMENT_REVIEWED', actor_account_id: managerId, site_id: site }],
          );
          await rejectUnchanged(() => decision(id, true, manager, 2), 409);
        }
      },
    );
    await t.test(
      'revoke exact retry returns the original version without another policy bump or audit',
      async () => {
        revokedId = await pending();
        await decision(revokedId, true);
        const beforeVersion = await siteVersion();
        const first = await revoke(revokedId);
        assert.equal(first.status, 'REVOKED');
        assert.equal(first.version, 3);
        assert.equal(await siteVersion(), beforeVersion + 1);
        const beforeRetry = await snapshot(),
          retry = await revoke(revokedId);
        assert.equal(retry.version, 3);
        assert.deepEqual(await snapshot(), beforeRetry);
        assert.equal(
          (
            await db.query(
              "SELECT id FROM audit_log WHERE entity_id=$1 AND action='WORKER_ASSIGNMENT_REVOKED'",
              [revokedId],
            )
          ).length,
          1,
        );
        await rejectUnchanged(() => revoke(revokedId, manager, 3), 409);
        await rejectUnchanged(
          () => revoke(revokedId, manager, 2, manager.context, 'Different note'),
          409,
        );
      },
    );
    await t.test('stale versions, wrong state and self-decision remain refused', async () => {
      const id = await pending();
      await rejectUnchanged(() => decision(id, true, manager, 2), 409);
      await rejectUnchanged(() => revoke(id, manager, 1), 409);
      const selfRequested = await pending(managerId);
      await rejectUnchanged(() => decision(selfRequested, true), 403);
    });
    await t.test('wrong-Site manager and global Admin cannot decide or retry revoke', async () => {
      const id = await pending();
      for (const caller of [wrongManager, administrator]) {
        await rejectUnchanged(() => decision(id, true, caller), 403);
        await rejectUnchanged(() => revoke(revokedId, caller), 403);
      }
    });
    await t.test(
      'lost role and revoked bearer prevent changes and exact revoke retry',
      async () => {
        const id = await pending();
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [managerRole]);
        await rejectUnchanged(() => decision(id, true), 403);
        await rejectUnchanged(() => revoke(revokedId), 403);
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
          [managerRole, managerId, site],
        );
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          manager.sessionId,
        ]);
        await rejectUnchanged(() => decision(id, true), 401);
        await rejectUnchanged(() => revoke(revokedId), 401);
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [manager.sessionId]);
      },
    );
    await t.test('actor and original authenticated context must agree', async () => {
      const id = await pending();
      await rejectUnchanged(() => decision(id, true, manager, 1, administrator.context), 403);
      await rejectUnchanged(() => revoke(revokedId, manager, 2, administrator.context), 403);
    });
    await t.test(
      'audit failure rolls back decisions and revoke together with Site policy version',
      async () => {
        const id = await pending(),
          approvedId = await pending();
        await decision(approvedId, true);
        await db.query(
          "CREATE FUNCTION synthetic_manager_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit refusal'; END $$",
        );
        await db.query(
          'CREATE TRIGGER synthetic_manager_audit_refusal BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_manager_audit_fail()',
        );
        try {
          await rejectUnchanged(() => decision(id, true));
          await rejectUnchanged(() => revoke(approvedId));
        } finally {
          await db.query('DROP TRIGGER synthetic_manager_audit_refusal ON audit_log');
          await db.query('DROP FUNCTION synthetic_manager_audit_fail()');
        }
      },
    );
    await t.test(
      'partial journal prevents decision and revoke before business, audit or Site writes',
      async () => {
        const id = await pending(),
          approvedId = await pending();
        await decision(approvedId, true);
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(() => decision(id, true), 503);
        await rejectUnchanged(() => revoke(approvedId), 503);
      },
    );
  } finally {
    await owned.dispose();
  }
});
