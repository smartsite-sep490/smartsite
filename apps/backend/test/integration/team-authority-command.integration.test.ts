import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Team writes preserve exact retries and enforce current authority in the transaction', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      actorId = randomUUID(),
      sessionId = randomUUID(),
      assignment = randomUUID(),
      participation = randomUUID(),
      worker = randomUUID(),
      zone = randomUUID(),
      parentPermission = randomUUID();
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
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
      [randomUUID(), actorId, site],
    );
    const addAssignment = () =>
      db.query(
        'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
        [assignment, actorId, site, contractor],
      );
    await addAssignment();
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from) VALUES($1,$2,$3,'2020-01-01T00:00:00Z')",
      [participation, contractor, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
      [zone, site],
    );
    await db.query(
      "INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2099-01-01T00:00:00Z',$4)",
      [parentPermission, participation, zone, actorId],
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
    const service = new ContractorTeamsService(db);
    const team = { requestId: randomUUID(), name: 'Synthetic Team' };
    const membership = {
      requestId: randomUUID(),
      expectedMembershipId: null,
      teamId: team.requestId,
    };
    const permission = {
      requestId: randomUUID(),
      contractorZonePermissionId: parentPermission,
      startDate: '2040-01-01',
      endDate: '2040-01-02',
      timezone: 'UTC',
    };
    const replacement = { ...permission, requestId: randomUUID() };
    const create = (input = team) =>
      Reflect.apply(service.create, service, [
        actor,
        site,
        contractor,
        input,
        context,
      ]) as ReturnType<ContractorTeamsService['create']>;
    const assign = () =>
      Reflect.apply(service.assign, service, [
        actor,
        site,
        contractor,
        worker,
        membership,
        context,
      ]) as ReturnType<ContractorTeamsService['assign']>;
    const revoke = () =>
      Reflect.apply(service.revokeZone, service, [
        actor,
        site,
        contractor,
        team.requestId,
        replacement.requestId,
        context,
      ]);
    const snapshot = async () => [
      await db.query('SELECT * FROM contractor_team ORDER BY id'),
      await db.query('SELECT * FROM contractor_team_membership ORDER BY id'),
      await db.query('SELECT * FROM team_zone_permission ORDER BY id'),
      await db.query('SELECT * FROM audit_log ORDER BY id'),
    ];
    const rejectUnchanged = async (work: () => Promise<unknown>, status: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === status,
      );
      assert.deepEqual(await snapshot(), before);
    };

    await t.test(
      'concurrent exact create returns one Team and writes one business audit',
      async () => {
        const [first, second] = await Promise.all([create(), create()]);
        assert.equal(first.id, team.requestId);
        assert.equal(second.id, team.requestId);
        assert.equal(first.version, 1);
        assert.equal(second.version, 1);
        assert.equal(
          (await db.query('SELECT id FROM contractor_team WHERE id=$1', [team.requestId])).length,
          1,
        );
        assert.equal(
          (
            await db.query(
              "SELECT id FROM audit_log WHERE entity_id=$1 AND action='CONTRACTOR_TEAM_CREATED'",
              [team.requestId],
            )
          ).length,
          1,
        );
      },
    );

    await t.test(
      'authorized membership and Zone changes persist and exact revoke replay stays inert',
      async () => {
        const assigned = await assign();
        assert.equal(assigned.membershipId, membership.requestId);
        assert.equal(assigned.teamId, team.requestId);
        const granted = await Reflect.apply(service.grantZone, service, [
          actor,
          site,
          contractor,
          team.requestId,
          permission,
          undefined,
          context,
        ]);
        assert.equal(granted.id, permission.requestId);
        const replaced = await service.grantZone(
          actor,
          site,
          contractor,
          team.requestId,
          replacement,
          permission.requestId,
          context,
        );
        assert.equal(replaced.id, replacement.requestId);
        assert.ok(
          (
            await db.query('SELECT revoked_at FROM team_zone_permission WHERE id=$1', [
              permission.requestId,
            ])
          )[0].revoked_at,
        );
        await revoke();
        const before = await snapshot();
        assert.deepEqual(await revoke(), { id: replacement.requestId });
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      'revoked original bearer blocks create, membership and Zone revoke replays',
      async () => {
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          sessionId,
        ]);
        try {
          await rejectUnchanged(create, 401);
          await rejectUnchanged(assign, 401);
          await rejectUnchanged(revoke, 401);
        } finally {
          await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [sessionId]);
        }
      },
    );

    await t.test(
      'removed Contractor assignment blocks a write with a still-valid bearer and CR role',
      async () => {
        await db.query('DELETE FROM contractor_representative_assignment WHERE id=$1', [
          assignment,
        ]);
        try {
          await rejectUnchanged(
            () => create({ requestId: randomUUID(), name: 'Unauthorized Team' }),
            403,
          );
        } finally {
          await addAssignment();
        }
      },
    );

    await t.test(
      'partial journal blocks authority changes while scoped metadata can still be saved',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(
          () => create({ requestId: randomUUID(), name: 'Unavailable Team' }),
          503,
        );
        const updated = await Reflect.apply(service.update, service, [
          actor,
          site,
          contractor,
          team.requestId,
          { expectedVersion: 1, name: 'Renamed Team', description: 'Synthetic metadata' },
          context,
        ]);
        assert.equal(updated.id, team.requestId);
        assert.equal(updated.name, 'Renamed Team');
        assert.equal(updated.version, 2);
        await db.query('DROP TABLE authorization_history_baseline');
      },
    );
    await t.test(
      'archive requires an empty Team and retry leaves its business audit unchanged',
      async () => {
        const input = { expectedVersion: 2, reason: 'Synthetic archive' };
        const archive = () =>
          service.archive(actor, site, contractor, team.requestId, input, context);
        await rejectUnchanged(archive, 409);
        const removed = await service.assign(
          actor,
          site,
          contractor,
          worker,
          {
            requestId: randomUUID(),
            expectedMembershipId: membership.requestId,
            teamId: null,
            reason: 'Synthetic removal',
          },
          context,
        );
        assert.equal(removed.membershipId, null);
        assert.equal((await archive()).version, 3);
        const before = await snapshot();
        assert.equal((await archive()).version, 3);
        assert.deepEqual(await snapshot(), before);
      },
    );
  } finally {
    await owned.dispose();
  }
});
