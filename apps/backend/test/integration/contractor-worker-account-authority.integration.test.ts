import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Contractor Worker account and profile commands bind the original session to atomic writes', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      actorId = randomUUID(),
      role = randomUUID(),
      sessionId = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Representative','not-a-runtime-password')",
      [actorId],
    );
    const restoreRole = () =>
      db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
        [role, actorId, site],
      );
    await restoreRole();
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
      [randomUUID(), actorId, site],
    );
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), actorId, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from) VALUES($1,$2,$3,'2020-01-01T00:00:00Z')",
      [randomUUID(), contractor, site],
    );
    await db.query(
      "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [sessionId, actorId, sessionId.replaceAll('-', '').repeat(2)],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig()),
      auth = new AuthService(db, tokens);
    const token = await tokens.issueAccessToken(actorId, sessionId);
    const actor = (await auth.authenticate(token.accessToken)).user;
    const context = {
      actorUserId: actor.id,
      reauthorize: async (manager: EntityManager) => {
        assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, actor.id);
      },
    };
    const users = new UsersService(db, new SiteConfigurationService(db));
    const service = new ContractorWorkerAccountsService(
      db,
      new ContractorOperationsService(db),
      users,
    );
    const input = () => ({
      siteId: site,
      username: `synthetic-${randomUUID()}`,
      externalId: `SYN-${randomUUID()}`,
      displayName: 'Synthetic Worker',
      nationalId: '000000000001',
      phoneNumber: '0900000001',
      gender: 'OTHER' as const,
      address: 'Synthetic address',
    });
    const firstInput = input();
    const create = (value = firstInput) =>
      Reflect.apply(service.create, service, [actor, contractor, value, context]) as ReturnType<
        ContractorWorkerAccountsService['create']
      >;
    let workerId: string;
    const expectedSnapshot = {
      externalId: firstInput.externalId,
      displayName: firstInput.displayName,
      isActive: true,
    };
    const updateInput = {
      ...expectedSnapshot,
      displayName: 'Updated Worker',
      isActive: false,
      expectedSnapshot,
    };
    const update = () =>
      Reflect.apply(service.update, service, [
        actor,
        site,
        contractor,
        workerId,
        updateInput,
        context,
      ]) as ReturnType<ContractorWorkerAccountsService['update']>;
    const snapshot = async () => [
      await db.query('SELECT id,username FROM app_user ORDER BY id'),
      await db.query('SELECT * FROM user_role_assignment ORDER BY id'),
      await db.query('SELECT * FROM worker ORDER BY id'),
      await db.query('SELECT * FROM worker_compliance_profile ORDER BY worker_id'),
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
    const siteVersion = async () =>
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      );
    const revoke = () =>
      db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [sessionId]);
    const restoreSession = () =>
      db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [sessionId]);

    await t.test(
      'authenticated creation commits account, scoped role, linked Worker and compliance profile together',
      async () => {
        const result = await create();
        workerId = result.worker.id;
        assert.deepEqual(
          await db.query(
            `SELECT w.site_id,w.contractor_id,w.user_id,u.username,r.role,p.identity_required
           FROM worker w JOIN app_user u ON u.id=w.user_id
           JOIN user_role_assignment r ON r.user_id=u.id AND r.site_id=w.site_id
           JOIN worker_compliance_profile p ON p.worker_id=w.id WHERE w.id=$1`,
            [workerId],
          ),
          [
            {
              site_id: site,
              contractor_id: contractor,
              user_id: result.account.id,
              username: firstInput.username,
              role: 'WORKER',
              identity_required: true,
            },
          ],
        );
        await rejectUnchanged(() => create({ ...input(), externalId: firstInput.externalId }), 409);
      },
    );
    await t.test(
      'profile change bumps Site and audits once while exact retry leaves rows unchanged',
      async () => {
        const version = await siteVersion();
        const updated = await update();
        assert.equal(updated.isActive, false);
        assert.equal(updated.displayName, updateInput.displayName);
        assert.equal(await siteVersion(), version + 1);
        assert.equal(
          (
            await db.query(
              "SELECT id FROM audit_log WHERE entity_id=$1 AND action='WORKER_PROFILE_UPDATED'",
              [workerId],
            )
          ).length,
          1,
        );
        const before = await snapshot();
        assert.equal((await update()).id, workerId);
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test(
      'expired and revoked original session reject exact profile retries and account requests',
      async () => {
        await db.query(
          "UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [sessionId],
        );
        try {
          await rejectUnchanged(update, 401);
          await rejectUnchanged(create, 401);
        } finally {
          await db.query(
            "UPDATE auth_session SET expires_at=clock_timestamp()+interval '10 minutes' WHERE id=$1",
            [sessionId],
          );
        }
        await revoke();
        try {
          await rejectUnchanged(update, 401);
          await rejectUnchanged(create, 401);
        } finally {
          await restoreSession();
        }
      },
    );
    await t.test(
      'current CR role removal defeats a stale actor even though the bearer still authenticates',
      async () => {
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
        try {
          assert.equal((await auth.authenticate(token.accessToken)).user.id, actorId);
          await rejectUnchanged(update, 403);
          await rejectUnchanged(() => create(input()), 403);
        } finally {
          await restoreRole();
        }
      },
    );
    await t.test('session revoked after hashing prevents any Worker account creation', async () => {
      const prepare = users.prepareWorkerAccount.bind(users);
      let prepared = false;
      users.prepareWorkerAccount = async (value) => {
        const result = await prepare(value);
        prepared = true;
        await revoke();
        return result;
      };
      try {
        await rejectUnchanged(() => create(input()), 401);
        assert.equal(prepared, true);
      } finally {
        users.prepareWorkerAccount = prepare;
        await restoreSession();
      }
    });
    await t.test('partial authority journal prevents both account and profile writes', async () => {
      await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
      await rejectUnchanged(() => create(input()), 503);
      await rejectUnchanged(update, 503);
    });
  } finally {
    await owned.dispose();
  }
});
