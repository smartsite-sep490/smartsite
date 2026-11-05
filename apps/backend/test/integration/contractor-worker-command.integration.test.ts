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

test('Contractor Worker creation rechecks current scoped CR authority and preserves account separation', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      contractor = randomUUID(),
      actor = randomUUID(),
      admin = randomUUID(),
      crRole = randomUUID(),
      grantId = randomUUID(),
      participationId = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const id of [actor, admin])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3),($4,$2,'SAFETY_OFFICER',$5),($6,$7,'ADMIN',NULL)",
      [crRole, actor, site, randomUUID(), otherSite, randomUUID(), admin],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    const restoreGrant = () =>
      db.query(
        'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
        [grantId, actor, contractor],
      );
    await restoreGrant();
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2099-01-01T00:00:00Z',true)",
      [participationId, contractor, site],
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
      const snapshotActor = (await auth.authenticate(token.accessToken)).user;
      return {
        sessionId,
        actor: snapshotActor,
        context: {
          actorUserId: userId,
          reauthorize: async (manager: EntityManager) => {
            assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, userId);
          },
        },
      };
    };
    const representative = await authenticated(actor),
      administrator = await authenticated(admin),
      service = new ContractorOperationsService(db);
    const input = () => ({
      siteId: site,
      externalId: `SYN-${randomUUID()}`,
      displayName: 'Synthetic Worker',
    });
    const snapshot = () => db.query('SELECT * FROM worker ORDER BY id');
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === expected,
      );
      assert.deepEqual(await snapshot(), before);
    };
    await t.test(
      'authorized CR creates a Worker in its Contractor and Site without creating or linking an account',
      async () => {
        const value = input();
        const accountsBefore = await db.query('SELECT count(*)::int AS n FROM app_user');
        const worker = await service.createWorker(
          representative.actor,
          contractor,
          value,
          representative.context,
        );
        assert.ok(worker);
        assert.deepEqual(
          await db.query('SELECT site_id,contractor_id,user_id,is_active FROM worker WHERE id=$1', [
            worker.id,
          ]),
          [{ site_id: site, contractor_id: contractor, user_id: null, is_active: true }],
        );
        assert.deepEqual(await db.query('SELECT count(*)::int AS n FROM app_user'), accountsBefore);
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, value, representative.context),
          409,
        );
      },
    );
    await t.test('removed current CR role rejects an actor with its old snapshot', async () => {
      await db.query('DELETE FROM user_role_assignment WHERE id=$1', [crRole]);
      await rejectUnchanged(
        () =>
          service.createWorker(representative.actor, contractor, input(), representative.context),
        403,
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
        [crRole, actor, site],
      );
    });
    await t.test('missing Contractor representative grant is refused', async () => {
      await db.query('DELETE FROM contractor_representative_grant WHERE id=$1', [grantId]);
      await rejectUnchanged(
        () =>
          service.createWorker(representative.actor, contractor, input(), representative.context),
        403,
      );
      await restoreGrant();
    });
    await t.test(
      'inactive Contractor and expired or inactive Site participation remain refused',
      async () => {
        await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [contractor]);
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, input(), representative.context),
          403,
        );
        await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [contractor]);
        await db.query(
          "UPDATE contractor_site_participation SET valid_until='2021-01-01T00:00:00Z' WHERE id=$1",
          [participationId],
        );
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, input(), representative.context),
          403,
        );
        await db.query(
          "UPDATE contractor_site_participation SET valid_until='2099-01-01T00:00:00Z',is_active=false WHERE id=$1",
          [participationId],
        );
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, input(), representative.context),
          403,
        );
        await db.query('UPDATE contractor_site_participation SET is_active=true WHERE id=$1', [
          participationId,
        ]);
      },
    );
    await t.test(
      'cross-Site scope and global Admin without scoped CR cannot create Workers',
      async () => {
        await rejectUnchanged(
          () =>
            service.createWorker(
              representative.actor,
              contractor,
              { ...input(), siteId: otherSite },
              representative.context,
            ),
          403,
        );
        await rejectUnchanged(
          () =>
            service.createWorker(administrator.actor, contractor, input(), administrator.context),
          403,
        );
      },
    );
    await t.test(
      'revoked bearer prevents creation after the actor snapshot was obtained',
      async () => {
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          representative.sessionId,
        ]);
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, input(), representative.context),
          401,
        );
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [
          representative.sessionId,
        ]);
      },
    );
    await t.test('actor and authenticated context must belong to the same account', async () => {
      await rejectUnchanged(
        () =>
          service.createWorker(representative.actor, contractor, input(), administrator.context),
        403,
      );
    });
    await t.test(
      'partial journal blocks Worker creation without changing existing Worker records',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(
          () =>
            service.createWorker(representative.actor, contractor, input(), representative.context),
          503,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
