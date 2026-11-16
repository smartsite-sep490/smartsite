import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
const status = (expected: number) => (error: unknown) =>
  error instanceof PublicHttpException && error.getStatus() === expected;

test('tracked part original receipt authentication on isolated PostgreSQL is separate from frame admission', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      cameraId = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic tracked auth Site')",
      [siteId],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic tracked auth camera')",
      [cameraId, siteId],
    );
    const generation = await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 120000);
    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
      VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
      [cameraId, siteId, generation.streamSessionId],
    );
    await db.transaction(async (manager) => {
      await recordCameraConfigurationBundle(
        manager,
        await manager.getRepository(CameraEntity).findOneByOrFail({ id: cameraId }),
        {
          schemaVersion: '1.0.0',
          configurationVersion: 1,
          cameraExternalId: cameraId,
          regions: [],
        },
        new ZoneConfigurationService(db, new SiteConfigurationService(db)),
      );
    });
    const [{ bundle_sha256: bundleSha256 }] = await db.query(
      'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1',
      [cameraId],
    );
    const ack = {
      commandId: randomUUID(),
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    };
    await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, ack);
    const context = {
      schemaVersion: '1.0.0',
      cameraId,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      receiptCommandId: ack.commandId,
      sourceKind: 'LIVE',
    };
    const event = {
      schemaVersion: '1.5.0',
      eventId: randomUUID(),
      cameraExternalId: cameraId,
      streamSessionId: generation.streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 120, height: 80 },
      framePartition: {
        frameId: randomUUID(),
        sequenceNumber: '18446744073709551615',
        partIndex: 0,
        partCount: 2,
      },
      observations: [],
      evidence: [],
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: 'a'.repeat(64),
        coverage: { status: 'COMPLETE' },
        subjects: [],
        retiredSegments: [],
      },
    };
    // Explicit synthetic server-side fixture, NOT evidence that a tracker/profile is qualified.
    const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [cameraId],
      clockToleranceMs: 1000,
      routeEpoch: '00000000-0000-4000-8000-000000000001',
    });
    const authenticate = (
      payload: unknown = event,
      ctx: unknown = context,
      secret = generation.secret,
    ) => db.transaction((m) => auth.authenticate(m, payload, ctx, secret));
    await t.test(
      'receipt refresh keeps stable execution scope but original binding and receipt stay distinct',
      async () => {
        const first = await authenticate();
        const refreshed = { ...ack, commandId: randomUUID() };
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, refreshed);
        const rebound = await authenticate(event, {
          ...context,
          receiptCommandId: refreshed.commandId,
        });
        assert.equal(first.payloadHash, rebound.payloadHash);
        assert.notEqual(first.bindingHash, rebound.bindingHash);
        assert.equal(first.scopeSha256, rebound.scopeSha256);
        const second = await authenticate(
          {
            ...event,
            eventId: randomUUID(),
            framePartition: { ...event.framePartition, partIndex: 1 },
          },
          { ...context, receiptCommandId: refreshed.commandId },
        );
        assert.equal(first.scopeSha256, second.scopeSha256);
        assert.notEqual(first.bindingHash, second.bindingHash);
        assert.equal(first.context.receiptCommandId, ack.commandId);
        assert.equal(second.context.receiptCommandId, refreshed.commandId);
        assert.equal(first.siteId, siteId);
        assert.equal(first.classification, 'LIVE');
        assert.equal(Object.hasOwn(first, 'secret'), false);
        assert.equal(Object.isFrozen(first.payload), true);
      },
    );
    await t.test(
      'missing server profile or worker-selected different profile cannot qualify itself',
      async () => {
        const disabled = new TrackedPartAuthenticator(new CameraEventAdmissionService());
        await assert.rejects(
          db.transaction((m) => disabled.authenticate(m, event, context, generation.secret)),
          status(503),
        );
        await assert.rejects(
          authenticate({
            ...event,
            continuity: { ...event.continuity, profileSha256: 'b'.repeat(64) },
          }),
          status(503),
        );
      },
    );
    await t.test(
      'forged receipt, wrong credential and event-session mismatch are refused',
      async () => {
        await assert.rejects(
          authenticate(event, { ...context, receiptCommandId: randomUUID() }),
          status(409),
        );
        await assert.rejects(authenticate(event, context, 'x'.repeat(43)), status(401));
        await assert.rejects(
          authenticate({ ...event, streamSessionId: randomUUID() }),
          status(400),
        );
      },
    );
    await t.test(
      'issued view dimensions are checked, and no technical auth creates raw/episode rows',
      async () => {
        await assert.rejects(
          authenticate({ ...event, frameDimensions: { width: 121, height: 80 } }),
          status(409),
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM ai_observation_event'))[0].n,
          0,
        );
        assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
      },
    );
    await t.test('every exact retry authenticates again after credential revocation', async () => {
      await revokeCameraWorkerGeneration(db, cameraId, [cameraId], generation.workerGenerationId);
      await assert.rejects(authenticate(), status(401));
    });
  } finally {
    await owned.dispose();
  }
});
