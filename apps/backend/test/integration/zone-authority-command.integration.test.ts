import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import {
  SiteEntity,
  ZoneRestrictionPolicy,
  ZoneType,
  ContractorEntity,
  WorkerEntity,
  ContractorSiteParticipationEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ContractorZoneAccessGrantEntity,
  ZoneAccessGrantEntity,
  ZoneAccessEffect,
  UserEntity,
} from '../../src/database/entities/index.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { executeZoneAuthorityCommand } from '../../src/modules/zones/zone-authority-history.js';
async function isolated(run: (db: DataSource) => Promise<void>) {
  const schema = `authority_command_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const control = new DataSource(options);
  const db = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  await control.initialize();
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    await db.initialize();
    await db.runMigrations();
    await run(db);
  } finally {
    if (db.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.destroy();
  }
}

async function site(db: DataSource) {
  const id = randomUUID();
  await db.getRepository(SiteEntity).insert({ id, code: id, name: 'Synthetic authority Site' });
  return id;
}

test('Zone create and policy update atomically persist matching history without enabling authority', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(siteId, {
      code: 'TEST',
      name: 'Synthetic Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
    });
    await zones.updatePolicy(siteId, zone.id, {
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      requiredPpe: ['HARD_HAT'],
    });
    const rows = await db.query(
      'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
      [zone.id],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r: { revision: string }) => r.revision),
      ['1', '2'],
    );
    assert.equal(rows[0].payload.restrictionPolicy, 'AUTHORIZATION_REQUIRED');
    assert.equal(rows[1].payload.restrictionPolicy, 'PROHIBITED_FOR_ALL');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 2);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
      0,
    );
    await db.query('UPDATE zone SET configuration_locked=true WHERE id=$1', [zone.id]);
    await assert.rejects(
      zones.updatePolicy(siteId, zone.id, {
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
        requiredPpe: [],
      }),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 2);
  });
});

test('same command replay returns persisted facts, conflict changes roll back and projection failure leaves no audit', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const input = {
      commandId: randomUUID(),
      operation: 'SYNTHETIC_ZONE_CREATE',
      actor: { kind: 'SERVICE', subject: 'synthetic-test' },
      request: { siteId, code: 'TEST' },
    };
    let mutations = 0;
    const zoneId = randomUUID();
    const write = async (manager: DataSource['manager']) => {
      mutations++;
      await manager.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES ($1,$2,'TEST','Synthetic Zone','RESTRICTED','NONE')",
        [zoneId, siteId],
      );
      return [
        {
          sourceKind: 'ZONE_POLICY',
          sourceId: zoneId,
          siteId,
          effectiveFrom: new Date('2026-10-04T08:00:00Z'),
          effectiveTo: null,
          payload: { zoneId, siteId, restrictionPolicy: 'NONE' },
        },
      ];
    };
    const first = await executeZoneAuthorityCommand(db, input, write);
    const replay = await executeZoneAuthorityCommand(db, input, write);
    assert.equal(mutations, 1);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.facts, first.facts);
    await assert.rejects(
      executeZoneAuthorityCommand(db, { ...input, request: { siteId, code: 'CHANGED' } }, write),
    );
    await assert.rejects(
      executeZoneAuthorityCommand(
        db,
        { ...input, actor: { kind: 'SERVICE', subject: 'another-service' } },
        write,
      ),
    );
    await assert.rejects(
      executeZoneAuthorityCommand(
        db,
        { ...input, commandId: randomUUID() },
        async (manager: DataSource['manager']) => {
          await manager.query('UPDATE zone SET restriction_policy=$1 WHERE id=$2', [
            'PROHIBITED_FOR_ALL',
            zoneId,
          ]);
          throw new Error('synthetic projection failure');
        },
      ),
    );
    assert.equal(
      (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [zoneId]))[0]
        .restriction_policy,
      'NONE',
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 1);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_fact_revision'))[0].n,
      1,
    );
  });
});

test('history writer refuses a fabricated payload and rolls back the projection', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zoneId = randomUUID();
    await assert.rejects(
      executeZoneAuthorityCommand(
        db,
        {
          commandId: randomUUID(),
          operation: 'TEST',
          actor: { kind: 'SERVICE', subject: 'synthetic-test' },
          request: { siteId },
        },
        async (manager: DataSource['manager']) => {
          await manager.query(
            "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES ($1,$2,'TEST','Synthetic Zone','RESTRICTED','NONE')",
            [zoneId, siteId],
          );
          return [
            {
              sourceKind: 'ZONE_POLICY',
              sourceId: zoneId,
              siteId,
              effectiveFrom: new Date('2026-10-04T08:00:00Z'),
              effectiveTo: null,
              payload: { zoneId, siteId, restrictionPolicy: 'PROHIBITED_FOR_ALL' },
            },
          ];
        },
      ),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone'))[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 0);
  });
});

test('concurrent same-command requests commit one projection and replay one immutable result', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zoneId = randomUUID();
    const input = {
      commandId: randomUUID(),
      operation: 'ZONE_CREATE_TEST',
      actor: { kind: 'SERVICE', subject: 'synthetic-test' },
      request: { siteId, zoneId },
    };
    let calls = 0;
    const write = async (manager: DataSource['manager']) => {
      calls++;
      await manager.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES ($1,$2,'TEST','Synthetic','RESTRICTED','NONE')",
        [zoneId, siteId],
      );
      return [
        {
          sourceKind: 'ZONE_POLICY',
          sourceId: zoneId,
          siteId,
          effectiveFrom: new Date(),
          effectiveTo: null,
          payload: { zoneId, siteId, restrictionPolicy: 'NONE' },
        },
      ];
    };
    const results = await Promise.all([
      executeZoneAuthorityCommand(db, input, write),
      executeZoneAuthorityCommand(db, input, write),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
    assert.deepEqual(results[0]!.facts, results[1]!.facts);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 1);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_fact_revision'))[0].n,
      1,
    );
  });
});

test('concurrent policy writers preserve sequential bigint revisions and the committed final projection', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(siteId, {
      code: 'TEST',
      name: 'Synthetic Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    await Promise.all(
      [ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED, ZoneRestrictionPolicy.PROHIBITED_FOR_ALL].map(
        (restrictionPolicy) =>
          zones.updatePolicy(siteId, zone.id, {
            type: ZoneType.RESTRICTED,
            restrictionPolicy,
            requiredPpe: [],
          }),
      ),
    );
    const rows = await db.query(
      'SELECT revision,payload FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision',
      [zone.id],
    );
    assert.deepEqual(
      rows.map((r: { revision: string }) => r.revision),
      ['1', '2', '3'],
    );
    assert.equal(
      (await zones.get(siteId, zone.id)).restrictionPolicy,
      rows[2].payload.restrictionPolicy,
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 3);
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
      0,
    );
  });
});

test('USER attribution checks active account in the transaction and cannot be spoofed on replay', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const userId = randomUUID();
    await db.getRepository(UserEntity).insert({
      id: userId,
      username: userId,
      displayName: 'Synthetic',
      passwordHash: 'synthetic-not-a-login',
      isActive: true,
      mustChangePassword: false,
    });
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(
      siteId,
      {
        code: 'USER-ZONE',
        name: 'Synthetic Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
        requiredPpe: [],
      },
      { kind: 'USER', userId },
    );
    const commands = await db.query(
      'SELECT actor_kind,actor_user_id,service_subject FROM zone_authority_command',
    );
    assert.deepEqual(commands, [
      { actor_kind: 'USER', actor_user_id: userId, service_subject: null },
    ]);
    await db.getRepository(UserEntity).update(userId, { isActive: false });
    await assert.rejects(
      zones.updatePolicy(
        siteId,
        zone.id,
        {
          type: ZoneType.RESTRICTED,
          restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
          requiredPpe: [],
        },
        { kind: 'USER', userId },
      ),
    );
    assert.equal((await zones.get(siteId, zone.id)).restrictionPolicy, ZoneRestrictionPolicy.NONE);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 1);
  });
});

test('uppercase UUID inputs still match PostgreSQL normalized authority scope', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(siteId.toUpperCase(), {
      code: 'UPPER',
      name: 'Synthetic',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    const facts = await db.query(
      'SELECT site_id,payload FROM zone_authority_fact_revision WHERE source_id=$1',
      [zone.id],
    );
    assert.equal(facts[0].site_id, siteId);
    assert.equal(facts[0].payload.siteId, siteId);
  });
});

test('revision allocation preserves PostgreSQL bigint values beyond the JavaScript safe integer range', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(siteId, {
      code: 'TEST',
      name: 'Synthetic',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    // Synthetic long-running history; never cast this bigint to Number.
    await db.query(
      `INSERT INTO zone_authority_fact_revision(id,command_id,source_kind,source_id,site_id,revision,effective_from,effective_to,payload)
      SELECT $1,command_id,source_kind,source_id,site_id,$2::bigint,effective_from,effective_to,payload
      FROM zone_authority_fact_revision WHERE source_id=$3 AND revision=1`,
      [randomUUID(), '9007199254740993', zone.id],
    );
    await zones.updatePolicy(siteId, zone.id, {
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
      requiredPpe: [],
    });
    const rows = await db.query(
      'SELECT revision FROM zone_authority_fact_revision WHERE source_id=$1 ORDER BY revision DESC LIMIT 1',
      [zone.id],
    );
    assert.equal(rows[0].revision, '9007199254740994');
  });
});

test('all seven typed sources are verified against actual projections; legacy anchors remain null', async () => {
  await isolated(async (db) => {
    const siteId = await site(db);
    const contractorId = randomUUID(),
      workerId = randomUUID(),
      zoneId = randomUUID(),
      userId = randomUUID();
    const participationId = randomUUID(),
      assignmentId = randomUUID(),
      contractorGrantId = randomUUID(),
      workerGrantId = randomUUID();
    const from = new Date('2026-10-04T08:00:00Z'),
      until = new Date('2026-10-05T08:00:00Z');
    await db.getRepository(UserEntity).insert({
      id: userId,
      username: userId,
      displayName: 'Synthetic',
      passwordHash: 'synthetic-not-a-login',
    });
    await db
      .getRepository(ContractorEntity)
      .insert({ id: contractorId, code: contractorId, name: 'Synthetic', isActive: true });
    await db.getRepository(WorkerEntity).insert({
      id: workerId,
      siteId,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic',
      isActive: true,
    });
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES ($1,$2,'TEST','Synthetic','RESTRICTED','AUTHORIZATION_REQUIRED')",
      [zoneId, siteId],
    );
    await db.getRepository(ContractorSiteParticipationEntity).insert({
      id: participationId,
      siteId,
      contractorId,
      validFrom: from,
      validUntil: until,
      isActive: true,
    });
    await db.getRepository(WorkerSiteZoneAssignmentEntity).insert({
      id: assignmentId,
      siteId,
      workerId,
      contractorId: null,
      zoneIds: [zoneId],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: from,
      validUntil: until,
      requestedByUserId: userId,
    });
    await db.getRepository(ContractorZoneAccessGrantEntity).insert({
      id: contractorGrantId,
      siteId,
      zoneId,
      contractorId,
      effect: ZoneAccessEffect.ALLOW,
      validFrom: from,
      validUntil: until,
      revokedAt: null,
    });
    await db.getRepository(ZoneAccessGrantEntity).insert({
      id: workerGrantId,
      siteId,
      zoneId,
      workerId,
      contractorId: null,
      effect: ZoneAccessEffect.DENY,
      validFrom: from,
      validUntil: until,
      revokedAt: null,
    });
    const interval = { validFrom: from.toISOString(), validUntil: until.toISOString() };
    const facts = [
      {
        sourceKind: 'CONTRACTOR_STATE',
        sourceId: contractorId,
        siteId: null,
        payload: { contractorId, isActive: true },
      },
      {
        sourceKind: 'WORKER_MEMBERSHIP',
        sourceId: workerId,
        siteId,
        payload: { workerId, siteId, contractorId, isActive: true },
      },
      {
        sourceKind: 'PARTICIPATION',
        sourceId: participationId,
        siteId,
        payload: { participationId, siteId, contractorId, ...interval, isActive: true },
      },
      {
        sourceKind: 'ASSIGNMENT',
        sourceId: assignmentId,
        siteId,
        payload: {
          assignmentId,
          workerId,
          siteId,
          contractorId: null,
          zoneIds: [zoneId],
          status: 'APPROVED',
          ...interval,
        },
      },
      {
        sourceKind: 'CONTRACTOR_ZONE_GRANT',
        sourceId: contractorGrantId,
        siteId,
        payload: {
          grantId: contractorGrantId,
          siteId,
          zoneId,
          contractorId,
          effect: 'ALLOW',
          ...interval,
          revokedAt: null,
        },
      },
      {
        sourceKind: 'WORKER_ZONE_GRANT',
        sourceId: workerGrantId,
        siteId,
        payload: {
          grantId: workerGrantId,
          workerId,
          siteId,
          zoneId,
          contractorId: null,
          effect: 'DENY',
          ...interval,
          revokedAt: null,
        },
      },
      {
        sourceKind: 'ZONE_POLICY',
        sourceId: zoneId,
        siteId,
        payload: { zoneId, siteId, restrictionPolicy: 'AUTHORIZATION_REQUIRED' },
      },
    ].map((f) => ({ ...f, effectiveFrom: from, effectiveTo: null }));
    const result = await executeZoneAuthorityCommand(
      db,
      {
        commandId: randomUUID(),
        operation: 'SYNTHETIC_SOURCES',
        actor: { kind: 'SERVICE', subject: 'synthetic-test' },
        request: { siteId },
      },
      async () => facts,
    );
    assert.equal(result.facts.length, 7);
    assert.ok(result.facts.every((f) => f.revision === '1'));
    const legacy = result.facts.filter((f) =>
      ['ASSIGNMENT', 'WORKER_ZONE_GRANT'].includes(f.sourceKind),
    );
    assert.ok(legacy.every((f) => f.payload.contractorId === null));
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM zone_authority_history_epoch'))[0].n,
      0,
    );
    await assert.rejects(
      executeZoneAuthorityCommand(
        db,
        {
          commandId: randomUUID(),
          operation: 'FABRICATED_OWNER',
          actor: { kind: 'SERVICE', subject: 'synthetic-test' },
          request: { siteId },
        },
        async () => [{ ...facts[3]!, payload: { ...facts[3]!.payload, contractorId } }],
      ),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM zone_authority_command'))[0].n, 1);
  });
});
