import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  computeCanonicalPayloadHash,
  type CameraPolicyConfigurationBundle,
} from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { CameraPpePolicyStorage1795046400010 } from '../../src/database/migrations/1795046400010-CameraPpePolicyStorage.js';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../src/modules/cameras/camera-configuration-bundle-reader.js';
import { insertCameraPolicyBundle } from '../../src/modules/cameras/camera-policy-bundle-write.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { TrackedPpeInboxProjection } from '../../src/modules/safety/alerts/tracked-ppe-inbox-projection.js';

for (const variant of ['uppercase-region', 'disabled-overlap'] as const)
  test(`v2 tracked PPE ${variant} preserves revision and original policy scope`, async () => {
    const owned = createIsolatedTestDatabase(),
      db = owned.dataSource;
    try {
      await owned.initialize();
      await db.transaction(async (tx) => {
        await new WorkerEventAdmission1795046400002().up(tx.queryRunner!);
        await new TrackedSubjectStorage1795046400003().up(tx.queryRunner!);
        await new CameraPpePolicyStorage1795046400010().up(tx.queryRunner!);
      });
      const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
      const legacy = await db.transaction((tx) =>
        readHistoricalIssuedCameraBundleInTransaction(tx, {
          ...f.context,
          siteId: f.siteId,
          cameraExternalId: f.cameraId,
        }),
      );
      assert.ok(legacy && legacy.schemaVersion === '1.0.0');
      const content = {
        schemaVersion: '2.0.0' as const,
        cameraId: f.cameraId,
        cameraExternalId: f.cameraId,
        configurationVersion: 2,
        viewRevision: 1,
        issuedAt: new Date().toISOString(),
        cameraPpePolicy: { mode: 'DISABLED' as const, reason: 'Synthetic test uses Region policy' },
        regions: legacy.regions.map((region) => ({
          regionId: region.regionId,
          geometryVersion: region.geometryVersion,
          coordinateSpace: region.coordinateSpace,
          polygon: region.polygon,
          zoneId: region.zoneId,
          policyRevision: region.policyRevision,
          ppePolicy:
            region.regionId === f.ppeRegionId
              ? { mode: 'EXPLICIT' as const, requiredPpe: ['HARD_HAT' as const] }
              : { mode: 'DISABLED' as const, reason: 'Synthetic disabled overlap' },
        })),
      };
      const bundle: CameraPolicyConfigurationBundle = {
        ...content,
        bundleSha256: computeCanonicalPayloadHash(content),
      };
      await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [f.cameraId]);
        await tx.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [f.cameraId]);
        await insertCameraPolicyBundle(tx, f.siteId, bundle);
      });
      const receiptCommandId = randomUUID();
      await recordCameraConfigurationAcknowledgement(db, f.cameraId, f.generation.secret, {
        commandId: receiptCommandId,
        workerGenerationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
        configurationVersion: 2,
        bundleSha256: bundle.bundleSha256,
        viewRevision: 1,
        outcome: 'LOADED',
      });
      const context = {
        ...f.context,
        configurationVersion: 2,
        bundleSha256: bundle.bundleSha256,
        receiptCommandId,
      };
      const recipient = randomUUID();
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Officer','not-a-login-hash')",
        [recipient],
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
        [randomUUID(), recipient, f.siteId],
      );
      const auth = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
        profileSha256: 'a'.repeat(64),
        allowedCameraIds: [f.cameraId],
        clockToleranceMs: 1000,
        routeEpoch: '00000000-0000-4000-8000-000000000001',
      });
      const store = new TrackedFramePrototypeStore(auth, {
        pendingTtlMs: 30000,
        maxPendingFrames: 16,
        maxPendingParts: 32,
        maxPendingPayloadBytes: 100000,
      });
      const projection = new TrackedPpeInboxProjection(db, { maxRecipients: 8 });
      const admission = new TrackedFrameAdmission(
        auth,
        {
          firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
          maxCaptureGapMs: 10000,
          maxSourceSequenceGap: '1',
          maxSegmentRows: 32,
        },
        {
          async project(tx, frame) {
            await projection.projectFrame(tx, {
              siteId: frame.scope.siteId,
              cameraId: frame.scope.cameraId,
              scopeSha256: frame.scope.scopeSha256,
              coordinatorEventId: frame.coordinatorEventId,
            });
          },
        },
      );
      const segmentId = randomUUID();
      const event = (sequence: string, previous?: string, outside = false) => {
        const base = f.event(0, 1, sequence);
        const ids =
          sequence === '1' && variant === 'disabled-overlap' ? f.ppeRegionIds : [f.ppeRegionId!];
        return {
          ...base,
          observations: [
            {
              type: 'PERSON',
              trackId: 7,
              boundingBox: {
                coordinateSpace: 'NORMALIZED_0_1',
                x1: 0.3,
                y1: 0.2,
                x2: 0.6,
                y2: outside ? 0.95 : 0.7,
              },
            },
            ...ids.map((regionId) => ({
              type: 'PPE',
              trackId: 7,
              ppeItem: 'HARD_HAT',
              status: 'MISSING',
              regionId:
                sequence === '1' && variant === 'uppercase-region'
                  ? regionId.toUpperCase()
                  : regionId,
              geometryVersion: 1,
            })),
          ],
          continuity: {
            ...base.continuity,
            subjects: [
              {
                personObservationIndex: 0,
                segmentId,
                link: previous
                  ? {
                      kind: 'CONTINUE',
                      previousEventId: previous,
                      previousPersonObservationIndex: 0,
                    }
                  : { kind: 'START', reason: 'INITIAL' },
              },
            ],
          },
        };
      };
      const process = async (raw: ReturnType<typeof event>) => {
        await store.store(db, raw, context, f.generation.secret);
        return admission.process(
          db,
          {
            cameraId: f.cameraId,
            generationId: f.generation.workerGenerationId,
            streamSessionId: f.generation.streamSessionId,
            frameId: raw.framePartition.frameId,
          },
          f.generation.secret,
        );
      };
      const first = event('0');
      await process(first);
      await db.query(
        'UPDATE safety_episode_recipient SET seen_revision=1 WHERE recipient_user_id=$1',
        [recipient],
      );
      const second = event('1', first.eventId);
      await process(second);
      assert.deepEqual(await db.query('SELECT content_revision FROM safety_episode'), [
        { content_revision: 1 },
      ]);
      assert.deepEqual(
        await db.query(
          'SELECT seen_revision FROM safety_episode_recipient WHERE recipient_user_id=$1',
          [recipient],
        ),
        [{ seen_revision: 1 }],
      );
      assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n, 1);
      const outside = event('2', second.eventId, true);
      await assert.rejects(process(outside), /TRACKED_PPE_PROJECTION_UNAVAILABLE/);
      assert.deepEqual(await db.query('SELECT content_revision FROM safety_episode'), [
        { content_revision: 1 },
      ]);
    } finally {
      await owned.dispose();
    }
  });
