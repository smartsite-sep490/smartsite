import { insertCameraPolicyBundle } from './camera-policy-bundle-write.js';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { DataSource } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  parseCameraPpePolicyChangeCommand,
  parseRegionPpePolicyChangeCommand,
  parseInitializeCameraPpePolicyCommand,
  parseCameraPolicyConfigurationBundlePayload,
  type CameraPpePolicyChangeCommand,
  type RegionPpePolicyChangeCommand,
  type InitializeCameraPpePolicyCommand,
  type CameraRegionConfiguration,
} from '@smartsite/contracts';
import {
  conflict,
  invalid,
  knownUnique,
  missing,
  uuid,
} from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import { siteManagerCommandAuthorization } from '../auth/site-manager.guard.js';
import { ZoneConfigurationService } from '../zones/zone-configuration.service.js';
import { buildCameraConfigurationBundle } from './camera-configuration-bundles.js';
import { recordRegionRevision } from './camera-region-revisions.js';
import {
  readCurrentCameraPolicyBundle,
  readStoredCameraPolicyBundle,
} from './camera-policy-bundle-reader.js';

type Change =
  | { kind: 'INITIALIZE'; input: InitializeCameraPpePolicyCommand }
  | { kind: 'CAMERA'; input: CameraPpePolicyChangeCommand }
  | { kind: 'ACTIVATE_REGION'; regionId: string; input: RegionPpePolicyChangeCommand }
  | { kind: 'REGION'; regionId: string; input: RegionPpePolicyChangeCommand };

/** Authenticated management writes create immutable PPE policy revisions. */
@Injectable()
export class CameraPpePolicyService {
  constructor(
    private readonly source: DataSource,
    private readonly zones: ZoneConfigurationService,
  ) {}

  initialize(
    siteId: string,
    cameraId: string,
    input: unknown,
    context: MainConfigurationCommandContext,
  ) {
    const parsed = parseInitializeCameraPpePolicyCommand(input);
    if (!parsed) invalid('Invalid initial PPE policies');
    return this.apply(siteId, cameraId, { kind: 'INITIALIZE', input: parsed }, context);
  }
  setCameraPolicy(
    siteId: string,
    cameraId: string,
    input: unknown,
    context: MainConfigurationCommandContext,
  ) {
    const parsed = parseCameraPpePolicyChangeCommand(input);
    if (!parsed) invalid('Invalid camera PPE policy');
    return this.apply(siteId, cameraId, { kind: 'CAMERA', input: parsed }, context);
  }
  setRegionPolicy(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: unknown,
    context: MainConfigurationCommandContext,
  ) {
    const parsed = parseRegionPpePolicyChangeCommand(input);
    if (!parsed) invalid('Invalid Region PPE policy');
    return this.apply(
      siteId,
      cameraId,
      { kind: 'REGION', regionId: uuid(regionId).toLowerCase(), input: parsed },
      context,
    );
  }

  /** Explicit adoption/activation; an inactive legacy Region cannot inherit by accident. */
  activateRegionWithPolicy(
    siteId: string,
    cameraId: string,
    regionId: string,
    input: unknown,
    context: MainConfigurationCommandContext,
  ) {
    const parsed = parseRegionPpePolicyChangeCommand(input);
    if (!parsed) invalid('Invalid Region PPE policy');
    return this.apply(
      siteId,
      cameraId,
      { kind: 'ACTIVATE_REGION', regionId: uuid(regionId).toLowerCase(), input: parsed },
      context,
    );
  }

  private async apply(
    siteId: string,
    cameraId: string,
    change: Change,
    context: MainConfigurationCommandContext,
  ) {
    if (!context || typeof context.reauthorize !== 'function') throw new UnauthorizedException();
    siteId = uuid(siteId).toLowerCase();
    cameraId = uuid(cameraId).toLowerCase();
    const actorUserId = uuid(context.actorUserId).toLowerCase();
    const requestHash = computeCanonicalPayloadHash({ siteId, cameraId, actorUserId, change });
    try {
      return await executeMainConfigurationCommand(
        this.source,
        { ...context, actorUserId },
        'CAMERA_PPE_POLICY_UPDATE',
        { siteId, cameraId, change },
        async (tx) => {
          const camera = await tx
            .getRepository(CameraEntity)
            .findOne({ where: { id: cameraId, siteId }, lock: { mode: 'pessimistic_write' } });
          if (!camera) missing();
          const [storage] = await tx.query(
            `SELECT EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = to_regclass('camera_configuration_bundle')
              AND attname = 'schema_version' AND NOT attisdropped) AS ready`,
          );
          if (!storage.ready) {
            throw new PublicHttpException(503, {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Camera PPE policy storage is unavailable',
            });
          }
          const [previous] = await tx.query(
            'SELECT * FROM camera_configuration_bundle WHERE command_id=$1',
            [change.input.commandId],
          );
          if (previous) {
            if (
              previous.camera_id !== cameraId ||
              previous.site_id !== siteId ||
              previous.command_actor_id !== actorUserId ||
              previous.command_request_sha256 !== requestHash
            )
              conflict('PPE command ID was already used');
            const retained = await readStoredCameraPolicyBundle(tx, {
              cameraId,
              siteId,
              cameraExternalId: previous.camera_external_id,
              configurationVersion: Number(previous.configuration_version),
              viewRevision: Number(previous.view_revision),
              bundleSha256: previous.bundle_sha256,
            });
            if (!retained) conflict('PPE command result is unavailable');
            return {
              commandId: change.input.commandId,
              cameraId,
              configurationVersion: retained.configurationVersion,
              viewRevision: retained.viewRevision,
              bundleSha256: retained.bundleSha256,
              replayed: true,
            };
          }
          if (camera.configurationVersion !== change.input.expectedConfigurationVersion)
            conflict('Configuration version changed');
          if (camera.configurationVersion >= Number.MAX_SAFE_INTEGER)
            conflict('Configuration version exhausted');
          let cameraPolicy;
          let regionPolicies;
          let activatedRegion: CameraObservationRegionEntity | undefined;
          if (change.kind === 'INITIALIZE') {
            const [used] = await tx.query(
              "SELECT EXISTS(SELECT 1 FROM camera_configuration_bundle WHERE camera_id=$1 AND schema_version='2.0.0') AS present",
              [cameraId],
            );
            if (used.present) conflict('Camera PPE policies are already initialized');
            cameraPolicy = change.input.policy;
            regionPolicies = new Map(
              change.input.regionPolicies.map((binding) => [binding.regionId, binding.policy]),
            );
          } else {
            const [adopted] = await tx.query(
              "SELECT EXISTS(SELECT 1 FROM camera_configuration_bundle WHERE camera_id=$1 AND schema_version='2.0.0') AS present",
              [cameraId],
            );
            if (!adopted.present) conflict('Initialize camera PPE policies first');
            // An explicit camera-policy save can rebind a freshly reviewed source view.
            // The bundle builder below still rejects every stale/unconfirmed active polygon.
            const retained =
              change.kind === 'CAMERA'
                ? await (async () => {
                    const [header] = await tx.query(
                      `SELECT configuration_version,view_revision,bundle_sha256 FROM camera_configuration_bundle
                     WHERE camera_id=$1 AND site_id=$2 AND camera_external_id=$3
                       AND configuration_version <= $4 AND schema_version='2.0.0'
                     ORDER BY configuration_version DESC LIMIT 1`,
                      [camera.id, camera.siteId, camera.externalId, camera.configurationVersion],
                    );
                    if (!header) conflict('Saved camera PPE policy is unavailable');
                    const saved = await readStoredCameraPolicyBundle(tx, {
                      cameraId,
                      siteId,
                      cameraExternalId: camera.externalId,
                      configurationVersion: Number(header.configuration_version),
                      viewRevision: Number(header.view_revision),
                      bundleSha256: header.bundle_sha256,
                    });
                    if (!saved) conflict('Saved camera PPE policy is unavailable');
                    return saved;
                  })()
                : await readCurrentCameraPolicyBundle(tx, cameraId);
            cameraPolicy =
              change.kind === 'CAMERA' ? change.input.policy : retained.cameraPpePolicy;
            regionPolicies = new Map(
              retained.regions.map((region) => [region.regionId, region.ppePolicy]),
            );
            if (change.kind === 'REGION') {
              if (!regionPolicies.has(change.regionId)) missing();
              regionPolicies.set(change.regionId, change.input.policy);
            }
            if (change.kind === 'ACTIVATE_REGION') {
              const region = await tx
                .getRepository(CameraObservationRegionEntity)
                .findOneBy({ id: change.regionId, cameraId });
              if (!region) missing();
              if (region.isActive) conflict('Region is already active; use a policy update');
              if (region.version >= 2147483647) conflict('Region version exhausted');
              region.isActive = true;
              region.version += 1;
              await tx.getRepository(CameraObservationRegionEntity).save(region);
              activatedRegion = region;
              regionPolicies.set(region.id, change.input.policy);
            }
          }
          const active = await tx
            .getRepository(CameraObservationRegionEntity)
            .find({ where: { cameraId, isActive: true }, order: { id: 'ASC' }, take: 65 });
          if (
            active.length > 64 ||
            active.length !== regionPolicies.size ||
            active.some((region) => !regionPolicies.has(region.id))
          )
            conflict('Every active Region requires an explicit policy choice');
          camera.configurationVersion += 1;
          if (activatedRegion) await recordRegionRevision(tx, camera, activatedRegion, true);
          const geometry: CameraRegionConfiguration = {
            schemaVersion: '1.0.0',
            cameraExternalId: camera.externalId,
            configurationVersion: camera.configurationVersion,
            regions: active.map((region) => ({
              regionId: region.id,
              geometryVersion: region.version,
              coordinateSpace: region.coordinateSpace as 'NORMALIZED_0_1',
              polygon: region.polygon as CameraRegionConfiguration['regions'][number]['polygon'],
            })),
          };
          const base = await buildCameraConfigurationBundle(tx, camera, geometry, this.zones);
          if (!base) conflict('Camera view and every active Region must be confirmed');
          const content = {
            schemaVersion: '2.0.0',
            cameraId,
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
              ppePolicy: regionPolicies.get(region.regionId),
            })),
          };
          const hash = computeCanonicalPayloadHash(content);
          const parsed = parseCameraPolicyConfigurationBundlePayload(
            JSON.stringify({ ...content, bundleSha256: hash }),
          );
          if (!parsed.isValid || !parsed.value) conflict('Camera policy bundle is invalid');
          const bundle = parsed.value;
          await insertCameraPolicyBundle(tx, siteId, bundle, {
            commandId: change.input.commandId,
            actorUserId,
            requestHash,
          });
          await tx
            .getRepository(CameraEntity)
            .update(
              { id: cameraId, siteId },
              { configurationVersion: bundle.configurationVersion },
            );
          return {
            commandId: change.input.commandId,
            cameraId,
            configurationVersion: bundle.configurationVersion,
            viewRevision: bundle.viewRevision,
            bundleSha256: hash,
            replayed: false,
          };
        },
        siteManagerCommandAuthorization(siteId, actorUserId),
      );
    } catch (error) {
      knownUnique(error, ['uq_camera_bundle_command_id']);
    }
  }
}
