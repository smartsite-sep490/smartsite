import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { MainRepresentativeCommandService } from '../../src/modules/workforce/main-representative-command.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { Legacy24TestDataSource } from '../support/legacy24/data-source.js';

const canonical = createIsolatedTestDatabase();
const legacy = createIsolatedTestDatabase({ legacy: true });
test('legacy linked Worker creation uses only its transaction connection in a one-slot pool', async () => {
  const f = await fixture(legacy.dataSource);
  await legacy.dataSource.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [
    f.target,
  ]);
  const single = new Legacy24TestDataSource({
    ...legacy.dataSource.options,
    extra: { ...legacy.dataSource.options.extra, max: 1, connectionTimeoutMillis: 250 },
  });
  try {
    await single.initialize();
    const worker = await new WorkforceConfigurationService(single).create(f.site, {
      externalId: randomUUID(),
      displayName: 'Synthetic linked Worker',
      contractorId: f.contractor,
      userId: f.target,
    });
    assert.equal(worker.userId, f.target);
    assert.equal(worker.contractorId, f.contractor);
  } finally {
    if (single.isInitialized) await single.destroy();
  }
});
before(async () => {
  await canonical.initialize();
  await legacy.initialize();
});
after(async () => {
  await canonical.dispose();
  await legacy.dispose();
});

async function fixture(db: DataSource, role = 'ADMIN') {
  const f = {
    actor: randomUUID(),
    target: randomUUID(),
    site: randomUUID(),
    contractor: randomUUID(),
    worker: randomUUID(),
    zone: randomUUID(),
    participation: randomUUID(),
  };
  for (const id of [f.actor, f.target])
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic User','SYNTHETIC_NOT_A_PASSWORD',true,false)",
      [id],
    );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    f.site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',NULL,true)",
    [f.participation, f.contractor, f.site],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$6,$7),($3,$4,'CONTRACTOR_REPRESENTATIVE',$5)",
    [randomUUID(), f.actor, randomUUID(), f.target, f.site, role, role === 'ADMIN' ? null : f.site],
  );
  const actor: WorkforceActor = {
    id: f.actor,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  return { ...f, actorContext: actor };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const calls = [
  [
    'roster forAccount',
    (db: DataSource, f: Fixture) =>
      new WorkforceConfigurationService(db).forAccount(f.site, { userId: f.target }),
  ],
  [
    'roster linkAccount',
    (db: DataSource, f: Fixture) =>
      new WorkforceConfigurationService(db).linkAccount(f.site, f.worker, { userId: f.target }),
  ],
  [
    'roster create',
    (db: DataSource, f: Fixture) =>
      new WorkforceConfigurationService(db).create(f.site, {
        externalId: randomUUID(),
        displayName: 'Synthetic Worker',
      }),
  ],
  [
    'site contractor create',
    (db: DataSource, f: Fixture) =>
      new WorkforceConfigurationService(db).createContractor(f.site, {
        code: 'C_' + randomUUID().replaceAll('-', '').toUpperCase(),
        name: 'Synthetic Contractor',
      }),
  ],
  [
    'representative assignment',
    (db: DataSource, f: Fixture) =>
      new WorkforceConfigurationService(db).assignRepresentative(f.site, f.contractor, {
        userId: f.target,
      }),
  ],
  [
    'contractor create',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).createContractor(f.actorContext, {
        code: 'C_' + randomUUID().replaceAll('-', '').toUpperCase(),
        name: 'Synthetic Contractor',
      }),
  ],
  [
    'participation create',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).createParticipation(f.actorContext, f.contractor, {
        siteId: f.site,
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: null,
      }),
  ],
  [
    'representative grant',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).grantRepresentative(f.actorContext, f.contractor, {
        userId: f.target,
      }),
  ],
  [
    'contractor worker create',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).createWorker(f.actorContext, f.contractor, {
        siteId: f.site,
        externalId: randomUUID(),
        displayName: 'Synthetic Worker',
      }),
  ],
  [
    'assignment request',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).requestAssignment(f.actorContext, f.worker, {
        siteId: f.site,
        zoneIds: [f.zone],
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: '2026-11-01T00:00:00Z',
      }),
  ],
  [
    'assignment safety review',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).safetyReview(f.actorContext, f.worker),
  ],
  [
    'assignment revoke',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).revokeAssignment(f.actorContext, f.worker, {
        expectedVersion: 1,
        reviewNote: 'Synthetic revoke',
      }),
  ],
  [
    'assignment decision',
    (db: DataSource, f: Fixture) =>
      new ContractorOperationsService(db).siteManagerDecision(f.actorContext, f.worker, {
        approve: true,
      }),
  ],
] as const;
const unavailable = (error: unknown) =>
  error instanceof PublicHttpException &&
  error.getStatus() === 503 &&
  (error.getResponse() as { code?: string }).code === 'SERVICE_UNAVAILABLE';
async function counts(db: DataSource) {
  return (
    await db.query(`SELECT (SELECT count(*)::int FROM contractor_representative_grant) AS grants,
  (SELECT count(*)::int FROM contractor_representative_assignment) AS assignments,
  (SELECT count(*)::int FROM worker) AS workers,(SELECT count(*)::int FROM contractor) AS contractors,
  (SELECT count(*)::int FROM contractor_site_participation) AS participations,
  (SELECT count(*)::int FROM worker_site_zone_assignment) AS allocations,
  (SELECT count(*)::int FROM mf06_authority_command) AS commands,(SELECT count(*)::int FROM mf06_authority_fact) AS facts,
  (SELECT count(*)::int FROM mf06_authority_gap) AS gaps,(SELECT count(*)::int FROM mf06_authority_commit_witness) AS witnesses`)
  )[0];
}
for (const [name, call] of calls)
  test(`canonical MAIN refuses legacy ${name} before business/journal mutation`, async () => {
    const db = canonical.dataSource,
      f = await fixture(db),
      before = await counts(db);
    await assert.rejects(call(db, f), unavailable);
    assert.deepEqual(await counts(db), before);
  });

const relations = [
  'mf06_authority_source',
  'mf06_authority_command',
  'mf06_authority_epoch',
  'mf06_authority_control',
  'mf06_authority_head',
  'mf06_authority_fact',
  'mf06_authority_gap',
  'mf06_authority_commit_witness',
  'mf06_authority_baseline',
  'mf06_assignment_command_result',
  'mf06_participation_command_result',
  'mf06_zone_permission_command_result',
  'mf06_zone_deny_command_result',
] as const;
for (const relation of relations)
  test(`partial MAIN ${relation} refuses both raw legacy representative writers and legacy journal writer`, async () => {
    const db = legacy.dataSource,
      f = await fixture(db);
    await db.query(`CREATE TABLE ${relation}(id uuid)`);
    try {
      await assert.rejects(
        new WorkforceConfigurationService(db).assignRepresentative(f.site, f.contractor, {
          userId: f.target,
        }),
        unavailable,
      );
      await assert.rejects(
        new ContractorOperationsService(db).grantRepresentative(f.actorContext, f.contractor, {
          userId: f.target,
        }),
        unavailable,
      );
      await assert.rejects(
        new WorkforceConfigurationService(db).create(f.site, {
          externalId: randomUUID(),
          displayName: 'Synthetic Worker',
        }),
        unavailable,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM contractor_representative_grant WHERE contractor_id=$1',
            [f.contractor],
          )
        )[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM contractor_representative_assignment WHERE contractor_id=$1',
            [f.contractor],
          )
        )[0].n,
        0,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM worker WHERE site_id=$1', [f.site]))[0].n,
        0,
      );
    } finally {
      await db.query(`DROP TABLE ${relation}`);
    }
  });

for (const kind of ['GRANT', 'ASSIGN'] as const)
  test(`legacy ${kind} compatibility retains existing behavior while another MAIN schema exists`, async () => {
    const db = legacy.dataSource,
      f = await fixture(db);
    const result =
      kind === 'GRANT'
        ? await new ContractorOperationsService(db).grantRepresentative(
            f.actorContext,
            f.contractor,
            { userId: f.target },
          )
        : await new WorkforceConfigurationService(db).assignRepresentative(f.site, f.contractor, {
            userId: f.target,
          });
    assert.equal(result!.contractorId, f.contractor);
    assert.equal(result!.userId, f.target);
  });

for (const kind of ['GRANT', 'ASSIGN'] as const)
  test(`canonical authenticated replacement ${kind} retains exact actor/fact/witness attribution`, async () => {
    const db = canonical.dataSource,
      f = await fixture(db, kind === 'GRANT' ? 'ADMIN' : 'SITE_MANAGER'),
      service = new MainRepresentativeCommandService(db);
    const context = { actorUserId: f.actor, reauthorize: async () => {} };
    if (kind === 'ASSIGN')
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
        [randomUUID(), f.actor, f.site],
      );
    const result =
      kind === 'GRANT'
        ? await service.grant(f.contractor, { userId: f.target }, context)
        : await service.assign(f.site, f.contractor, { userId: f.target }, context);
    assert.equal(result!.contractorId, f.contractor);
    assert.equal(result!.userId, f.target);
    const rows = await db.query(
      `SELECT c.actor_user_id,c.operation,f.source_kind,f.source_id,w.transaction_id=c.transaction_id AS witnessed
  FROM mf06_authority_command c JOIN mf06_authority_fact f USING(command_id) JOIN mf06_authority_commit_witness w USING(command_id)
  WHERE f.source_id=$1`,
      [result!.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_user_id, f.actor);
    assert.equal(rows[0].witnessed, true);
    assert.equal(
      rows[0].operation,
      kind === 'GRANT' ? 'MAIN_REPRESENTATIVE_GRANT' : 'MAIN_REPRESENTATIVE_ASSIGN',
    );
  });
