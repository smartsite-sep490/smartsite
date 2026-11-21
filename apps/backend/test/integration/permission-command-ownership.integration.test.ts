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
import {
  SiteAccessSetupService,
  type GrantWorkerZoneCommand,
} from '../../src/modules/workforce/access/site-access-setup.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('Zone permission commands recheck original bearer and scope and commit Site policy changes atomically', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      managerId = randomUUID(),
      repId = randomUUID(),
      worker = randomUUID(),
      participation = randomUUID(),
      zone = randomUUID(),
      assignment = randomUUID();
    const password = 'SyntheticInitial123!',
      hash = await hashPassword(password),
      from = new Date(Date.now() - 60000),
      until = new Date(Date.now() + 86400000);
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Manager',$3),($2,$2::uuid::text,'Synthetic Rep',$3)",
      [managerId, repId, hash],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER'),($4,$5,$3,'CONTRACTOR_REPRESENTATIVE')",
      [randomUUID(), managerId, site, randomUUID(), repId],
    );
    await db.query(
      'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), repId, site, contractor],
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
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,$5,'APPROVED',$6,$7,$8)",
      [assignment, worker, site, participation, [zone], from, until, repId],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth),
      setup = new SiteAccessSetupService(db);
    const actorFor = async (id: string) => {
      const login = await auth.login(id, password, AuthClientType.WEB),
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
    const deadManager = await actorFor(managerId),
      deadRep = await actorFor(repId);
    await db.query(
      'UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
      [[deadManager.request.sessionId, deadRep.request.sessionId]],
    );
    const contractorInput = {
      requestId: randomUUID(),
      siteContractorId: participation,
      zoneId: zone,
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
    };
    const workerInput: GrantWorkerZoneCommand = {
      requestId: randomUUID(),
      workerAssignmentId: assignment,
      contractorZonePermissionId: randomUUID(),
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
    };
    const denied = [
      () =>
        Reflect.apply(setup.grantContractor, setup, [
          deadManager.actor,
          site,
          contractorInput,
          deadManager.context,
        ]),
      () =>
        Reflect.apply(setup.grantWorker, setup, [
          deadRep.actor,
          site,
          workerInput,
          deadRep.context,
        ]),
      () =>
        Reflect.apply(setup.revoke, setup, [
          deadManager.actor,
          site,
          randomUUID(),
          'contractor',
          deadManager.context,
        ]),
      () =>
        Reflect.apply(setup.revoke, setup, [
          deadRep.actor,
          site,
          randomUUID(),
          'worker',
          deadRep.context,
        ]),
    ];
    for (const call of denied)
      await assert.rejects(call, (e) => (e as { getStatus(): number }).getStatus() === 401);
    const manager = await actorFor(managerId),
      rep = await actorFor(repId),
      initial = Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      );
    const cp = await Reflect.apply(setup.grantContractor, setup, [
      manager.actor,
      site,
      contractorInput,
      manager.context,
    ]);
    const retry = await Reflect.apply(setup.grantContractor, setup, [
      manager.actor,
      site,
      contractorInput,
      manager.context,
    ]);
    assert.equal(retry.id, cp.id);
    workerInput.contractorZonePermissionId = cp.id;
    await db.query('DELETE FROM contractor_representative_assignment WHERE user_id=$1', [repId]);
    await assert.rejects(
      Reflect.apply(setup.grantWorker, setup, [rep.actor, site, workerInput, rep.context]),
    );
    await db.query(
      'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), repId, site, contractor],
    );
    const wp = await Reflect.apply(setup.grantWorker, setup, [
      rep.actor,
      site,
      workerInput,
      rep.context,
    ]);
    await Reflect.apply(setup.revoke, setup, [rep.actor, site, wp.id, 'worker', rep.context]);
    await Reflect.apply(setup.revoke, setup, [
      manager.actor,
      site,
      cp.id,
      'contractor',
      manager.context,
    ]);
    await Reflect.apply(setup.revoke, setup, [
      manager.actor,
      site,
      cp.id,
      'contractor',
      manager.context,
    ]);
    assert.equal(
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      ),
      initial + 4,
    );
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [managerId]);
    await assert.rejects(
      Reflect.apply(setup.grantContractor, setup, [
        manager.actor,
        site,
        { ...contractorInput, requestId: randomUUID() },
        manager.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
  } finally {
    await owned.dispose();
  }
});
