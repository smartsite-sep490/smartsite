import { randomUUID } from 'node:crypto';
import {
  computeCanonicalPayloadHash,
  type CameraPolicyConfigurationBundle,
  type PpeItem,
} from '@smartsite/contracts';
import type { DataSource } from 'typeorm';
import { seedTrackedFrameFixture } from './tracked-frame-fixture.js';
import { CameraPpePolicyStorage1795046400010 } from '../../src/database/migrations/1795046400010-CameraPpePolicyStorage.js';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../src/modules/cameras/camera-configuration-bundle-reader.js';
import { insertCameraPolicyBundle } from '../../src/modules/cameras/camera-policy-bundle-write.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';

/** Synthetic v2 issuance/ACK over retained original geometry; no physical capture or Worker identity. */
export async function upgradeTrackedFixtureToV2(
  db: DataSource,
  fixture: Awaited<ReturnType<typeof seedTrackedFrameFixture>>,
  requiredPpe: readonly PpeItem[],
  disabledRegionIds: readonly string[] = [],
) {
  await db.transaction((tx) => new CameraPpePolicyStorage1795046400010().up(tx.queryRunner!));
  const base = await db.transaction((tx) =>
    readHistoricalIssuedCameraBundleInTransaction(tx, {
      ...fixture.context,
      siteId: fixture.siteId,
      cameraExternalId: fixture.cameraId,
    }),
  );
  if (!base || base.schemaVersion !== '1.0.0') throw new Error('Synthetic legacy fixture missing');
  const content: Omit<CameraPolicyConfigurationBundle, 'bundleSha256'> = {
    schemaVersion: '2.0.0',
    cameraId: fixture.cameraId,
    cameraExternalId: fixture.cameraId,
    configurationVersion: 2,
    viewRevision: 1,
    issuedAt: new Date().toISOString(),
    cameraPpePolicy: { mode: 'DISABLED', reason: 'Synthetic Region policy fixture' },
    regions: base.regions.map((region) => ({
      regionId: region.regionId,
      geometryVersion: region.geometryVersion,
      coordinateSpace: region.coordinateSpace,
      polygon: region.polygon,
      zoneId: region.zoneId,
      policyRevision: region.policyRevision,
      ppePolicy: disabledRegionIds.includes(region.regionId)
        ? { mode: 'DISABLED', reason: 'Synthetic disabled overlapping Region' }
        : { mode: 'EXPLICIT', requiredPpe: [...requiredPpe].sort() },
    })),
  };
  const bundle = { ...content, bundleSha256: computeCanonicalPayloadHash(content) };
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [fixture.cameraId]);
    await tx.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [fixture.cameraId]);
    await insertCameraPolicyBundle(tx, fixture.siteId, bundle);
  });
  const commandId = randomUUID();
  await recordCameraConfigurationAcknowledgement(db, fixture.cameraId, fixture.generation.secret, {
    commandId,
    workerGenerationId: fixture.generation.workerGenerationId,
    streamSessionId: fixture.generation.streamSessionId,
    configurationVersion: 2,
    bundleSha256: bundle.bundleSha256,
    viewRevision: 1,
    outcome: 'LOADED',
  });
  Object.assign(fixture.context, {
    configurationVersion: 2,
    bundleSha256: bundle.bundleSha256,
    receiptCommandId: commandId,
  });
}
