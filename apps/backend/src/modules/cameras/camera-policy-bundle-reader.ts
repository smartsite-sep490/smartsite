import type { DataSource, EntityManager } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  parseCameraPolicyConfigurationBundlePayload,
  type CameraPolicyConfigurationBundle,
} from '@smartsite/contracts';
import { conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import type { HistoricalIssuedCameraBundleKey } from './camera-configuration-bundle-reader.js';

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Issued camera policy configuration is unavailable',
  });
}
function requireTransaction(manager: EntityManager) {
  if (!manager.queryRunner?.isTransactionActive)
    throw new Error('Camera policy bundle requires a transaction');
}

/** Exact retained issuance only. Caller owns access/admission; this never establishes identity or authority. */
export async function readStoredCameraPolicyBundle(
  manager: EntityManager,
  key: HistoricalIssuedCameraBundleKey,
): Promise<CameraPolicyConfigurationBundle | undefined> {
  requireTransaction(manager);
  try {
    for (const id of [key.cameraId, key.siteId])
      if (uuid(id) !== id.toLowerCase()) return undefined;
    if (
      !Number.isSafeInteger(key.configurationVersion) ||
      key.configurationVersion < 1 ||
      !Number.isSafeInteger(key.viewRevision) ||
      key.viewRevision < 1 ||
      typeof key.bundleSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(key.bundleSha256) ||
      typeof key.cameraExternalId !== 'string' ||
      !key.cameraExternalId ||
      key.cameraExternalId.length > 128
    )
      return undefined;
    const [header] = await manager.query(
      `SELECT h.*,to_jsonb(h)->>'schema_version' AS wire_schema,
      to_jsonb(h)->'camera_ppe_policy' AS camera_policy FROM camera_configuration_bundle h
      WHERE camera_id=$1 AND site_id=$2 AND camera_external_id=$3 AND configuration_version=$4
      AND view_revision=$5 AND bundle_sha256=$6`,
      [
        key.cameraId,
        key.siteId,
        key.cameraExternalId,
        key.configurationVersion,
        key.viewRevision,
        key.bundleSha256,
      ],
    );
    if (!header) return undefined;
    if (
      header.wire_schema !== '2.0.0' ||
      !(header.issued_at instanceof Date) ||
      !Number.isFinite(header.issued_at.getTime())
    )
      unavailable();
    const rows: Array<Record<string, unknown>> = await manager.query(
      `SELECT
      b.region_id AS "regionId",b.geometry_version AS "geometryVersion",b.zone_id AS "zoneId",
      b.policy_revision AS "policyRevision",to_jsonb(b)->'ppe_policy' AS "ppePolicy",
      g.coordinate_space AS "coordinateSpace",g.polygon,g.is_active AS active,
      g.reference_id AS reference,g.view_revision AS view,
      p.zone_id IS NOT NULL AS "validZoneScope"
      FROM camera_configuration_bundle_region b
      LEFT JOIN camera_region_geometry_revision g ON g.region_id=b.region_id AND g.geometry_version=b.geometry_version
        AND g.camera_id=b.camera_id AND g.zone_id=b.zone_id
      LEFT JOIN zone_policy_revision p ON p.zone_id=b.zone_id AND p.policy_revision=b.policy_revision AND p.site_id=$3
      WHERE b.camera_id=$1 AND b.configuration_version=$2 ORDER BY b.region_id LIMIT 65`,
      [key.cameraId, key.configurationVersion, key.siteId],
    );
    if (
      rows.length > 64 ||
      rows.some(
        (row) =>
          row.active !== true ||
          typeof row.reference !== 'string' ||
          row.view !== String(key.viewRevision) ||
          row.validZoneScope !== true,
      )
    )
      unavailable();
    const parsed = parseCameraPolicyConfigurationBundlePayload(
      JSON.stringify({
        schemaVersion: '2.0.0',
        cameraId: key.cameraId,
        cameraExternalId: key.cameraExternalId,
        configurationVersion: key.configurationVersion,
        viewRevision: key.viewRevision,
        issuedAt: header.issued_at.toISOString(),
        bundleSha256: key.bundleSha256,
        cameraPpePolicy: header.camera_policy,
        regions: rows.map((row) => ({
          regionId: row.regionId,
          geometryVersion: row.geometryVersion,
          coordinateSpace: row.coordinateSpace,
          polygon: row.polygon,
          zoneId: row.zoneId,
          policyRevision: Number(row.policyRevision),
          ppePolicy: row.ppePolicy,
        })),
      }),
    );
    if (!parsed.isValid || !parsed.value) unavailable();
    return parsed.value;
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    unavailable();
  }
}

export async function readIssuedCameraPolicyBundle(source: DataSource, cameraId: string) {
  try {
    return await source.transaction('REPEATABLE READ', (manager) =>
      readCurrentCameraPolicyBundle(manager, cameraId),
    );
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    unavailable();
  }
}

/** Current worker eligibility requires current camera/view/geometry; saved is not APPLIED. */
export async function readCurrentCameraPolicyBundle(
  manager: EntityManager,
  cameraId: string,
): Promise<CameraPolicyConfigurationBundle> {
  requireTransaction(manager);
  cameraId = uuid(cameraId).toLowerCase();
  const camera = await manager.getRepository(CameraEntity).findOneBy({ id: cameraId });
  if (!camera) missing();
  if (camera.status !== CameraStatus.ACTIVE)
    conflict('Issued camera policy configuration is unavailable');
  const [header] = await manager.query(
    `SELECT view_revision,bundle_sha256,to_jsonb(h)->>'schema_version' AS schema_version FROM camera_configuration_bundle h
    WHERE camera_id=$1 AND site_id=$2 AND camera_external_id=$3 AND configuration_version=$4`,
    [cameraId, camera.siteId, camera.externalId, camera.configurationVersion],
  );
  if (!header) conflict('Issued camera policy configuration is unavailable');
  if (header.schema_version == null || header.schema_version === '1.0.0')
    conflict('Camera PPE policy initialization is required');
  if (header.schema_version !== '2.0.0') unavailable();
  const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
    cameraId,
    siteId: camera.siteId,
    revision: header.view_revision,
    isCurrent: true,
  });
  if (!view) conflict('Issued camera policy configuration is unavailable');
  const bundle = await readStoredCameraPolicyBundle(manager, {
    cameraId,
    siteId: camera.siteId,
    cameraExternalId: camera.externalId,
    configurationVersion: camera.configurationVersion,
    viewRevision: Number(header.view_revision),
    bundleSha256: header.bundle_sha256,
  });
  if (!bundle) unavailable();
  const current = await manager.getRepository(CameraObservationRegionEntity).find({
    where: { cameraId, isActive: true },
    order: { id: 'ASC' },
    take: 65,
  });
  if (
    current.length !== bundle.regions.length ||
    current.some((region, index) => {
      const issued = bundle.regions[index]!;
      return (
        region.id !== issued.regionId ||
        region.zoneId !== issued.zoneId ||
        region.version !== issued.geometryVersion ||
        region.coordinateSpace !== issued.coordinateSpace ||
        computeCanonicalPayloadHash(region.polygon) !== computeCanonicalPayloadHash(issued.polygon)
      );
    })
  )
    unavailable();
  return bundle;
}
