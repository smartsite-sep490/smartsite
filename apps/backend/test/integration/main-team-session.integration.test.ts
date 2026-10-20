import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../src/database/entities/index.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedTeamSessionSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

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
