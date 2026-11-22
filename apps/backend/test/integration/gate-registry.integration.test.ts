import 'reflect-metadata';
import { SecurityBrowserWebcam1795564800000 } from '../../src/database/migrations/1795564800000-SecurityBrowserWebcam.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GateRegistry1795046400001 } from '../../src/database/migrations/1795046400001-GateRegistry.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { GatesService } from '../../src/modules/gates/gates.service.js';
import { requireActiveGate } from '../../src/modules/gates/gate-registry.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraPpePolicyService } from '../../src/modules/cameras/camera-ppe-policy.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { QrAccessService } from '../../src/modules/workforce/access/qr-access.service.js';
import { FaceGateService } from '../../src/modules/workforce/access/face-gate.service.js';
import {
  CameraStatus,
  GateEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  AccessAttemptEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';

test('Gate schema, scope, registered FACE sources and configuration boundaries on clean PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase();
  await owned.initialize();
  const db = owned.dataSource;
  try {
    const sites = [randomUUID(), randomUUID()];
    const managerId = randomUUID(),
      securityId = randomUUID();
    for (const id of sites)
      await db.getRepository(SiteEntity).save({ id, code: id, name: 'Synthetic Site' });
    for (const id of [managerId, securityId])
      await db.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic operator',
        passwordHash: 'synthetic-not-a-login-hash',
        isActive: true,
        mustChangePassword: false,
      });
    for (const siteId of sites)
      await db
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: managerId, role: UserRole.SITE_MANAGER, siteId });
    await db.getRepository(UserRoleAssignmentEntity).save({
      id: randomUUID(),
      userId: securityId,
      role: UserRole.SECURITY_OFFICER,
      siteId: sites[0],
    });
    const context = {
      actorUserId: managerId,
      reauthorize: async () => {
        assert.ok(await db.getRepository(UserEntity).existsBy({ id: managerId, isActive: true }));
      },
    };
    const gates = new GatesService(db);
    const gate = await gates.create(sites[0]!, { code: 'MAIN', name: 'Main gate' }, context);
    const other = await gates.create(sites[1]!, { code: 'MAIN', name: 'Other Site gate' }, context);
    const inactive = await gates.create(sites[0]!, { code: 'OLD', name: 'Closed gate' }, context);
    await gates.update(sites[0]!, inactive.id, { status: 'INACTIVE' }, context);
    await t.test(
      'codes are unique within a Site and public catalog exposes active minimal fields',
      async () => {
        await assert.rejects(gates.create(sites[0]!, { code: 'MAIN', name: 'Duplicate' }, context));
        assert.notEqual(gate.id, other.id);
        await assert.rejects(gates.update(sites[0]!, gate.id, {}, context));
        const catalog = await gates.publicList(sites[0]!);
        assert.deepEqual(
          catalog.items.map((g) => Object.keys(g).sort()),
          [['code', 'id', 'name']],
        );
        assert.equal((await gates.list(sites[0]!, 0, 1, 'INACTIVE')).items[0]?.id, inactive.id);
        await assert.rejects(requireActiveGate(db.manager, sites[0]!, other.id));
        await assert.rejects(requireActiveGate(db.manager, sites[0]!, inactive.id));
        assert.equal((await gates.get(sites[0]!, inactive.id)).status, 'INACTIVE');
        await assert.rejects(db.query('UPDATE gate SET code=$1 WHERE id=$2', ['CHANGED', gate.id]));
      },
    );
    await t.test(
      'name-only creation generates unique codes concurrently and preserves codes on rename',
      async () => {
        const created = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            gates.create(sites[0]!, { name: `Generated gate ${index}` }, context),
          ),
        );
        assert.equal(new Set(created.map((item) => item.code)).size, 4);
        for (const item of created) {
          assert.match(item.code, /^GATE-[0-9A-F]{12}$/);
          assert.equal(item.siteId, sites[0]);
          assert.equal(item.status, 'ACTIVE');
        }
        const renamed = await gates.update(
          sites[0]!,
          created[0]!.id,
          { name: 'Renamed generated gate' },
          context,
        );
        assert.equal(renamed.code, created[0]!.code);
        assert.equal(renamed.name, 'Renamed generated gate');
      },
    );
    const siteService = new SiteConfigurationService(db),
      zones = new ZoneConfigurationService(db, siteService);
    const cameras = new CameraConfigurationService(db, zones, siteService);
    const source = await cameras.create(sites[0]!, {
      type: 'GATE',
      gateId: gate.id,
      code: 'FACE',
      name: 'Gate webcam',
    });
    const zoneCamera = await cameras.create(sites[0]!, {
      type: 'ZONE',
      gateId: null,
      externalId: 'synthetic-zone',
      code: 'ZONE',
      name: 'Zone monitor',
    });
    await t.test(
      'Camera bindings are strict, immutable and generated independently of browser device IDs',
      async () => {
        assert.equal(source.externalId, 'gate-webcam-' + source.id);
        assert.equal((await gates.sources(sites[0]!, gate.id)).items[0]?.id, source.id);
        await assert.rejects(
          cameras.create(sites[0]!, {
            type: 'GATE',
            gateId: other.id,
            code: 'WRONG',
            name: 'Wrong Site',
          }),
        );
        await assert.rejects(
          cameras.create(sites[0]!, {
            type: 'ZONE',
            gateId: gate.id,
            externalId: 'bad',
            code: 'BAD',
            name: 'Bad',
          }),
        );
        await assert.rejects(
          cameras.create(sites[0]!, {
            type: 'GATE',
            gateId: gate.id,
            externalId: 'browser-device',
            code: 'BAD',
            name: 'Bad',
          }),
        );
        await assert.rejects(
          db.query("UPDATE camera SET type='ZONE',gate_id=NULL WHERE id=$1", [source.id]),
        );
        await assert.rejects(
          db.query('UPDATE camera SET gate_id=$1 WHERE id=$2', [other.id, source.id]),
        );
      },
    );
    const zoneId = randomUUID(),
      otherZoneId = randomUUID();
    for (const [id, siteId] of [
      [zoneId, sites[0]!],
      [otherZoneId, sites[1]!],
    ])
      await db.getRepository(ZoneEntity).save({
        id,
        siteId,
        code: id,
        name: 'Synthetic Zone',
        type: ZoneType.STANDARD,
        restrictionPolicy: ZoneRestrictionPolicy.NONE,
        requiredPpe: [],
        configurationLocked: false,
      });
    const polygon = {
      coordinates: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    };
    await t.test(
      'Region cannot cross Sites or attach to GATE and GATE has no monitoring configuration',
      async () => {
        await assert.rejects(
          db.query(
            'INSERT INTO camera_observation_region(id,site_id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), sites[0], zoneCamera.id, otherZoneId, polygon],
          ),
        );
        await assert.rejects(
          db.query(
            'INSERT INTO camera_observation_region(id,site_id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), sites[0], source.id, zoneId, polygon],
          ),
        );
        await assert.rejects(
          cameras.createRegion(sites[0]!, source.id, {
            zoneId,
            polygon,
            expectedConfigurationVersion: 1,
          }),
        );
        await assert.rejects(cameras.buildConfiguration(sites[0]!, source.id));
        await assert.rejects(async () =>
          new CameraPpePolicyService(db, zones).initialize(
            sites[0]!,
            source.id,
            {
              commandId: randomUUID(),
              expectedConfigurationVersion: 1,
              policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
              regionPolicies: [],
            },
            context,
          ),
        );
      },
    );
    const security = {
      id: securityId,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: sites[0]! }],
    };
    await t.test('webcam migration can roll back before browser FACE history exists', async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        const migration = new SecurityBrowserWebcam1795564800000();
        await migration.down(runner);
        await migration.up(runner);
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    });
    let aiCalls = 0;
    const face = new FaceGateService(db, {
      verify: async () => {
        aiCalls++;
        return { status: 'UNKNOWN' as const, reasonCode: 'FACE_PRESENCE_NEW' };
      },
    });
    const frame = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimetype: 'image/jpeg',
      size: 4,
      originalname: 'synthetic.jpg',
    };
    await t.test(
      'FACE rejects supplied ZONE, wrong-Gate and inactive sources before AI',
      async () => {
        for (const id of [zoneCamera.id, randomUUID()])
          await assert.rejects(
            face.observe(security, sites[0]!, gate.id, randomUUID(), frame, id as string),
          );
        assert.equal(aiCalls, 0);
        await face.observe(security, sites[0]!, gate.id, randomUUID(), frame, source.id);
        assert.equal(aiCalls, 1);
        await cameras.setStatus(sites[0]!, source.id, {
          expectedConfigurationVersion: 1,
          status: CameraStatus.INACTIVE,
        });
        await assert.rejects(
          face.observe(security, sites[0]!, gate.id, randomUUID(), frame, source.id),
        );
        assert.equal(aiCalls, 1);
      },
    );
    const browserGate = await gates.create(sites[0]!, { name: 'Browser webcam gate' }, context);
    await t.test(
      'Security webcam presence needs no registration and rejects invalid Gate scope',
      async () => {
        const before = aiCalls,
          sessionId = randomUUID();
        assert.equal(
          (await face.observe(security, sites[0]!, browserGate.id, sessionId, frame, undefined))
            .state,
          'NEW_FACE',
        );
        assert.equal(aiCalls, before + 1);
        for (const [actor, siteId, gateId] of [
          [security, sites[0]!, inactive.id],
          [security, sites[0]!, other.id],
          [security, sites[0]!, randomUUID()],
          [{ ...security, roleAssignments: [] }, sites[0]!, browserGate.id],
          [security, sites[1]!, other.id],
        ] as Array<[typeof security, string, string]>)
          await assert.rejects(face.observe(actor, siteId, gateId, sessionId, frame, undefined));
        assert.equal(aiCalls, before + 1);
      },
    );
    await t.test(
      'webcam verification retains unknown identity without creating a passage',
      async () => {
        const result = await face.verify(security, sites[0]!, browserGate.id, frame, 'IN');
        assert.equal(result.decision.technicalOutcome, 'UNKNOWN');
        assert.ok(result.attempt);
        const stored = await db
          .getRepository(AccessAttemptEntity)
          .findOneByOrFail({ id: result.attempt.id });
        assert.equal(stored.sourceCameraId, null);
        assert.equal(stored.workerId, null);
        assert.equal(stored.status, 'PENDING');
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM gate_event WHERE access_attempt_id=$1',
              [stored.id],
            )
          )[0].count,
          0,
        );
      },
    );
    const workerId = randomUUID(),
      attemptId = randomUUID();
    await db.getRepository(WorkerEntity).save({
      id: workerId,
      siteId: sites[0]!,
      contractorId: null,
      userId: null,
      externalId: 'SYNTHETIC',
      displayName: 'Synthetic Worker',
      isActive: true,
    });
    await t.test(
      'webcam FACE attempts persist and confirm idempotently without a registered source',
      async () => {
        const service = new QrAccessService(db);
        const attempt = await db.transaction((manager) =>
          service.recordAttempt(manager, {
            actor: security,
            siteId: sites[0]!,
            gateId: browserGate.id,
            method: 'FACE',
            direction: 'OUT',
            workerId,
            identityStatus: 'MATCHED',
            authorization: 'ALLOWED',
            reasonCode: 'EXIT_RECORD_ONLY',
          }),
        );
        assert.equal(
          (await db.getRepository(AccessAttemptEntity).findOneByOrFail({ id: attempt.id }))
            .sourceCameraId,
          null,
        );
        await gates.update(sites[0]!, browserGate.id, { status: 'INACTIVE' }, context);
        await assert.rejects(
          service.confirmPassage(security, sites[0]!, attempt.id, { idempotencyKey: randomUUID() }),
          /Gate is inactive/,
        );
        await gates.update(sites[0]!, browserGate.id, { status: 'ACTIVE' }, context);
        const command = { idempotencyKey: randomUUID() };
        const event = await service.confirmPassage(security, sites[0]!, attempt.id, command);
        assert.equal(
          (await service.confirmPassage(security, sites[0]!, attempt.id, command)).id,
          event.id,
        );
        assert.equal(event.accessAttemptId, attempt.id);
        assert.equal(event.gateName, browserGate.name);
      },
    );
    await db.getRepository(AccessAttemptEntity).save({
      id: attemptId,
      siteId: sites[0]!,
      gateId: gate.id,
      sourceCameraId: source.id,
      operatorId: securityId,
      direction: 'OUT',
      method: 'FACE',
      workerId,
      visitId: null,
      identityStatus: 'MATCHED',
      authorizationStatus: 'ALLOWED',
      scheduleStatus: 'NOT_APPLICABLE',
      reasonCode: 'EXIT_RECORD_ONLY',
      sitePolicyVersion: 1,
      status: 'READY',
      expiresAt: new Date(Date.now() + 300000),
    });
    await t.test(
      'confirm rechecks a source disabled after verify and leaves no passage or attendance',
      async () => {
        const attendanceBefore = (
          await db.query('SELECT count(*)::int AS count FROM attendance_event WHERE worker_id=$1', [
            workerId,
          ])
        )[0].count;
        await assert.rejects(
          new QrAccessService(db).confirmPassage(security, sites[0]!, attemptId, {
            idempotencyKey: randomUUID(),
          }),
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM gate_event WHERE access_attempt_id=$1',
              [attemptId],
            )
          )[0].count,
          0,
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS count FROM attendance_event WHERE worker_id=$1',
              [workerId],
            )
          )[0].count,
          attendanceBefore,
        );
        await db.getRepository(AccessAttemptEntity).delete(attemptId);
        await assert.rejects(db.getRepository(GateEntity).delete(gate.id));
      },
    );
    await t.test('webcam migration rollback refuses to discard FACE history', async () => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await assert.rejects(new SecurityBrowserWebcam1795564800000().down(runner));
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      assert.ok(await db.getRepository(AccessAttemptEntity).existsBy({ method: 'FACE', workerId }));
    });
    await t.test('permission revocation inside the mutation transaction is enforced', async () => {
      await db
        .getRepository(UserRoleAssignmentEntity)
        .delete({ userId: managerId, siteId: sites[0]! });
      await assert.rejects(gates.update(sites[0]!, gate.id, { name: 'Must not change' }, context));
      assert.equal((await gates.get(sites[0]!, gate.id)).name, 'Main gate');
    });
    await t.test(
      'populated data is neither guessed during upgrade nor discarded on downgrade',
      async () => {
        for (const direction of ['up', 'down'] as const) {
          const runner = db.createQueryRunner();
          await runner.connect();
          await runner.startTransaction();
          try {
            await assert.rejects(new GateRegistry1795046400001()[direction](runner));
          } finally {
            await runner.rollbackTransaction();
            await runner.release();
          }
        }
        assert.equal((await gates.get(sites[0]!, gate.id)).name, 'Main gate');
      },
    );
    await t.test('current entity metadata agrees with the clean migrated schema', async () => {
      const log = await db.driver.createSchemaBuilder().log();
      assert.deepEqual(
        log.upQueries.map((q) => q.query),
        [],
      );
    });
  } finally {
    await owned.dispose();
  }
});
