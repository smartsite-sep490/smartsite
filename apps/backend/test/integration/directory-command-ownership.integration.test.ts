import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { SiteRepresentativesService } from '../../src/modules/users/site-representatives.controller.js';

test('remaining directory writers reauthorize the original bearer and preserve Site and Contractor rules', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const sites = new SiteConfigurationService(db),
      users = new UsersService(db, sites),
      workforce = new WorkforceConfigurationService(db),
      contractors = new ContractorOperationsService(db),
      representatives = new SiteRepresentativesService(db, users, workforce),
      password = 'SyntheticInitial123!',
      admin = await users.bootstrap('synthetic-admin', 'Synthetic Admin', password),
      site = await sites.create({ code: 'SYNTHETIC-SITE', name: 'Synthetic Site' }),
      foreign = await sites.create({ code: 'FOREIGN-SITE', name: 'Foreign Site' });
    const seedActor = async (role: string) => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) SELECT $1,$1::uuid::text,'Synthetic actor',password_hash FROM app_user WHERE id=$2",
        [id, admin.id],
      );
      await db.query(
        'INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)',
        [randomUUID(), id, site.id, role],
      );
      return id;
    };
    const manager = await seedActor('SITE_MANAGER'),
      rep = await seedActor('CONTRACTOR_REPRESENTATIVE'),
      target = await seedActor('CONTRACTOR_REPRESENTATIVE'),
      contractor = randomUUID();
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from) VALUES($1,$2,$3,clock_timestamp()-interval '1 hour')",
      [randomUUID(), contractor, site.id],
    );
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), rep, contractor],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth);
    const actorFor = async (id: string, revoked = false) => {
      const login = await auth.login(
          id === admin.id ? admin.username : id,
          password,
          AuthClientType.WEB,
        ),
        request: AuthenticatedRequest = {
          headers: { authorization: 'Bearer ' + login.accessToken },
        };
      await guard.authenticateRequest(request);
      const context = configurationCommandContext(request, guard),
        actor = request.user!;
      if (revoked)
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          request.sessionId,
        ]);
      return { actor, context };
    };
    const deadManager = await actorFor(manager, true),
      liveManager = await actorFor(manager),
      deadAdmin = await actorFor(admin.id, true),
      liveAdmin = await actorFor(admin.id),
      deadRep = await actorFor(rep, true),
      liveRep = await actorFor(rep);
    const rejected = (status: number) => (error: unknown) =>
      (error as { getStatus(): number }).getStatus() === status;
    const range = {
      siteId: site.id,
      validFrom: new Date(Date.now() - 3600000).toISOString(),
      validUntil: null,
    };
    await t.test('participation', async () => {
      await assert.rejects(
        Reflect.apply(contractors.createParticipation, contractors, [
          deadManager.actor,
          contractor,
          range,
          deadManager.context,
        ]),
        rejected(401),
      );
      const value = await Reflect.apply(contractors.createParticipation, contractors, [
        liveManager.actor,
        contractor,
        range,
        liveManager.context,
      ]);
      assert.equal(value.siteId, site.id);
      await assert.rejects(
        Reflect.apply(contractors.createParticipation, contractors, [
          liveManager.actor,
          contractor,
          { ...range, siteId: foreign.id },
          liveManager.context,
        ]),
        rejected(403),
      );
    });
    await t.test('legacy global representative grant remains forbidden', async () => {
      for (const subject of [deadAdmin, liveAdmin, liveManager]) {
        await assert.rejects(
          Reflect.apply(contractors.grantRepresentative, contractors, [
            subject.actor,
            contractor,
            { userId: target },
          ]),
          rejected(403),
        );
      }
      assert.deepEqual(
        await db.query('SELECT user_id FROM contractor_representative_grant WHERE user_id=$1', [
          target,
        ]),
        [],
      );
    });
    await t.test('contractor worker', async () => {
      const input = {
        siteId: site.id,
        externalId: 'SYNTHETIC-WORKER',
        displayName: 'Synthetic Worker',
      };
      await assert.rejects(
        Reflect.apply(contractors.createWorker, contractors, [
          deadRep.actor,
          contractor,
          input,
          deadRep.context,
        ]),
        rejected(401),
      );
      assert.equal(
        (
          await Reflect.apply(contractors.createWorker, contractors, [
            liveRep.actor,
            contractor,
            input,
            liveRep.context,
          ])
        ).siteId,
        site.id,
      );
      await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [rep]);
      await assert.rejects(
        Reflect.apply(contractors.createWorker, contractors, [
          liveRep.actor,
          contractor,
          { ...input, externalId: 'REJECTED' },
          liveRep.context,
        ]),
        rejected(403),
      );
    });
    await t.test('site contractor', async () => {
      const input = { code: 'NEW-SYNTHETIC', name: 'New synthetic contractor' };
      await assert.rejects(
        Reflect.apply(workforce.createContractor, workforce, [site.id, input, deadManager.context]),
        rejected(401),
      );
      assert.equal(
        (
          await Reflect.apply(workforce.createContractor, workforce, [
            site.id,
            input,
            liveManager.context,
          ])
        ).code,
        input.code,
      );
    });
    await t.test('representative assignment', async () => {
      await assert.rejects(
        Reflect.apply(workforce.assignRepresentative, workforce, [
          site.id,
          contractor,
          { userId: target },
          deadManager.context,
        ]),
        rejected(401),
      );
      const value = await Reflect.apply(workforce.assignRepresentative, workforce, [
        site.id,
        contractor,
        { userId: target },
        liveManager.context,
      ]);
      assert.equal(value.siteId, site.id);
      await assert.rejects(
        Reflect.apply(workforce.assignRepresentative, workforce, [
          foreign.id,
          contractor,
          { userId: target },
          liveManager.context,
        ]),
        rejected(403),
      );
    });
    await t.test('representative existing contractor composite', async () => {
      const input = {
        username: 'synthetic-new-rep',
        displayName: 'Synthetic New Rep',
        temporaryPassword: password,
      };
      await assert.rejects(
        Reflect.apply(representatives.create, representatives, [
          site.id,
          contractor,
          input,
          deadManager.context,
        ]),
        rejected(401),
      );
      const value = await Reflect.apply(representatives.create, representatives, [
        site.id,
        contractor,
        input,
        liveManager.context,
      ]);
      assert.equal(value.username, input.username);
    });
    await t.test('representative new contractor composite', async () => {
      const input = {
        username: 'synthetic-combined-rep',
        displayName: 'Synthetic Combined Rep',
        temporaryPassword: password,
        contractorName: 'Synthetic combined contractor',
        validFrom: range.validFrom,
        validUntil: null,
      };
      await assert.rejects(
        Reflect.apply(representatives.createWithContractor, representatives, [
          site.id,
          input,
          deadManager.context,
        ]),
        rejected(401),
      );
      assert.equal(
        (
          await Reflect.apply(representatives.createWithContractor, representatives, [
            site.id,
            input,
            liveManager.context,
          ])
        ).username,
        input.username,
      );
    });
    await t.test('duplicate account rolls back the complete new Contractor composite', async () => {
      const before = (await db.query('SELECT count(*)::int AS n FROM contractor'))[0].n;
      await assert.rejects(
        Reflect.apply(representatives.createWithContractor, representatives, [
          site.id,
          {
            username: 'synthetic-new-rep',
            displayName: 'Duplicate synthetic',
            temporaryPassword: password,
            contractorName: 'Must roll back',
            validFrom: range.validFrom,
            validUntil: null,
          },
          liveManager.context,
        ]),
        rejected(409),
      );
      assert.equal((await db.query('SELECT count(*)::int AS n FROM contractor'))[0].n, before);
    });
    await t.test('metadata renames', async () => {
      const input = { expectedName: 'Synthetic Contractor', name: 'Renamed Synthetic Contractor' };
      await assert.rejects(
        Reflect.apply(workforce.renameContractor, workforce, [
          site.id,
          contractor,
          input,
          deadManager.context,
        ]),
        rejected(401),
      );
      assert.equal(
        (
          await Reflect.apply(workforce.renameContractor, workforce, [
            site.id,
            contractor,
            input,
            liveManager.context,
          ])
        ).name,
        input.name,
      );
      const value = (
        await db.query("SELECT id FROM app_user WHERE username='synthetic-new-rep'")
      )[0];
      const name = { expectedName: 'Synthetic New Rep', name: 'Renamed Synthetic Rep' };
      await assert.rejects(
        Reflect.apply(representatives.rename, representatives, [
          site.id,
          value.id,
          name,
          deadManager.context,
        ]),
        rejected(401),
      );
      assert.equal(
        (
          await Reflect.apply(representatives.rename, representatives, [
            site.id,
            value.id,
            name,
            liveManager.context,
          ])
        ).name,
        name.name,
      );
    });
    await t.test(
      'current Manager and Admin role removals override cached actor snapshots',
      async () => {
        await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [manager]);
        await assert.rejects(
          Reflect.apply(workforce.createContractor, workforce, [
            site.id,
            { name: 'Rejected lost Manager' },
            liveManager.context,
          ]),
          rejected(403),
        );
        await db.query(
          "UPDATE user_role_assignment SET role='WORKER',site_id=$2 WHERE user_id=$1",
          [admin.id, site.id],
        );
        await assert.rejects(
          Reflect.apply(contractors.grantRepresentative, contractors, [
            liveAdmin.actor,
            contractor,
            { userId: target },
            liveAdmin.context,
          ]),
          rejected(403),
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
