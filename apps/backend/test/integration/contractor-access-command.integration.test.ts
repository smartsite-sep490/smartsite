import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Contractor access commands recheck current roles and bearer without changing their business rules', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      contractor = randomUUID(),
      managerId = randomUUID(),
      adminId = randomUUID(),
      target = randomUUID(),
      noRoleTarget = randomUUID(),
      managerRole = randomUUID(),
      adminRole = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const id of [managerId, adminId, target, noRoleTarget])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$5,'ADMIN',NULL),($6,$7,'CONTRACTOR_REPRESENTATIVE',$3),($8,$2,'SAFETY_OFFICER',$9),($10,$5,'SAFETY_OFFICER',$9)",
      [
        managerRole,
        managerId,
        site,
        adminRole,
        adminId,
        randomUUID(),
        target,
        randomUUID(),
        otherSite,
        randomUUID(),
      ],
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
      const actor = (await auth.authenticate(token.accessToken)).user;
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
      admin = await authenticated(adminId),
      service = new ContractorOperationsService(db);
    const interval = {
      siteId: site,
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: '2099-01-01T00:00:00Z',
    };
    const grant = { userId: target };
    const snapshot = async () => [
      await db.query('SELECT * FROM contractor_site_participation ORDER BY id'),
      await db.query('SELECT * FROM contractor_representative_grant ORDER BY id'),
    ];
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === expected,
      );
      assert.deepEqual(await snapshot(), before);
    };
    await t.test(
      'scoped manager creates the exact participation interval and invalid intervals stay rejected',
      async () => {
        const result = await service.createParticipation(
          manager.actor,
          contractor,
          interval,
          manager.context,
        );
        assert.equal(result.siteId, site);
        assert.equal(result.contractorId, contractor);
        assert.equal(result.validFrom.toISOString(), new Date(interval.validFrom).toISOString());
        assert.equal(result.validUntil?.toISOString(), new Date(interval.validUntil).toISOString());
        await rejectUnchanged(
          () =>
            service.createParticipation(
              manager.actor,
              contractor,
              { ...interval, validUntil: interval.validFrom },
              manager.context,
            ),
          400,
        );
      },
    );
    await t.test(
      'global Admin cannot create participation and wrong-Site manager is refused',
      async () => {
        await rejectUnchanged(
          () => service.createParticipation(admin.actor, contractor, interval, admin.context),
          403,
        );
        await rejectUnchanged(
          () =>
            service.createParticipation(
              manager.actor,
              contractor,
              { ...interval, siteId: otherSite },
              manager.context,
            ),
          403,
        );
      },
    );
    await t.test(
      'global Admin creates one grant and retry preserves its ID, including existing inactive-target compatibility',
      async () => {
        await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [target]);
        const first = await service.grantRepresentative(
          admin.actor,
          contractor,
          grant,
          admin.context,
        );
        const second = await service.grantRepresentative(
          admin.actor,
          contractor,
          grant,
          admin.context,
        );
        assert.equal(first.id, second.id);
        assert.equal(first.userId, target);
        assert.equal(first.contractorId, contractor);
        assert.equal((await db.query('SELECT id FROM contractor_representative_grant')).length, 1);
      },
    );
    await t.test(
      'manager cannot grant and missing target or CR Site role retains its error',
      async () => {
        await rejectUnchanged(
          () => service.grantRepresentative(manager.actor, contractor, grant, manager.context),
          403,
        );
        await rejectUnchanged(
          () =>
            service.grantRepresentative(
              admin.actor,
              contractor,
              { userId: randomUUID() },
              admin.context,
            ),
          404,
        );
        await rejectUnchanged(
          () =>
            service.grantRepresentative(
              admin.actor,
              contractor,
              { userId: noRoleTarget },
              admin.context,
            ),
          400,
        );
      },
    );
    await t.test(
      'stale actor role snapshots cannot authorize after current roles are revoked',
      async () => {
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [managerRole]);
        await rejectUnchanged(
          () => service.createParticipation(manager.actor, contractor, interval, manager.context),
          403,
        );
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
          [managerRole, managerId, site],
        );
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [adminRole]);
        await rejectUnchanged(
          () => service.grantRepresentative(admin.actor, contractor, grant, admin.context),
          403,
        );
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
          [adminRole, adminId],
        );
      },
    );
    await t.test('revoked sessions block participation and existing grant retry', async () => {
      for (const session of [manager.sessionId, admin.sessionId])
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          session,
        ]);
      await rejectUnchanged(
        () => service.createParticipation(manager.actor, contractor, interval, manager.context),
        401,
      );
      await rejectUnchanged(
        () => service.grantRepresentative(admin.actor, contractor, grant, admin.context),
        401,
      );
      for (const session of [manager.sessionId, admin.sessionId])
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
    });
    await t.test(
      'actor and authenticated command context must identify the same account',
      async () => {
        await rejectUnchanged(
          () => service.createParticipation(manager.actor, contractor, interval, admin.context),
          403,
        );
        await rejectUnchanged(
          () => service.grantRepresentative(admin.actor, contractor, grant, manager.context),
          403,
        );
      },
    );
    await t.test(
      'partial journal blocks both commands before participation or grant mutations',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(
          () => service.createParticipation(manager.actor, contractor, interval, manager.context),
          503,
        );
        await rejectUnchanged(
          () => service.grantRepresentative(admin.actor, contractor, grant, admin.context),
          503,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
