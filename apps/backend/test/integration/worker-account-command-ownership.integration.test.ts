import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('Contractor Worker account/profile writes reauthorize original Representative and preserve atomic retries', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      actor = randomUUID(),
      password = 'SyntheticInitial123!';
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Rep',$2)",
      [actor, await hashPassword(password)],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'CONTRACTOR_REPRESENTATIVE')",
      [randomUUID(), actor, site],
    );
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), actor, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from) VALUES($1,$2,$3,clock_timestamp()-interval '1 hour')",
      [randomUUID(), site, contractor],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth),
      accounts = new ContractorWorkerAccountsService(
        db,
        new ContractorOperationsService(db),
        new UsersService(db, new SiteConfigurationService(db)),
      );
    const actorFor = async () => {
      const login = await auth.login(actor, password, AuthClientType.WEB),
        request: AuthenticatedRequest = {
          headers: { authorization: 'Bearer ' + login.accessToken },
        };
      await guard.authenticateRequest(request);
      return {
        request,
        actor: request.user!,
        context: configurationCommandContext(request, guard),
      };
    };
    const input = {
      siteId: site,
      externalId: 'SYNTHETIC-001',
      username: 'synthetic-worker',
      displayName: 'Synthetic Worker',
      temporaryPassword: password,
      nationalId: '000000000001',
      phoneNumber: '0000000000',
      gender: 'OTHER' as const,
      address: 'Synthetic test address',
    };
    const dead = await actorFor();
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      dead.request.sessionId,
    ]);
    await assert.rejects(
      Reflect.apply(accounts.create, accounts, [dead.actor, contractor, input, dead.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM worker'))[0].n, 0);
    const live = await actorFor();
    const created = await Reflect.apply(accounts.create, accounts, [
      live.actor,
      contractor,
      input,
      live.context,
    ]);
    assert.equal(created.account.username, input.username);
    const initial = Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      ),
      snapshot = { externalId: input.externalId, displayName: input.displayName, isActive: true },
      update = { ...snapshot, displayName: 'Synthetic renamed', expectedSnapshot: snapshot };
    await assert.rejects(
      Reflect.apply(accounts.update, accounts, [
        dead.actor,
        site,
        contractor,
        created.worker.id,
        update,
        dead.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [actor]);
    await assert.rejects(
      Reflect.apply(accounts.update, accounts, [
        live.actor,
        site,
        contractor,
        created.worker.id,
        update,
        live.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query(
      "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE' WHERE user_id=$1",
      [actor],
    );
    const changed = await Reflect.apply(accounts.update, accounts, [
      live.actor,
      site,
      contractor,
      created.worker.id,
      update,
      live.context,
    ]);
    assert.equal(changed.displayName, update.displayName);
    const repeated = await Reflect.apply(accounts.update, accounts, [
      live.actor,
      site,
      contractor,
      created.worker.id,
      update,
      live.context,
    ]);
    assert.equal(repeated.displayName, update.displayName);
    assert.equal(
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      ),
      initial + 1,
    );
    await assert.rejects(
      Reflect.apply(accounts.update, accounts, [
        live.actor,
        site,
        contractor,
        created.worker.id,
        { ...update, displayName: 'Different edit' },
        live.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 409,
    );
    await assert.rejects(
      Reflect.apply(accounts.create, accounts, [live.actor, contractor, input, live.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 409,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM worker'))[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM app_user'))[0].n, 2);
  } finally {
    await owned.dispose();
  }
});
