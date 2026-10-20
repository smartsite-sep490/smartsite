import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../src/database/entities/index.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { ContractorTeamsController } from '../../src/modules/workforce/teams/contractor-teams.controller.js';
import { createTestConfig } from '../support/config.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedTeamSessionSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

test('Team controller rejects an actually logged-out bearer after its early guard without Team/audit/history changes', async () => {
  const f = await fixture();
  const password = 'Synthetic-Team-Session-123!';
  await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
    f.actorId,
    await hashPassword(password),
  ]);
  const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
  const guard = new UserAuthGuard(auth);
  const controller = new ContractorTeamsController(f.service, guard);
  const login = await auth.login(f.actorId, password, AuthClientType.WEB);
  const request: AuthenticatedRequest = {
    headers: { authorization: `Bearer ${login.accessToken}` },
  };
  await guard.authenticateRequest(request);
  const teamId = randomUUID();
  await controller.create(request, f.siteId, f.contractorId, {
    requestId: teamId,
    name: 'Before logout',
    description: '',
  });
  await controller.update(request, f.siteId, f.contractorId, teamId, {
    expectedVersion: 1,
    name: 'Valid rename',
    description: '',
  });
  const audits = await db.query(
    'SELECT action FROM audit_log WHERE site_id=$1 AND actor_account_id=$2 ORDER BY action',
    [f.siteId, f.actorId],
  );
  assert.deepEqual(
    audits.map((row: { action: string }) => row.action),
    ['CONTRACTOR_TEAM_CREATED', 'CONTRACTOR_TEAM_UPDATED'],
  );
  const before = {
    teams: await db.query(
      'SELECT id,name,version FROM contractor_team WHERE site_id=$1 ORDER BY id',
      [f.siteId],
    ),
    audits,
    history: await db.query(
      'SELECT command_id,operation FROM authorization_history_command WHERE actor_user_id=$1 ORDER BY command_id',
      [f.actorId],
    ),
  };
  assert.equal(before.history.length, 1, 'Name-only update must not invent authority history');
  // The request deliberately retains the valid early-guard user and original bearer.
  await auth.logout(login.refreshToken, AuthClientType.WEB);
  assert.equal(
    (
      await db.query('SELECT revoked_at IS NOT NULL AS revoked FROM auth_session WHERE id=$1', [
        request.sessionId,
      ])
    )[0].revoked,
    true,
  );
  const unauthorized = (error: { getStatus?: () => number }) => error.getStatus?.() === 401;
  await assert.rejects(
    controller.create(request, f.siteId, f.contractorId, {
      requestId: randomUUID(),
      name: 'After logout',
      description: '',
    }),
    unauthorized,
  );
  await assert.rejects(
    controller.update(request, f.siteId, f.contractorId, teamId, {
      expectedVersion: 2,
      name: 'Forbidden rename',
      description: '',
    }),
    unauthorized,
  );
  assert.deepEqual(
    await db.query('SELECT id,name,version FROM contractor_team WHERE site_id=$1 ORDER BY id', [
      f.siteId,
    ]),
    before.teams,
  );
  assert.deepEqual(
    await db.query(
      'SELECT action FROM audit_log WHERE site_id=$1 AND actor_account_id=$2 ORDER BY action',
      [f.siteId, f.actorId],
    ),
    before.audits,
  );
  assert.deepEqual(
    await db.query(
      'SELECT command_id,operation FROM authorization_history_command WHERE actor_user_id=$1 ORDER BY command_id',
      [f.actorId],
    ),
    before.history,
  );
});

async function fixture() {
  const actorId = randomUUID(),
    siteId = randomUUID(),
    contractorId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic representative','not-a-password',true,false)",
    [actorId],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [contractorId],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
    [randomUUID(), actorId, siteId],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), actorId, contractorId],
  );
  await db
    .getRepository(ContractorRepresentativeAssignmentEntity)
    .save({ id: randomUUID(), userId: actorId, siteId, contractorId });
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,is_active,valid_from,valid_until) VALUES($1,$2,$3,true,clock_timestamp()-interval '1 day',NULL)",
    [randomUUID(), contractorId, siteId],
  );
  const actor = {
    id: actorId,
    username: actorId,
    displayName: 'Synthetic representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
  return { actorId, siteId, contractorId, actor, service: new ContractorTeamsService(db) };
}

for (const operation of ['create', 'update'] as const) {
  test(`Team ${operation} reauthorizes inside the write transaction and rolls back on revoked session`, async () => {
    const f = await fixture();
    const teamId = randomUUID();
    if (operation === 'update')
      await f.service.create(f.actor, f.siteId, f.contractorId, {
        requestId: teamId,
        name: 'Original',
        description: '',
      });
    const before = await db.query(
      'SELECT id,name,version FROM contractor_team WHERE site_id=$1 ORDER BY id',
      [f.siteId],
    );
    const commandCount = (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
        [f.actorId],
      )
    )[0].n;
    let calls = 0;
    const context = {
      actorUserId: f.actorId,
      reauthorize: async (manager: typeof db.manager) => {
        calls++;
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        throw new UnauthorizedException();
      },
    };
    const args =
      operation === 'create'
        ? [
            f.actor,
            f.siteId,
            f.contractorId,
            { requestId: teamId, name: 'Original', description: '' },
            context,
          ]
        : [
            f.actor,
            f.siteId,
            f.contractorId,
            teamId,
            { expectedVersion: 1, name: 'Changed', description: '' },
            context,
          ];
    await assert.rejects(
      Reflect.apply(f.service[operation], f.service, args),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 401,
    );
    assert.equal(calls, 1);
    assert.deepEqual(
      await db.query('SELECT id,name,version FROM contractor_team WHERE site_id=$1 ORDER BY id', [
        f.siteId,
      ]),
      before,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
          [f.actorId],
        )
      )[0].n,
      commandCount,
    );
  });
}

test('Team create and name-only update retain valid transactional context without metadata history', async () => {
  const f = await fixture();
  const teamId = randomUUID();
  let calls = 0;
  const context = {
    actorUserId: f.actorId,
    reauthorize: async (manager: typeof db.manager) => {
      assert.equal(manager.queryRunner?.isTransactionActive, true);
      calls++;
    },
  };
  await Reflect.apply(f.service.create, f.service, [
    f.actor,
    f.siteId,
    f.contractorId,
    { requestId: teamId, name: 'Original', description: '' },
    context,
  ]);
  const commands = (
    await db.query(
      'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
      [f.actorId],
    )
  )[0].n;
  const result = await Reflect.apply(f.service.update, f.service, [
    f.actor,
    f.siteId,
    f.contractorId,
    teamId,
    { expectedVersion: 1, name: 'Changed', description: '' },
    context,
  ]);
  assert.equal(result.name, 'Changed');
  assert.equal(calls, 2);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
        [f.actorId],
      )
    )[0].n,
    commands,
  );
});

for (const operation of ['create', 'update'] as const) {
  test(`Team ${operation} rejects a context attributed to a different actor`, async () => {
    const f = await fixture();
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => assert.fail('Mismatched actor cannot reauthorize'),
    };
    const args =
      operation === 'create'
        ? [
            f.actor,
            f.siteId,
            f.contractorId,
            { requestId: randomUUID(), name: 'Denied', description: '' },
            context,
          ]
        : [
            f.actor,
            f.siteId,
            f.contractorId,
            randomUUID(),
            { expectedVersion: 1, name: 'Denied', description: '' },
            context,
          ];
    await assert.rejects(
      Reflect.apply(f.service[operation], f.service, args),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
    );
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM contractor_team WHERE site_id=$1', [
          f.siteId,
        ])
      )[0].n,
      0,
    );
  });
}
