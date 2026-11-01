import { randomUUID } from 'node:crypto';
import type { CameraRegionConfiguration, PpeItem } from '@smartsite/contracts';
import type { DataSource } from 'typeorm';
import { ZoneType, ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';

/** Synthetic issued state only: no physical capture, qualified profile or real camera. */
export async function seedTrackedFrameFixture(
  db: DataSource,
  requiredPpe: readonly PpeItem[] = [],
) {
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
  const regions: Array<CameraRegionConfiguration['regions'][number]> = [];
  let ppeRegionId: string | null = null;
  if (requiredPpe.length) {
    const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const zone = await zones.create(siteId, {
      name: 'Synthetic PPE area',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [...requiredPpe],
    });
    const userId = randomUUID(),
      referenceId = randomUUID(),
      regionId = randomUUID();
    const polygon = {
      coordinates: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ],
    } as const;
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic reference issuer','synthetic-non-login-hash')",
      [userId],
    );
    await db.query(
      `WITH moment AS (SELECT clock_timestamp() AS at)
      INSERT INTO camera_configuration_reference(id,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,captured_at,issued_at,expires_at,issued_by_user_id)
      SELECT $1,$2,1,$3,$4,'LIVE',120,80,$5,1,at,at,at+INTERVAL '1 minute',$6 FROM moment`,
      [referenceId, cameraId, siteId, generation.streamSessionId, 'a'.repeat(64), userId],
    );
    for (const issuedRegionId of [regionId, randomUUID()]) {
      await db.query(
        'INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4::jsonb)',
        [issuedRegionId, cameraId, zone.id, JSON.stringify(polygon)],
      );
      await db.query(
        `INSERT INTO camera_region_geometry_revision(region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline,reference_id,view_revision,confirmed_by_user_id,confirmed_at,recorded_at)
      VALUES($1,1,$2,$3,1,'NORMALIZED_0_1',$4::jsonb,true,false,$5,1,$6,clock_timestamp(),clock_timestamp())`,
        [issuedRegionId, cameraId, zone.id, JSON.stringify(polygon), referenceId, userId],
      );
      regions.push({
        regionId: issuedRegionId,
        geometryVersion: 1,
        coordinateSpace: 'NORMALIZED_0_1',
        polygon,
      });
    }
    await db.transaction(async (manager) =>
      zones.markLinked(manager, await zones.lockForRegion(manager, siteId, zone.id)),
    );
    ppeRegionId = regionId;
  }
  await db.transaction(async (manager) => {
    await recordCameraConfigurationBundle(
      manager,
      await manager.getRepository(CameraEntity).findOneByOrFail({ id: cameraId }),
      {
        schemaVersion: '1.0.0',
        configurationVersion: 1,
        cameraExternalId: cameraId,
        regions: [...regions].sort((a, b) => a.regionId.localeCompare(b.regionId)),
      },
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
  return {
    siteId,
    cameraId,
    generation,
    context,
    refreshReceipt,
    event,
    ppeRegionId,
    ppeRegionIds: regions.map((r) => r.regionId),
  };
}
