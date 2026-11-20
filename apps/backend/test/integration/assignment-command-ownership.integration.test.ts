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
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('Worker assignment lifecycle rechecks original bearer and live scoped role while preserving versions', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      managerId = randomUUID(),
      repId = randomUUID(),
      officerId = randomUUID(),
      worker = randomUUID(),
      zone = randomUUID();
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
    for (const [id, role] of [
      [managerId, 'SITE_MANAGER'],
      [repId, 'CONTRACTOR_REPRESENTATIVE'],
      [officerId, 'SAFETY_OFFICER'],
    ]) {
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Actor',$2)",
        [id, hash],
      );
      await db.query(
        'INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)',
        [randomUUID(), id, site, role],
      );
    }
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), repId, contractor],
    );
    await db.query(
      'INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), site, contractor, from, until],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
      [zone, site],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth),
      operations = new ContractorOperationsService(db);
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
    const rep = await actorFor(repId),
      officer = await actorFor(officerId),
      manager = await actorFor(managerId),
      deadRep = await actorFor(repId),
      deadOfficer = await actorFor(officerId),
      deadManager = await actorFor(managerId);
    await db.query(
      'UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[])',
      [[deadRep.request.sessionId, deadOfficer.request.sessionId, deadManager.request.sessionId]],
    );
    const input = {
      siteId: site,
      zoneIds: [zone],
      validFrom: from.toISOString(),
      validUntil: until.toISOString(),
    };
    await assert.rejects(
      Reflect.apply(operations.requestAssignment, operations, [
        deadRep.actor,
        worker,
        input,
        deadRep.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    const assignment = await Reflect.apply(operations.requestAssignment, operations, [
      rep.actor,
      worker,
      input,
      rep.context,
    ]);
    await assert.rejects(
      Reflect.apply(operations.safetyReview, operations, [
        deadOfficer.actor,
        assignment.id,
        deadOfficer.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [officerId]);
    await assert.rejects(
      Reflect.apply(operations.safetyReview, operations, [
        officer.actor,
        assignment.id,
        officer.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query("UPDATE user_role_assignment SET role='SAFETY_OFFICER' WHERE user_id=$1", [
      officerId,
    ]);
    const reviewed = await Reflect.apply(operations.safetyReview, operations, [
      officer.actor,
      assignment.id,
      officer.context,
    ]);
    assert.equal(reviewed.version, 2);
    await assert.rejects(
      Reflect.apply(operations.siteManagerDecision, operations, [
        deadManager.actor,
        assignment.id,
        { approve: true, expectedVersion: 2 },
        deadManager.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    const approved = await Reflect.apply(operations.siteManagerDecision, operations, [
      manager.actor,
      assignment.id,
      { approve: true, expectedVersion: 2 },
      manager.context,
    ]);
    assert.equal(approved.version, 3);
    const revoke = { expectedVersion: 3, reviewNote: 'Synthetic revoke' };
    await assert.rejects(
      Reflect.apply(operations.revokeAssignment, operations, [
        deadManager.actor,
        assignment.id,
        revoke,
        deadManager.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    const revoked = await Reflect.apply(operations.revokeAssignment, operations, [
      manager.actor,
      assignment.id,
      revoke,
      manager.context,
    ]);
    assert.equal(revoked.status, 'REVOKED');
    assert.equal(revoked.version, 4);
    const repeated = await Reflect.apply(operations.revokeAssignment, operations, [
      manager.actor,
      assignment.id,
      revoke,
      manager.context,
    ]);
    assert.equal(repeated.version, 4);
  } finally {
    await owned.dispose();
  }
});
