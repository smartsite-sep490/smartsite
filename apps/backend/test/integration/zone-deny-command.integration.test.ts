import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { ZoneAccessEffect } from '../../src/database/entities/zone-access-grant.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Zone DENY commands recheck bearer, Site scope and journal before writes or no-ops', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      zone = randomUUID(),
      otherZone = randomUUID(),
      worker = randomUUID(),
      otherWorker = randomUUID(),
      actor = randomUUID(),
      session = randomUUID(),
      role = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const [id, scope] of [
      [zone, site],
      [otherZone, otherSite],
    ])
      await db.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
        [id, scope],
      );
    for (const [id, scope] of [
      [worker, site],
      [otherWorker, otherSite],
    ])
      await db.query(
        "INSERT INTO worker(id,site_id,external_id,display_name,is_active) VALUES($1,$2,$1::uuid::text,'Synthetic Worker',true)",
        [id, scope],
      );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Manager','not-a-runtime-password')",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$2,'SAFETY_OFFICER',$5)",
      [role, actor, site, randomUUID(), otherSite],
    );
    await db.query(
      "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [session, actor, 'b'.repeat(64)],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const token = await tokens.issueAccessToken(actor, session);
    const auth = new AuthService(db, tokens);
    const context = {
      actorUserId: actor,
      reauthorize: async (manager: EntityManager) => {
        assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, actor);
      },
    };
    const service = new ZoneAccessManagementService(db);
    const input = () => ({
      workerId: worker,
      effect: ZoneAccessEffect.DENY,
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: null,
    });
    const snapshot = () => db.query('SELECT * FROM zone_access_grant ORDER BY id');
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number | number[]) => {
      const before = await snapshot();
      await assert.rejects(work, (error) => {
        const status = (error as { getStatus?: () => number }).getStatus?.();
        return Array.isArray(expected) ? expected.includes(status!) : status === expected;
      });
      assert.deepEqual(await snapshot(), before);
    };
    let grantId: string;
    await t.test(
      'scoped manager creates DENY and repeated revoke preserves its first timestamp',
      async () => {
        const grant = await service.createGrant(site, zone, input(), context);
        grantId = grant.id;
        assert.equal(grant.siteId, site);
        assert.equal(grant.zoneId, zone);
        assert.equal(grant.workerId, worker);
        assert.equal(grant.effect, ZoneAccessEffect.DENY);
        assert.equal(grant.revokedAt, null);
        const firstTime = new Date('2025-01-01T00:00:00Z');
        const revoked = await service.revokeGrant(site, zone, grantId, firstTime, context);
        assert.equal(revoked.revokedAt?.toISOString(), firstTime.toISOString());
        const retried = await service.revokeGrant(site, zone, grantId, new Date(), context);
        assert.equal(retried.revokedAt?.toISOString(), firstTime.toISOString());
        assert.equal((await snapshot()).length, 1);
      },
    );
    await t.test('ALLOW remains refused rather than bypassing assignment permissions', async () => {
      await rejectUnchanged(
        () =>
          service.createGrant(site, zone, { ...input(), effect: ZoneAccessEffect.ALLOW }, context),
        409,
      );
    });
    await t.test('manager role on another Site cannot create or revoke', async () => {
      await rejectUnchanged(
        () =>
          service.createGrant(otherSite, otherZone, { ...input(), workerId: otherWorker }, context),
        403,
      );
      await rejectUnchanged(
        () => service.revokeGrant(otherSite, otherZone, grantId, undefined, context),
        403,
      );
    });
    await t.test(
      'cross-Site Zone, Worker and grant IDs are not accepted under an authorized Site',
      async () => {
        await rejectUnchanged(() => service.createGrant(site, otherZone, input(), context), 404);
        await rejectUnchanged(
          () => service.createGrant(site, zone, { ...input(), workerId: otherWorker }, context),
          404,
        );
        await rejectUnchanged(
          () => service.revokeGrant(site, otherZone, grantId, undefined, context),
          404,
        );
      },
    );
    await t.test('inactive Worker cannot receive a new DENY', async () => {
      await db.query('UPDATE worker SET is_active=false WHERE id=$1', [worker]);
      await rejectUnchanged(() => service.createGrant(site, zone, input(), context), 404);
      await db.query('UPDATE worker SET is_active=true WHERE id=$1', [worker]);
    });
    await t.test(
      'lost Site Manager role and disabled account are rejected before writes',
      async () => {
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
        await rejectUnchanged(() => service.createGrant(site, zone, input(), context), 403);
        await rejectUnchanged(
          () => service.revokeGrant(site, zone, grantId, undefined, context),
          403,
        );
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
          [role, actor, site],
        );
        await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
        await rejectUnchanged(() => service.createGrant(site, zone, input(), context), [401, 403]);
        await rejectUnchanged(
          () => service.revokeGrant(site, zone, grantId, undefined, context),
          [401, 403],
        );
        await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
      },
    );
    await t.test('revoked bearer is rejected even for an already revoked grant', async () => {
      await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [session]);
      await rejectUnchanged(() => service.createGrant(site, zone, input(), context), 401);
      await rejectUnchanged(
        () => service.revokeGrant(site, zone, grantId, undefined, context),
        401,
      );
      await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
    });
    await t.test(
      'partial journal prevents create and revoke without changing stored grants',
      async () => {
        const active = await service.createGrant(site, zone, input(), context);
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(() => service.createGrant(site, zone, input(), context), 503);
        await rejectUnchanged(
          () => service.revokeGrant(site, zone, active.id, undefined, context),
          503,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
