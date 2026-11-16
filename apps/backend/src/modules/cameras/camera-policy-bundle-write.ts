import type { EntityManager } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  parseCameraPolicyConfigurationBundlePayload,
  parseRegionPpePolicy,
  type CameraConfigurationBundle,
  type CameraPolicyConfigurationBundle,
  type RegionPpePolicy,
} from '@smartsite/contracts';
import { conflict } from '../../common/configuration/commands.js';
import { readStoredCameraPolicyBundle } from './camera-policy-bundle-reader.js';

/** Caller owns authentication, Camera lock and revision allocation. No application receipt is created here. */
export async function insertCameraPolicyBundle(
  tx: EntityManager,
  siteId: string,
  bundle: CameraPolicyConfigurationBundle,
  receipt?: { commandId: string; actorUserId: string; requestHash: string },
): Promise<void> {
  if (!tx.queryRunner?.isTransactionActive)
    throw new Error('Camera policy bundle requires a transaction');
  if (!parseCameraPolicyConfigurationBundlePayload(JSON.stringify(bundle)).isValid)
    conflict('Camera policy bundle is invalid');
  await tx.query(
    `INSERT INTO camera_configuration_bundle(camera_id,configuration_version,site_id,camera_external_id,
    view_revision,issued_at,bundle_sha256,schema_version,camera_ppe_policy,command_id,command_actor_id,command_request_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,'2.0.0',$8,$9,$10,$11)`,
    [
      bundle.cameraId,
      bundle.configurationVersion,
      siteId,
      bundle.cameraExternalId,
      bundle.viewRevision,
      bundle.issuedAt,
      bundle.bundleSha256,
      bundle.cameraPpePolicy,
      receipt?.commandId ?? null,
      receipt?.actorUserId ?? null,
      receipt?.requestHash ?? null,
    ],
  );
  for (const region of bundle.regions)
    await tx.query(
      `INSERT INTO camera_configuration_bundle_region
    (camera_id,configuration_version,region_id,geometry_version,zone_id,policy_revision,ppe_policy)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        bundle.cameraId,
        bundle.configurationVersion,
        region.regionId,
        region.geometryVersion,
        region.zoneId,
        region.policyRevision,
        region.ppePolicy,
      ],
    );
}

/** Never reinterpret legacy empty requirements; only retained bindings or explicit new choices are valid. */
export async function preserveCameraPolicyBundle(
  tx: EntityManager,
  siteId: string,
  base: CameraConfigurationBundle,
  newPolicies: ReadonlyMap<string, RegionPpePolicy> = new Map(),
): Promise<boolean> {
  if (!tx.queryRunner?.isTransactionActive)
    throw new Error('Camera policy bundle requires a transaction');
  const [latest] = await tx.query(
    `SELECT camera_id,site_id,camera_external_id,configuration_version,view_revision,bundle_sha256
    FROM camera_configuration_bundle h WHERE camera_id=$1 AND to_jsonb(h)->>'schema_version'='2.0.0'
    ORDER BY configuration_version DESC LIMIT 1`,
    [base.cameraId],
  );
  if (!latest) {
    if (newPolicies.size) conflict('Initialize camera PPE policies first');
    return false;
  }
  const cache = new Map<string, CameraPolicyConfigurationBundle>();
  const retained = async (header: typeof latest) => {
    if (
      header.site_id !== siteId ||
      header.camera_external_id !== base.cameraExternalId ||
      Number(header.configuration_version) >= base.configurationVersion
    )
      conflict('Camera policy lineage is invalid');
    const key = String(header.configuration_version);
    if (cache.has(key)) return cache.get(key)!;
    const value = await readStoredCameraPolicyBundle(tx, {
      cameraId: base.cameraId,
      siteId,
      cameraExternalId: base.cameraExternalId,
      configurationVersion: Number(header.configuration_version),
      viewRevision: Number(header.view_revision),
      bundleSha256: header.bundle_sha256,
    });
    if (!value) conflict('Retained camera PPE policy is unavailable');
    cache.set(key, value);
    return value;
  };
  const cameraPolicy = (await retained(latest)).cameraPpePolicy;
  const previous: Array<typeof latest & { region_id: string }> = base.regions.length
    ? await tx.query(
        `SELECT DISTINCT ON(b.region_id)
    b.region_id,h.camera_id,h.site_id,h.camera_external_id,h.configuration_version,h.view_revision,h.bundle_sha256
    FROM camera_configuration_bundle_region b JOIN camera_configuration_bundle h USING(camera_id,configuration_version)
    WHERE b.camera_id=$1 AND b.region_id=ANY($2::uuid[]) AND to_jsonb(h)->>'schema_version'='2.0.0'
    ORDER BY b.region_id,h.configuration_version DESC`,
        [base.cameraId, base.regions.map((region) => region.regionId)],
      )
    : [];
  const policies = new Map<string, RegionPpePolicy>();
  for (const header of previous) {
    const binding = (await retained(header)).regions.find(
      (region) => region.regionId === header.region_id,
    );
    if (!binding) conflict('Retained Region PPE policy is unavailable');
    policies.set(header.region_id, binding.ppePolicy);
  }
  for (const [id, input] of newPolicies) {
    if (policies.has(id) || !base.regions.some((region) => region.regionId === id))
      conflict('Existing PPE policy requires a policy command');
    const policy = parseRegionPpePolicy(input);
    if (!policy) conflict('New Region PPE policy is invalid');
    policies.set(id, policy);
  }
  if (base.regions.some((region) => !policies.has(region.regionId)))
    conflict('New Region requires an explicit PPE policy choice');
  const content = {
    schemaVersion: '2.0.0',
    cameraId: base.cameraId,
    cameraExternalId: base.cameraExternalId,
    configurationVersion: base.configurationVersion,
    viewRevision: base.viewRevision,
    issuedAt: base.issuedAt,
    cameraPpePolicy: cameraPolicy,
    regions: base.regions.map((region) => ({
      regionId: region.regionId,
      geometryVersion: region.geometryVersion,
      coordinateSpace: region.coordinateSpace,
      polygon: region.polygon,
      zoneId: region.zoneId,
      policyRevision: region.policyRevision,
      ppePolicy: policies.get(region.regionId),
    })),
  };
  const parsed = parseCameraPolicyConfigurationBundlePayload(
    JSON.stringify({ ...content, bundleSha256: computeCanonicalPayloadHash(content) }),
  );
  if (!parsed.isValid || !parsed.value) conflict('Camera policy bundle is invalid');
  await insertCameraPolicyBundle(tx, siteId, parsed.value);
  return true;
}
