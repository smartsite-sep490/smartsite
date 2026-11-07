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

test('Site contractor commands recheck the original Site Manager while preserving profile rules', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      actor = randomUUID(),
      admin = randomUUID(),
      foreignContractor = randomUUID();
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
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3),($4,$5,'ADMIN',NULL)",
      [randomUUID(), actor, site, randomUUID(), admin],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Foreign Contractor')",
      [foreignContractor],
    );
    const participation = async (contractorId: string, siteId: string) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,is_active) VALUES($1,$2,$3,'2020-01-01T00:00:00Z',true)",
        [id, contractorId, siteId],
      );
      return id;
    };
    await participation(foreignContractor, otherSite);
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
    const manager = await authenticated(actor),
      administrator = await authenticated(admin),
      service = new WorkforceConfigurationService(db);
    const code = `SYN-${randomUUID()}`;
    let contractorId: string,
      currentName = 'Synthetic Contractor';
    const input = () => ({ code, name: currentName });
    const rename = () => ({ expectedName: currentName, name: 'Renamed Contractor' });
    const snapshot = () => db.query('SELECT * FROM contractor ORDER BY id');
    const rejectUnchanged = async (work: () => Promise<unknown>, expected: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === expected,
      );
      assert.deepEqual(await snapshot(), before);
    };
    await t.test(
      'scoped manager creates and reuses a matching active contractor code',
      async () => {
        const first = await service.createContractor(site, input(), manager.context);
        contractorId = first.id;
        assert.equal(first.code, code);
        assert.equal(first.name, currentName);
        assert.equal(
          (await service.createContractor(site, input(), manager.context)).id,
          contractorId,
        );
        assert.equal((await db.query('SELECT id FROM contractor WHERE code=$1', [code])).length, 1);
      },
    );
    await t.test(
      'existing code with another name or inactive profile remains a conflict',
      async () => {
        await rejectUnchanged(
          () =>
            service.createContractor(site, { code, name: 'Different Contractor' }, manager.context),
          409,
        );
        await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [contractorId]);
        await rejectUnchanged(() => service.createContractor(site, input(), manager.context), 409);
        await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [contractorId]);
      },
    );
    await t.test(
      'rename requires participation, then preserves expected-name concurrency checks',
      async () => {
        await rejectUnchanged(
          () => service.renameContractor(site, contractorId, rename(), manager.context),
          404,
        );
        await participation(contractorId, site);
        const changed = await service.renameContractor(
          site,
          contractorId,
          rename(),
          manager.context,
        );
        assert.equal(changed.id, contractorId);
        assert.equal(changed.name, 'Renamed Contractor');
        await rejectUnchanged(
          () => service.renameContractor(site, contractorId, rename(), manager.context),
          409,
        );
        currentName = changed.name;
      },
    );
    await t.test(
      'shared profiles cannot be renamed through a Site and foreign profiles are not found',
      async () => {
        const shared = await participation(contractorId, otherSite);
        await rejectUnchanged(
          () => service.renameContractor(site, contractorId, rename(), manager.context),
          409,
        );
        await db.query('DELETE FROM contractor_site_participation WHERE id=$1', [shared]);
        await rejectUnchanged(
          () =>
            service.renameContractor(
              site,
              foreignContractor,
              { expectedName: 'Foreign Contractor', name: 'Must not save' },
              manager.context,
            ),
          404,
        );
      },
    );
    await t.test('global Admin does not bypass the Site Manager rule', async () => {
      await rejectUnchanged(
        () => service.createContractor(site, input(), administrator.context),
        403,
      );
      await rejectUnchanged(
        () => service.renameContractor(site, contractorId, rename(), administrator.context),
        403,
      );
    });
    await t.test('manager assigned only to another Site cannot create or rename', async () => {
      await rejectUnchanged(
        () => service.createContractor(otherSite, input(), manager.context),
        403,
      );
      await rejectUnchanged(
        () =>
          service.renameContractor(
            otherSite,
            foreignContractor,
            { expectedName: 'Foreign Contractor', name: 'Must not save' },
            manager.context,
          ),
        403,
      );
    });
    await t.test('revoked bearer blocks matching-code reuse and metadata rename', async () => {
      await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
        manager.sessionId,
      ]);
      await rejectUnchanged(() => service.createContractor(site, input(), manager.context), 401);
      await rejectUnchanged(
        () => service.renameContractor(site, contractorId, rename(), manager.context),
        401,
      );
      await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [manager.sessionId]);
    });
    await t.test(
      'partial journal blocks creation while name-only mutation remains metadata',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(
          () => service.createContractor(site, { name: 'Must not create' }, manager.context),
          503,
        );
        const changed = await service.renameContractor(
          site,
          contractorId,
          { expectedName: currentName, name: 'Metadata Only' },
          manager.context,
        );
        assert.equal(changed.name, 'Metadata Only');
      },
    );
  } finally {
    await owned.dispose();
  }
});
