import type { EntityManager } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  parseCameraConfigurationBundlePayload,
  type CameraRegionConfiguration,
} from '@smartsite/contracts';
import { conflict } from '../../common/configuration/commands.js';
import type { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import { CameraRegionGeometryRevisionEntity } from '../../database/entities/camera-region-geometry-revision.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import {
  CameraConfigurationBundleEntity,
  CameraConfigurationBundleRegionEntity,
} from '../../database/entities/camera-configuration-bundle.entity.js';
import type { ZoneConfigurationService } from '../zones/zone-configuration.service.js';

/** Only real camera-counter advances call this under their existing Camera lock/transaction. */
export async function recordCameraConfigurationBundle(
  manager: EntityManager,
  camera: CameraEntity,
  geometry: CameraRegionConfiguration,
  zones: ZoneConfigurationService,
): Promise<void> {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Camera bundle requires a transaction');
  if (camera.status !== CameraStatus.ACTIVE) return;
  const view = await manager
    .getRepository(CameraViewRevisionEntity)
    .findOneBy({ cameraId: camera.id, siteId: camera.siteId, isCurrent: true });
  if (!view) return;
  const revisions = await manager
    .getRepository(CameraRegionGeometryRevisionEntity)
    .createQueryBuilder('history')
    .innerJoin(
      CameraObservationRegionEntity,
      'region',
      'region.id=history.region_id AND region.version=history.geometry_version AND region.camera_id=history.camera_id AND region.zone_id=history.zone_id',
    )
    .where('history.cameraId=:cameraId AND region.is_active=true', { cameraId: camera.id })
    .getMany();
  const history = new Map(revisions.map((row) => [row.regionId, row]));
  if (
    geometry.regions.some((region) => {
      const revision = history.get(region.regionId);
      return !revision || !revision.referenceId || revision.viewRevision !== view.revision;
    })
  )
    return;
  const zoneIds = [...new Set(revisions.map((row) => row.zoneId))].sort();
  const policies = new Map<
    string,
    Awaited<ReturnType<ZoneConfigurationService['configurationPolicy']>>
  >();
  for (const id of zoneIds)
    policies.set(id, await zones.configurationPolicy(manager, camera.siteId, id));
  const regions = geometry.regions.map((region) => {
    const revision = history.get(region.regionId)!;
    const policy = policies.get(revision.zoneId)!;
    if (
      !revision.isActive ||
      revision.coordinateSpace !== region.coordinateSpace ||
      computeCanonicalPayloadHash(revision.polygon) !== computeCanonicalPayloadHash(region.polygon)
    )
      conflict('Region history does not match configuration');
    return {
      ...region,
      zoneId: revision.zoneId,
      policyRevision: Number(policy.policyRevision),
      requiredPpe: [...policy.requiredPpe].sort(),
    };
  });
  const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    conflict('Camera bundle time is unavailable');
  const content = {
    schemaVersion: '1.0.0',
    cameraId: camera.id,
    cameraExternalId: camera.externalId,
    configurationVersion: camera.configurationVersion,
    viewRevision: Number(view.revision),
    issuedAt: now.toISOString(),
    regions,
  };
  const bundleSha256 = computeCanonicalPayloadHash(content);
  if (!parseCameraConfigurationBundlePayload(JSON.stringify({ ...content, bundleSha256 })).isValid)
    conflict('Camera bundle is invalid');
  await manager.getRepository(CameraConfigurationBundleEntity).insert({
    cameraId: camera.id,
    configurationVersion: String(camera.configurationVersion),
    siteId: camera.siteId,
    cameraExternalId: camera.externalId,
    viewRevision: view.revision,
    issuedAt: now,
    bundleSha256,
  });
  if (regions.length)
    await manager.getRepository(CameraConfigurationBundleRegionEntity).insert(
      regions.map((region) => ({
        cameraId: camera.id,
        configurationVersion: String(camera.configurationVersion),
        regionId: region.regionId,
        geometryVersion: region.geometryVersion,
        zoneId: region.zoneId,
        policyRevision: String(region.policyRevision),
      })),
    );
}
