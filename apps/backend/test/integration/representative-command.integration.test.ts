import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteRepresentativesService } from '../../src/modules/users/site-representatives.controller.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('representative commands keep transaction authentication, Site scope and atomicity', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      actor = randomUUID(),
      session = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Manager','not-a-runtime-password')",
      [actor],
    );
    const managerRole = randomUUID();
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$2,'SAFETY_OFFICER',$5)",
      [managerRole, actor, site, randomUUID(), otherSite],
    );
    await db.query(
      "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [session, actor, 'a'.repeat(64)],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const token = await tokens.issueAccessToken(actor, session);
    const auth = new AuthService(db, tokens);
    const sites = new SiteConfigurationService(db),
      users = new UsersService(db, sites);
    const service = new SiteRepresentativesService(
      db,
      users,
      new WorkforceConfigurationService(db),
    );
    const context = {
      actorUserId: actor,
      reauthorize: async (manager: EntityManager) => {
        assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, actor);
      },
    };
    const input = () => ({
      username: `synthetic-${randomUUID()}`,
      displayName: 'Synthetic Rep',
      temporaryPassword: 'Synthetic_Rep_123',
    });
    const combined = () => ({
      ...input(),
      contractorName: 'Synthetic Contractor',
      validFrom: '2020-01-01T00:00:00Z',
      validUntil: null,
    });
    const snapshot = () =>
      db.query(
        'SELECT (SELECT count(*)::int FROM app_user) AS users,(SELECT count(*)::int FROM contractor) AS contractors,(SELECT count(*)::int FROM contractor_site_participation) AS participations,(SELECT count(*)::int FROM contractor_representative_assignment) AS assignments',
      );
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number | number[]) => {
      const before = await snapshot();
      await assert.rejects(work, (error) => {
        const status = (error as { getStatus?: () => number }).getStatus?.();
        return Array.isArray(expected) ? expected.includes(status!) : status === expected;
      });
      assert.deepEqual(await snapshot(), before);
    };
    let representativeId: string, contractorId: string;
    await t.test(
      'allowed manager creates combined and existing-contractor accounts, then renames',
      async () => {
        const first = await service.createWithContractor(site, combined(), context);
        assert.ok(first);
        representativeId = first.id;
        [{ contractor_id: contractorId }] = await db.query(
          'SELECT contractor_id FROM contractor_representative_assignment WHERE user_id=$1',
          [first.id],
        );
        const second = await service.create(site, contractorId, input(), context);
        assert.ok(second.id);
        assert.equal(
          (
            await service.rename(
              site,
              first.id,
              { expectedName: 'Synthetic Rep', name: 'Renamed Rep' },
              context,
            )
          ).name,
          'Renamed Rep',
        );
      },
    );
    await t.test('cross-Site manager role cannot create or rename', async () => {
      await rejectUnchanged(
        () => service.createWithContractor(otherSite, combined(), context),
        403,
      );
      await rejectUnchanged(
        () =>
          service.rename(
            otherSite,
            representativeId,
            { expectedName: 'Renamed Rep', name: 'Must not save' },
            context,
          ),
        403,
      );
    });
    await t.test('lost Site Manager role prevents writes with still-valid bearer', async () => {
      await db.query('DELETE FROM user_role_assignment WHERE id=$1', [managerRole]);
      await rejectUnchanged(() => service.create(site, contractorId, input(), context), 403);
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
        [managerRole, actor, site],
      );
    });
    await t.test('disabled actor and revoked session prevent writes', async () => {
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
      await rejectUnchanged(
        () => service.createWithContractor(site, combined(), context),
        [401, 403],
      );
      await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
      await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [session]);
      await rejectUnchanged(() => service.create(site, contractorId, input(), context), 401);
      await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
    });
    await t.test(
      'invalid contractor rolls back the account created in its transaction',
      async () => {
        await rejectUnchanged(() => service.create(site, randomUUID(), input(), context), 404);
      },
    );
    await t.test(
      'existing representative assignment rechecks scope and bearer even on no-op',
      async () => {
        const workforce = new WorkforceConfigurationService(db);
        const value = { userId: representativeId };
        const assignment = await workforce.assignRepresentative(site, contractorId, value, context);
        assert.equal(assignment.userId, representativeId);
        await rejectUnchanged(
          () => workforce.assignRepresentative(otherSite, contractorId, value, context),
          403,
        );
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          session,
        ]);
        await rejectUnchanged(
          () => workforce.assignRepresentative(site, contractorId, value, context),
          401,
        );
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
      },
    );
    await t.test(
      'partial canonical journal refuses all combined writes before mutation',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(() => service.createWithContractor(site, combined(), context), 503);
        await rejectUnchanged(
          () =>
            new WorkforceConfigurationService(db).assignRepresentative(
              site,
              contractorId,
              { userId: representativeId },
              context,
            ),
          503,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
