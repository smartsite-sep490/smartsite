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
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('team mutations recheck the original Representative session and scope without changing team lifecycle', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      actor = randomUUID(),
      worker = randomUUID(),
      participation = randomUUID(),
      zone = randomUUID(),
      permission = randomUUID();
    const password = 'SyntheticInitial123!',
      from = new Date(Date.now() - 60000),
      until = new Date(Date.now() + 172800000);
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
      'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), actor, site, contractor],
    );
    await db.query(
      'INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,$4,$5)',
      [participation, site, contractor, from, until],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
      [zone, site],
    );
    await db.query(
      'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
      [permission, participation, zone, from, until, actor],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth),
      teams = new ContractorTeamsService(db);
    const contextFor = async () => {
      const login = await auth.login(actor, password, AuthClientType.WEB),
        request: AuthenticatedRequest = {
          headers: { authorization: 'Bearer ' + login.accessToken },
        };
      await guard.authenticateRequest(request);
      return { request, context: configurationCommandContext(request, guard) };
    };
    const revoked = await contextFor();
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      revoked.request.sessionId,
    ]);
    const create = { requestId: randomUUID(), name: 'Synthetic Team', description: '' },
      edit = { expectedVersion: 1, name: 'Renamed Team', description: '' },
      archive = { expectedVersion: 2, reason: 'Synthetic archive' },
      assignment = {
        requestId: randomUUID(),
        expectedMembershipId: null,
        teamId: create.requestId,
      };
    const grant = {
      requestId: randomUUID(),
      contractorZonePermissionId: permission,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: until.toISOString().slice(0, 10),
      timezone: 'UTC',
    };
    const who = revoked.request.user!;
    const attempts = [
      () => Reflect.apply(teams.create, teams, [who, site, contractor, create, revoked.context]),
      () =>
        Reflect.apply(teams.update, teams, [
          who,
          site,
          contractor,
          create.requestId,
          edit,
          revoked.context,
        ]),
      () =>
        Reflect.apply(teams.archive, teams, [
          who,
          site,
          contractor,
          create.requestId,
          archive,
          revoked.context,
        ]),
      () =>
        Reflect.apply(teams.assign, teams, [
          who,
          site,
          contractor,
          worker,
          assignment,
          revoked.context,
        ]),
      () =>
        Reflect.apply(teams.grantZone, teams, [
          who,
          site,
          contractor,
          create.requestId,
          grant,
          undefined,
          revoked.context,
        ]),
      () =>
        Reflect.apply(teams.revokeZone, teams, [
          who,
          site,
          contractor,
          create.requestId,
          randomUUID(),
          revoked.context,
        ]),
    ];
    for (const attempt of attempts)
      await assert.rejects(attempt, (e) => (e as { getStatus(): number }).getStatus() === 401);
    const active = await contextFor(),
      rep = active.request.user!,
      context = active.context;
    await assert.rejects(
      Reflect.apply(teams.create, teams, [rep, site, randomUUID(), create, context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query('UPDATE contractor_site_participation SET valid_until=$2 WHERE id=$1', [
      participation,
      new Date(from.getTime() + 1000),
    ]);
    await assert.rejects(
      Reflect.apply(teams.create, teams, [rep, site, contractor, create, context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query('UPDATE contractor_site_participation SET valid_until=$2 WHERE id=$1', [
      participation,
      until,
    ]);
    await db.query('DELETE FROM contractor_representative_assignment WHERE user_id=$1', [actor]);
    await assert.rejects(
      Reflect.apply(teams.create, teams, [rep, site, contractor, create, context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query(
      'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), actor, site, contractor],
    );
    const team = await Reflect.apply(teams.create, teams, [rep, site, contractor, create, context]);
    assert.equal(team.id, create.requestId);
    const repeated = await Reflect.apply(teams.create, teams, [
      rep,
      site,
      contractor,
      create,
      context,
    ]);
    assert.equal(repeated.id, team.id);
    await Reflect.apply(teams.update, teams, [rep, site, contractor, team.id, edit, context]);
    const assigned = await Reflect.apply(teams.assign, teams, [
      rep,
      site,
      contractor,
      worker,
      assignment,
      context,
    ]);
    assert.equal(assigned.teamId, team.id);
    const granted = await Reflect.apply(teams.grantZone, teams, [
      rep,
      site,
      contractor,
      team.id,
      grant,
      undefined,
      context,
    ]);
    assert.equal(granted.id, grant.requestId);
    await Reflect.apply(teams.revokeZone, teams, [
      rep,
      site,
      contractor,
      team.id,
      granted.id,
      context,
    ]);
    await Reflect.apply(teams.assign, teams, [
      rep,
      site,
      contractor,
      worker,
      {
        requestId: randomUUID(),
        expectedMembershipId: assigned.membershipId,
        teamId: null,
        reason: 'Synthetic removal',
      },
      context,
    ]);
    const archived = await Reflect.apply(teams.archive, teams, [
      rep,
      site,
      contractor,
      team.id,
      archive,
      context,
    ]);
    assert.equal(archived.isActive, false);
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [actor]);
    await assert.rejects(
      Reflect.apply(teams.create, teams, [
        rep,
        site,
        contractor,
        { ...create, requestId: randomUUID() },
        context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
  } finally {
    await owned.dispose();
  }
});
