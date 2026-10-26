import type { DataSource } from 'typeorm';
import {
  parseCameraConfigurationBundlePayload,
  computeCanonicalPayloadHash,
  type CameraConfigurationBundle,
} from '@smartsite/contracts';
import { conflict, missing } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraConfigurationBundleEntity } from '../../database/entities/camera-configuration-bundle.entity.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Issued camera configuration is unavailable',
  });
}

/** Reads immutable issuance only; snapshot consistency is not worker ownership or application. */
export async function readIssuedCameraConfigurationBundle(
  source: DataSource,
  cameraId: string,
): Promise<CameraConfigurationBundle> {
  try {
    return await source.transaction('REPEATABLE READ', async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneBy({ id: cameraId });
      if (!camera) missing();
      if (camera.status !== CameraStatus.ACTIVE)
        conflict('Issued camera configuration is unavailable');
      const header = await manager.getRepository(CameraConfigurationBundleEntity).findOneBy({
        cameraId,
        siteId: camera.siteId,
        configurationVersion: String(camera.configurationVersion),
      });
      if (!header) conflict('Issued camera configuration is unavailable');
      if (header.cameraExternalId !== camera.externalId)
        conflict('Issued camera configuration is unavailable');
      const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
        cameraId,
        siteId: camera.siteId,
        revision: header.viewRevision,
        isCurrent: true,
      });
      if (!view) conflict('Issued camera configuration is unavailable');
      if (!(header.issuedAt instanceof Date) || !Number.isFinite(header.issuedAt.getTime()))
        unavailable();
      const rows: Array<
        Record<string, unknown> & { policyRevision: string; requiredPpe: string[] }
      > = await manager.query(
        `
        SELECT b.region_id AS "regionId",b.geometry_version AS "geometryVersion",g.coordinate_space AS "coordinateSpace",
          g.polygon,b.zone_id AS "zoneId",b.policy_revision AS "policyRevision",p.required_ppe AS "requiredPpe",
          g.is_active AS "active",g.reference_id AS "referenceId",g.view_revision AS "viewRevision"
        FROM camera_configuration_bundle_region b
        LEFT JOIN camera_region_geometry_revision g ON g.region_id=b.region_id AND g.geometry_version=b.geometry_version AND g.camera_id=b.camera_id AND g.zone_id=b.zone_id
        LEFT JOIN zone_policy_revision p ON p.zone_id=b.zone_id AND p.policy_revision=b.policy_revision
        WHERE b.camera_id=$1 AND b.configuration_version=$2 ORDER BY b.region_id ASC LIMIT 65`,
        [cameraId, header.configurationVersion],
      );
      if (
        rows.length > 64 ||
        rows.some(
          (row) =>
            row.active !== true ||
            typeof row.referenceId !== 'string' ||
            row.viewRevision !== header.viewRevision,
        )
      )
        unavailable();
      const current = await manager.getRepository(CameraObservationRegionEntity).find({
        where: { cameraId, isActive: true },
        order: { id: 'ASC' },
        take: 65,
      });
      if (
        current.length !== rows.length ||
        current.some((region, index) => {
          const row = rows[index]!;
          return (
            region.id !== row.regionId ||
            region.version !== row.geometryVersion ||
            region.zoneId !== row.zoneId ||
            region.coordinateSpace !== row.coordinateSpace ||
            computeCanonicalPayloadHash(region.polygon) !== computeCanonicalPayloadHash(row.polygon)
          );
        })
      )
        unavailable();
      const parsed = parseCameraConfigurationBundlePayload(
        JSON.stringify({
          schemaVersion: '1.0.0',
          cameraId,
          cameraExternalId: header.cameraExternalId,
          configurationVersion: Number(header.configurationVersion),
          viewRevision: Number(header.viewRevision),
          issuedAt: header.issuedAt.toISOString(),
          bundleSha256: header.bundleSha256,
          regions: rows.map((row) => ({
            regionId: row.regionId,
            geometryVersion: row.geometryVersion,
            coordinateSpace: row.coordinateSpace,
            polygon: row.polygon,
            zoneId: row.zoneId,
            policyRevision: Number(row.policyRevision),
            requiredPpe: [...row.requiredPpe].sort(),
          })),
        }),
      );
      if (!parsed.isValid || !parsed.value) unavailable();
      return parsed.value;
    });
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    unavailable();
  }
}
