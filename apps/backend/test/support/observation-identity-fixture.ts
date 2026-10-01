import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import {
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  AlertStatus,
  AlertType,
  CameraEntity,
  EventProcessingStatus,
  SafetyAlertEntity,
  SiteEntity,
  UserEntity,
  WorkerEntity,
} from '../../src/database/entities/index.js';
import { ObservationIdentityResolutionService } from '../../src/modules/safety/identity/observation-identity-resolution.service.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { createTestConfig } from './config.js';
import dataSource from './test-data-source.js';

export async function observationIdentityFixture() {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID(),
    otherSiteId = randomUUID(),
    eventId = randomUUID(),
    cameraId = randomUUID(),
    sessionId = randomUUID();
  const alertIds = [randomUUID(), randomUUID()],
    actorIds = [randomUUID(), randomUUID()],
    workerIds = [randomUUID(), randomUUID()];
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-audit-'));
  const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
  const filePath = join(root, `${sessionId}_1_${eventId}.jpg`);
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: `CAM-${cameraId}`,
    streamSessionId: sessionId,
    capturedAt: '2026-10-01T00:00:00Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [7, 8].map((trackId) => ({
      type: 'PERSON',
      trackId,
      boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
    })),
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/1/${eventId}.jpg` }],
  };
  const hash = computeCanonicalPayloadHash(raw);
  await dataSource
    .getRepository(SiteEntity)
    .insert([siteId, otherSiteId].map((id) => ({ id, code: `S-${id}`, name: 'Synthetic Site' })));
  await dataSource.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: raw.cameraExternalId,
    code: `C-${cameraId}`,
    name: 'Synthetic Camera',
  });
  await dataSource.getRepository(UserEntity).insert(
    actorIds.map((id) => ({
      id,
      username: `actor-${id.slice(0, 8)}`,
      displayName: 'Synthetic Reviewer',
      passwordHash: 'fixture-not-authenticating',
      isActive: true,
      mustChangePassword: false,
    })),
  );
  await dataSource.getRepository(WorkerEntity).insert(
    workerIds.map((id, i) => ({
      id,
      siteId,
      externalId: `W-${i}`,
      displayName: `Synthetic Worker ${i}`,
      isActive: true,
    })),
  );
  await dataSource.getRepository(SafetyAlertEntity).insert(
    alertIds.map((id) => ({
      id,
      siteId,
      alertType: AlertType.PPE_VIOLATION,
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      groupingKey: `audit-${id}`,
      status: AlertStatus.CLOSED,
      firstDetectedAt: new Date(raw.capturedAt),
      lastDetectedAt: new Date(raw.capturedAt),
    })),
  );
  await dataSource.getRepository(AiObservationEventEntity).insert({
    eventId,
    payloadHash: hash,
    cameraExternalId: raw.cameraExternalId,
    resolvedCameraId: cameraId,
    streamSessionId: sessionId,
    capturedAt: new Date(raw.capturedAt),
    rawPayload: raw,
    processingStatus: EventProcessingStatus.PROCESSED,
  });
  await dataSource
    .getRepository(AlertDetectionMappingEntity)
    .insert(alertIds.map((alertId) => ({ alertId, eventId })));
  await writeFile(filePath, jpeg);
  const evidence = new SafetyAlertEvidenceService(
    dataSource,
    createTestConfig({ EVIDENCE_LOCAL_ROOT: root }),
  );
  // Test-only authority reader. Production adapter stays unavailable until owner handoff.
  const reader = {
    async findForReview(manager: EntityManager, scope: string, id: string, lock: boolean) {
      const query = manager
        .getRepository(WorkerEntity)
        .createQueryBuilder('worker')
        .where('worker.id = :id', { id })
        .andWhere('worker.siteId = :scope', { scope });
      if (lock) query.setLock('pessimistic_write');
      return query.getOne();
    },
    async listForReview() {
      return { items: [], total: 0 };
    },
  };
  const service = new ObservationIdentityResolutionService(dataSource, evidence, reader);
  const resolve = (revision = 0, workerId = workerIds[0]!) => ({
    commandId: randomUUID(),
    expectedRevision: revision,
    expectedEventHash: hash,
    action: 'RESOLVE' as const,
    reason: 'Explicit synthetic person review.',
    workerId,
    evidenceIndex: 0,
    expectedEvidenceSha256: createHash('sha256').update(jpeg).digest('hex'),
  });
  const decide = (input: unknown, index = 0, actor = actorIds[0]!, alert = alertIds[0]!) =>
    service.decide(siteId, alert, eventId, index, actor, input);
  return {
    siteId,
    otherSiteId,
    eventId,
    alertIds,
    actorIds,
    workerIds,
    service,
    evidence,
    reader,
    resolve,
    decide,
    hash,
    raw,
    filePath,
    async cleanup() {
      // Dedicated validated synthetic test database only; never a runtime/Neon connection.
      await dataSource.query(
        'TRUNCATE observation_identity_decision, observation_identity_resolution',
      );
      await dataSource.getRepository(AlertDetectionMappingEntity).delete({ eventId });
      await dataSource.getRepository(SafetyAlertEntity).delete(alertIds);
      await dataSource.getRepository(AiObservationEventEntity).delete({ eventId });
      await dataSource.getRepository(WorkerEntity).delete(workerIds);
      await dataSource.getRepository(UserEntity).delete(actorIds);
      await dataSource.getRepository(CameraEntity).delete({ id: cameraId });
      await dataSource.getRepository(SiteEntity).delete([siteId, otherSiteId]);
      const cleanupPath = resolvePath(root);
      if (
        dirname(cleanupPath).toLowerCase() !== resolvePath(tmpdir()).toLowerCase() ||
        !basename(cleanupPath).startsWith('smartsite-identity-audit-')
      )
        throw new Error('Refusing cleanup outside the owned identity fixture directory');
      await rm(cleanupPath, { recursive: true, force: true });
    },
  };
}
