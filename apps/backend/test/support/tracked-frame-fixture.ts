import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';

/** Synthetic issued state only: no physical capture, qualified profile or real camera. */
export async function seedTrackedFrameFixture(db: DataSource) {
  const siteId = randomUUID(),
    cameraId = randomUUID();
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic staging Site')",
    [siteId],
  );
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic staging camera')",
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
      { schemaVersion: '1.0.0', configurationVersion: 1, cameraExternalId: cameraId, regions: [] },
      new ZoneConfigurationService(db, new SiteConfigurationService(db)),
    );
  });
  const [{ bundle_sha256: bundleSha256 }] = await db.query(
    'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1',
    [cameraId],
  );
  const refreshReceipt = async () => {
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
    return {
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
  };
  const context = await refreshReceipt();
  const event = (partIndex = 0, partCount = 1, sequenceNumber = '0', frameId = randomUUID()) => ({
    schemaVersion: '1.5.0',
    eventId: String(randomUUID()),
    cameraExternalId: cameraId,
    streamSessionId: generation.streamSessionId,
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 120, height: 80 },
    framePartition: { frameId, sequenceNumber, partIndex, partCount },
    observations: [],
    evidence: [],
    continuity: {
      schemaVersion: '1.0.0',
      profileSha256: 'a'.repeat(64),
      coverage: { status: 'COMPLETE' },
      subjects: [],
      retiredSegments: [],
    },
  });
  return { siteId, cameraId, generation, context, refreshReceipt, event };
}
