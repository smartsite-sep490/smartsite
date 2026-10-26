import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import {
  CameraEntity,
  CameraStatus,
  SiteEntity,
  UserEntity,
} from '../../src/database/entities/index.js';
import { CameraConfigurationReferenceService } from '../../src/modules/cameras/camera-configuration-reference.service.js';
import type { CameraConfigurationImageService } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('reference issuance retains unconfirmed history and refuses stale context in isolated PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  const migrations = db.options.migrations;
  assert(Array.isArray(migrations));
  const referenceIndex = migrations.findIndex(
    (migration) =>
      typeof migration === 'function' &&
      migration.name === 'CameraConfigurationReferences1793491200000',
  );
  assert.equal(referenceIndex, 75);
  db.setOptions({ migrations: migrations.slice(0, referenceIndex + 1) });
  try {
    await owned.initialize();
    const [last] = await db.query('SELECT name FROM migrations ORDER BY id DESC LIMIT 1');
    assert.equal(last.name, 'CameraConfigurationReferences1793491200000');
    await db.undoLastMigration(); // Empty rollback, then upgrade with existing baseline rows.
    const siteId = randomUUID(),
      cameraId = randomUUID(),
      actorId = randomUUID();
    const externalId = `SYNTH-REFERENCE-${randomUUID()}`;
    await db
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: siteId, name: 'Synthetic reference Site' });
    await db.getRepository(UserEntity).insert({
      id: actorId,
      username: actorId,
      displayName: 'Synthetic reader',
      passwordHash: 'synthetic-unused-hash',
    });
    await db.getRepository(CameraEntity).insert({
      id: cameraId,
      siteId,
      externalId,
      code: cameraId,
      name: 'Synthetic reference Camera',
    });
    await db.runMigrations();
    assert.equal(
      (await db.getRepository(CameraEntity).findOneByOrFail({ id: cameraId })).configurationVersion,
      1,
    );
    let sessionId = randomUUID(),
      revoked = false,
      imageAgeMs = 0;
    let beforeReturn: (() => Promise<void>) | undefined;
    const images = {
      async read() {
        const capturedAt = new Date(Date.now() - imageAgeMs);
        const image = {
          schemaVersion: 1,
          purpose: 'REGION_CONFIGURATION',
          sourceKind: 'LIVE',
          siteId,
          cameraId,
          configurationVersion: 1,
          referenceExpiresAt: new Date(capturedAt.getTime() + 300000).toISOString(),
          frame: {
            cameraExternalId: externalId,
            sessionId,
            sequenceNumber: '1',
            capturedAt: capturedAt.toISOString(),
            width: 120,
            height: 80,
            imageSha256: 'a'.repeat(64),
            imageDataUrl: 'SYNTHETIC_IMAGE_ADAPTER_NO_CAMERA',
          },
        };
        await beforeReturn?.();
        return image;
      },
      async authorize(_token: string, requestedSite: string, manager?: EntityManager) {
        assert.equal(requestedSite, siteId);
        if (manager) assert.equal(manager.queryRunner?.isTransactionActive, true);
        if (revoked) throw new Error('Synthetic account revoked');
        return actorId;
      },
    } as unknown as CameraConfigurationImageService;
    const service = new CameraConfigurationReferenceService(db, images);

    await t.test(
      'concurrent reads share one unconfirmed view and preserve camera/geometry',
      async () => {
        const results = await Promise.all(
          Array.from({ length: 3 }, () => service.read('fixture-token', siteId, cameraId)),
        );
        assert.equal(new Set(results.map((r) => r.reference.referenceId)).size, 3);
        assert.ok(
          results.every((r) => r.viewValidity === 'UNCONFIRMED' && r.reference.viewRevision === 1),
        );
        assert.ok(
          results.every(
            (r) =>
              r.reference.sessionId === sessionId && r.reference.imageSha256 === 'a'.repeat(64),
          ),
        );
        const [counts] = await db.query(
          'SELECT (SELECT count(*)::int FROM camera_view_revision) AS views, (SELECT count(*)::int FROM camera_configuration_reference) AS refs',
        );
        assert.deepEqual(counts, { views: 1, refs: 3 });
        assert.equal(
          (await db.getRepository(CameraEntity).findOneByOrFail({ id: cameraId }))
            .configurationVersion,
          1,
        );
        assert.deepEqual(await db.query('SELECT id FROM camera_observation_region'), []);
      },
    );

    await t.test(
      'new session creates unconfirmed context without moving old references',
      async () => {
        sessionId = randomUUID();
        const result = await service.read('fixture-token', siteId, cameraId);
        assert.equal(result.reference.viewRevision, 2);
        assert.equal(result.viewValidity, 'UNCONFIRMED');
        const history = await db.query(
          'SELECT revision::int, is_current FROM camera_view_revision ORDER BY revision',
        );
        assert.deepEqual(history, [
          { revision: 1, is_current: false },
          { revision: 2, is_current: true },
        ]);
        const old = await db.query(
          'SELECT id FROM camera_configuration_reference WHERE view_revision=1',
        );
        assert.equal(old.length, 3);
      },
    );

    await t.test(
      'late logout, revision change, cancellation and disabled camera leave no new reference',
      async () => {
        revoked = true;
        await assert.rejects(service.read('fixture-token', siteId, cameraId), /revoked/);
        revoked = false;
        beforeReturn = async () => {
          await db.getRepository(CameraEntity).update(cameraId, { configurationVersion: 2 });
        };
        await assert.rejects(service.read('fixture-token', siteId, cameraId));
        beforeReturn = undefined;
        await db.getRepository(CameraEntity).update(cameraId, { configurationVersion: 1 });
        const previousSession = sessionId;
        sessionId = randomUUID();
        imageAgeMs = 3500;
        await assert.rejects(service.read('fixture-token', siteId, cameraId));
        imageAgeMs = 0;
        sessionId = previousSession;
        const [currentView] = await db.query(
          'SELECT revision::int FROM camera_view_revision WHERE is_current',
        );
        assert.equal(currentView.revision, 2, 'stale image must roll back a proposed new view');
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(service.read('fixture-token', siteId, cameraId, abort.signal));
        await db.getRepository(CameraEntity).update(cameraId, { status: CameraStatus.INACTIVE });
        await assert.rejects(service.read('fixture-token', siteId, cameraId));
        const [count] = await db.query(
          'SELECT count(*)::int AS count FROM camera_configuration_reference',
        );
        assert.equal(count.count, 4);
      },
    );

    await t.test('database constraints and populated downgrade preserve provenance', async () => {
      for (const sql of [
        "UPDATE camera_configuration_reference SET image_sha256='" + 'b'.repeat(64) + "'",
        'DELETE FROM camera_configuration_reference',
        'TRUNCATE camera_configuration_reference',
        'UPDATE camera_view_revision SET width=64',
        'DELETE FROM camera_view_revision',
        'TRUNCATE camera_view_revision CASCADE',
      ])
        await assert.rejects(db.query(sql), /provenance/);
      const insertCopy = `INSERT INTO camera_configuration_reference SELECT $1,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,captured_at,$2,expires_at,issued_by_user_id FROM camera_configuration_reference LIMIT 1`;
      await assert.rejects(
        db.query(insertCopy, [randomUUID(), new Date(Date.now() + 10000)]),
        /chk_camera_reference_times/,
      );
      await assert.rejects(db.undoLastMigration(), /reference provenance must be retained/);
      const [count] = await db.query(
        'SELECT count(*)::int AS count FROM camera_configuration_reference',
      );
      assert.equal(count.count, 4);
    });
  } finally {
    await owned.dispose();
  }
});
