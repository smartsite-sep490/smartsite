import type { DataSource } from 'typeorm';
import { missing, uuid } from '../../common/configuration/commands.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { readStoredCameraPolicyBundle } from './camera-policy-bundle-reader.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

export async function readSavedPpePolicy(
  source: DataSource,
  siteId: string,
  cameraId: string,
  regionId?: string,
) {
  siteId = uuid(siteId).toLowerCase();
  cameraId = uuid(cameraId).toLowerCase();
  if (regionId !== undefined) regionId = uuid(regionId).toLowerCase();
  return source.transaction('REPEATABLE READ', async (tx) => {
    const camera = await tx.getRepository(CameraEntity).findOneBy({ id: cameraId, siteId });
    if (!camera) missing();
    const region =
      regionId === undefined
        ? null
        : await tx
            .getRepository(CameraObservationRegionEntity)
            .findOneBy({ id: regionId, cameraId });
    if (regionId !== undefined && !region) missing();
    const [header] = await tx.query(
      `SELECT h.configuration_version, h.view_revision, h.bundle_sha256
       FROM camera_configuration_bundle h
       WHERE h.camera_id=$1 AND h.site_id=$2 AND h.camera_external_id=$3
         AND h.configuration_version <= $4 AND to_jsonb(h)->>'schema_version'='2.0.0'
         AND ($5::uuid IS NULL OR EXISTS (
           SELECT 1 FROM camera_configuration_bundle_region b
           WHERE b.camera_id=h.camera_id AND b.configuration_version=h.configuration_version
             AND b.region_id=$5
         ))
       ORDER BY h.configuration_version DESC LIMIT 1`,
      [cameraId, siteId, camera.externalId, camera.configurationVersion, regionId ?? null],
    );
    const scope = {
      cameraId,
      regionId: regionId ?? null,
      configurationVersion: camera.configurationVersion,
    };
    if (!header) return { ...scope, policy: null, savedRevision: null };
    const bundle = await readStoredCameraPolicyBundle(tx, {
      cameraId,
      siteId,
      cameraExternalId: camera.externalId,
      configurationVersion: Number(header.configuration_version),
      viewRevision: Number(header.view_revision),
      bundleSha256: header.bundle_sha256,
    });
    const policy =
      regionId === undefined
        ? bundle?.cameraPpePolicy
        : bundle?.regions.find((binding) => binding.regionId === regionId)?.ppePolicy;
    if (!bundle || !policy)
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Saved camera PPE policy is unavailable',
      });
    return { ...scope, policy, savedRevision: bundle.configurationVersion };
  });
}
