import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Worker account commands preserve enrollment and linking while rechecking Admin authentication', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      actor = randomUUID(),
      nonAdmin = randomUUID(),
      prepareUser = randomUUID(),
      linkUser = randomUUID(),
      differentUser = randomUUID(),
      otherSiteUser = randomUUID(),
      globalAdminUser = randomUUID(),
      worker = randomUUID(),
      otherWorker = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const id of [
      actor,
      nonAdmin,
      prepareUser,
      linkUser,
      differentUser,
      otherSiteUser,
      globalAdminUser,
    ])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    for (const id of [actor, globalAdminUser])
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
        [randomUUID(), id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
      [randomUUID(), nonAdmin, site],
    );
    for (const id of [prepareUser, linkUser, differentUser])
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
        [randomUUID(), id, site],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
      [randomUUID(), otherSiteUser, otherSite],
    );
    for (const [id, scope] of [
      [worker, site],
      [otherWorker, otherSite],
    ])
      await db.query(
        "INSERT INTO worker(id,site_id,external_id,display_name,is_active) VALUES($1,$2,$1::uuid::text,'Synthetic Worker',true)",
        [id, scope],
      );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const auth = new AuthService(db, tokens);
    const authenticated = async (userId: string) => {
      const sessionId = randomUUID();
      await db.query(
        "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
        [sessionId, userId, sessionId.replaceAll('-', '').repeat(2)],
      );
      const token = await tokens.issueAccessToken(userId, sessionId);
      return {
        sessionId,
        context: {
          actorUserId: userId,
          reauthorize: async (manager: EntityManager) => {
            assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, userId);
          },
        },
      };
    };
    const admin = await authenticated(actor),
      manager = await authenticated(nonAdmin),
      service = new WorkforceConfigurationService(db);
    const snapshot = () => db.query('SELECT * FROM worker ORDER BY id');
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number | number[]) => {
      const before = await snapshot();
      await assert.rejects(work, (error) => {
        const status = (error as { getStatus?: () => number }).getStatus?.();
        return Array.isArray(expected) ? expected.includes(status!) : status === expected;
      });
      assert.deepEqual(await snapshot(), before);
    };
    let preparedId: string;
    await t.test(
      'concurrent authenticated enrollment returns the same persisted Worker',
      async () => {
        const results = await Promise.all([
          service.forAccount(site, { userId: prepareUser }, admin.context),
          service.forAccount(site, { userId: prepareUser }, admin.context),
        ]);
        preparedId = results[0].id;
        assert.equal(results[1].id, preparedId);
        assert.equal(results[0].userId, prepareUser);
        assert.deepEqual(
          await db.query('SELECT id FROM worker WHERE site_id=$1 AND user_id=$2', [
            site,
            prepareUser,
          ]),
          [{ id: preparedId }],
        );
      },
    );
    await t.test(
      'global Admin target remains eligible without a Site-specific assignment',
      async () => {
        const result = await service.forAccount(site, { userId: globalAdminUser }, admin.context);
        assert.equal(result.userId, globalAdminUser);
        assert.equal(result.siteId, site);
      },
    );
    await t.test(
      'linking and same-account retries keep the Worker ID and account binding',
      async () => {
        const linked = await service.linkAccount(site, worker, { userId: linkUser }, admin.context);
        assert.equal(linked!.id, worker);
        assert.equal(linked!.userId, linkUser);
        const retried = await service.linkAccount(
          site,
          worker,
          { userId: linkUser },
          admin.context,
        );
        assert.equal(retried!.id, worker);
        assert.equal(retried!.userId, linkUser);
        assert.equal(
          (await service.forAccount(site, { userId: linkUser }, admin.context)).id,
          worker,
        );
      },
    );
    await t.test('existing binding cannot be replaced with another eligible account', async () => {
      await rejectUnchanged(
        () => service.linkAccount(site, worker, { userId: differentUser }, admin.context),
        409,
      );
    });
    await t.test('target assignment and Worker ownership remain Site-scoped', async () => {
      await rejectUnchanged(
        () => service.forAccount(site, { userId: otherSiteUser }, admin.context),
        409,
      );
      await rejectUnchanged(
        () => service.forAccount(otherSite, { userId: prepareUser }, admin.context),
        409,
      );
      await rejectUnchanged(
        () => service.linkAccount(site, worker, { userId: otherSiteUser }, admin.context),
        409,
      );
      await rejectUnchanged(
        () => service.linkAccount(site, otherWorker, { userId: linkUser }, admin.context),
        404,
      );
    });
    await t.test(
      'Site Manager cannot invoke either Admin command, including existing records',
      async () => {
        await rejectUnchanged(
          () => service.forAccount(site, { userId: prepareUser }, manager.context),
          403,
        );
        await rejectUnchanged(
          () => service.linkAccount(site, worker, { userId: linkUser }, manager.context),
          403,
        );
      },
    );
    await t.test(
      'disabled actor and revoked session block enrollment and same-account no-op',
      async () => {
        await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
        await rejectUnchanged(
          () => service.forAccount(site, { userId: prepareUser }, admin.context),
          [401, 403],
        );
        await rejectUnchanged(
          () => service.linkAccount(site, worker, { userId: linkUser }, admin.context),
          [401, 403],
        );
        await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          admin.sessionId,
        ]);
        await rejectUnchanged(
          () => service.forAccount(site, { userId: prepareUser }, admin.context),
          401,
        );
        await rejectUnchanged(
          () => service.linkAccount(site, worker, { userId: linkUser }, admin.context),
          401,
        );
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [admin.sessionId]);
        assert.equal(
          (await service.forAccount(site, { userId: prepareUser }, admin.context)).id,
          preparedId,
        );
      },
    );
    await t.test(
      'partial journal refuses enrollment and link without changing Worker rows',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(
          () => service.forAccount(site, { userId: differentUser }, admin.context),
          503,
        );
        await rejectUnchanged(
          () => service.linkAccount(site, worker, { userId: linkUser }, admin.context),
          503,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
