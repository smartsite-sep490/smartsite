import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { Mf06AssessmentQueryService } from '../../src/modules/safety/assessments/mf06-assessment-query.service.js';
import { readMf06SubjectMedia } from '../../src/modules/safety/assessments/mf06-frame-media.reader.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('v1.4 parts enqueue distinct scoped MF06 assessments and bind uint64 JPEG/subject media', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const root = await mkdtemp(join(tmpdir(), 'mf06-part-assessment-'));
  try {
    await owned.initialize();
    const [{ schemaName }] = await db.query('SELECT current_schema() AS "schemaName"');
    assert.match(schemaName, /^isolated_test_[0-9a-f]{32}$/);
    console.info(`FRAME_TEST_SCHEMA:${schemaName}`);
    const siteId = randomUUID(),
      foreignSiteId = randomUUID(),
      cameraId = randomUUID(),
      zoneId = randomUUID();
    const sessionId = randomUUID(),
      frameId = randomUUID(),
      sequence = '18446744073709551615';
    const regionIds = [randomUUID(), randomUUID()],
      now = new Date();
    await db.getRepository(SiteEntity).save([
      { id: siteId, code: 'PART-ASSESSMENT', name: 'Part assessment Site' },
      { id: foreignSiteId, code: 'OTHER-ASSESSMENT', name: 'Other Site' },
    ]);
    await db.getRepository(CameraEntity).save({
      id: cameraId,
      siteId,
      externalId: 'PART-ASSESSMENT',
      code: 'PART-CAM',
      name: 'Part camera',
    });
    await db.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: 'PART-ZONE',
      name: 'Part Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    });
    for (const id of regionIds)
      await db.getRepository(CameraObservationRegionEntity).save({
        id,
        cameraId,
        zoneId,
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
      });
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#426580' },
    })
      .jpeg()
      .toBuffer();
    const sha256 = createHash('sha256').update(jpeg).digest('hex');
    const config = createTestConfig({
      AI_PARTITIONED_FRAME_ENABLED: 'true',
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
      MF06_ASSESSMENT_READ_ENABLED: 'true',
      EVIDENCE_LOCAL_ROOT: root,
    });
    const service = new AiIngestionService(
      db,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(config, new SchedulingNotificationService(db)),
      config,
      () => now,
      undefined,
      new Mf06IngestionEnqueueService(db, config),
    );
    const events = regionIds.map((regionId, partIndex) => {
      const eventId = randomUUID();
      return {
        schemaVersion: '1.4.0',
        eventId,
        cameraExternalId: 'PART-ASSESSMENT',
        streamSessionId: sessionId,
        capturedAt: now.toISOString(),
        frameDimensions: { width: 16, height: 16 },
        framePartition: { frameId, sequenceNumber: sequence, partIndex, partCount: 2 },
        observations: [
          {
            type: 'PERSON',
            trackId: 7,
            boundingBox: {
              x1: 0.25,
              y1: 0.25,
              x2: 0.75,
              y2: 0.75,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
          { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 1 },
        ],
        evidence: [
          {
            kind: 'FRAME',
            uri: `local://evidence/${sessionId}/${sequence}/${eventId}.jpg`,
            sha256,
          },
        ],
      };
    });
    for (const event of events)
      await writeFile(join(root, `${sessionId}_${sequence}_${event.eventId}.jpg`), jpeg);
    assert.equal((await service.ingestEvent(events[1]!)).status, 'SKIPPED_NO_CANDIDATE');
    const conflictingImage = {
      ...events[0]!,
      evidence: events[0]!.evidence.map((item) => ({ ...item, sha256: 'b'.repeat(64) })),
    };
    await assert.rejects(
      service.ingestEvent(conflictingImage),
      (error: unknown) => (error as { getStatus(): number }).getStatus() === 409,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM ai_observation_event'))[0].n),
      1,
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM zone_entry_assessment_job'))[0].n),
      1,
    );
    const requests = await db.query(
      'SELECT request_id,event_id,binding_hash FROM zone_entry_assessment_request ORDER BY request_id',
    );
    assert.equal(requests.length, 1);
    assert.equal((await service.ingestEvent(events[1]!)).status, 'DUPLICATE_ACCEPTED');
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM zone_entry_assessment_job'))[0].n),
      1,
    );
    const leases = new Mf06JobLeaseService(db, {
      leaseSeconds: 30,
      maxAttempts: 3,
      retryDelaySeconds: 1,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const claim = await leases.claim();
      assert(claim);
      const context = await new Mf06ClaimContextReader(db).readForClaim(claim);
      assert.equal(context.status, 'MATCHED');
      if (context.status !== 'MATCHED') throw new Error('Missing scoped claim context');
      assert(context.frameReference && context.subject);
      const eventId = context.request.eventId;
      seen.add(eventId);
      assert.equal(context.frameReference.eventId, eventId);
      assert.equal(context.frameReference.sequenceNumber, sequence);
      assert.equal(context.frameReference.framePartition?.frameId, frameId);
      const crop = await readMf06SubjectMedia(root, context.frameReference, context.subject);
      assert.equal(crop?.frameSha256, sha256);
      assert.deepEqual(crop?.rectangle, { left: 4, top: 4, width: 8, height: 8 });
      const final = await new Mf06AssessmentStore(db).finalize({
        claim: {
          requestId: claim.requestId,
          leaseToken: claim.leaseToken,
          headRevision: claim.headRevision,
        },
        commandId: claim.requestId,
        siteId,
        bindingHash: context.request.storedBindingHash,
        evaluatorVersion: 'mf06-workport-qualified-v1',
        outcome: 'UNAVAILABLE',
        reasonCode: 'SERVICE_DISABLED',
        provenance: 'UNAVAILABLE',
        workerId: null,
        profileRevision: null,
        frameSha256: sha256,
        cropSha256: crop!.cropSha256,
        authorityArtifact: null,
      });
      assert.equal(final.state, 'RECORDED');
      if (final.state !== 'RECORDED') throw new Error('Missing finalized assessment');
      const queries = new Mf06AssessmentQueryService(db, config);
      const assessmentId = final.assessment.assessmentId;
      const before = await queries.get(siteId, assessmentId);
      assert.deepEqual(before.frameDelivery, {
        frameId,
        sequenceNumber: sequence,
        partCount: 2,
        receivedParts: i === 0 ? 1 : 2,
        status: i === 0 ? 'PARTIAL' : 'COMPLETE',
      });
      assert.equal(before.outcome, 'UNAVAILABLE');
      if (i === 0) {
        assert.equal((await queries.list(siteId)).items[0]?.frameDelivery?.status, 'PARTIAL');
        assert.equal((await service.ingestEvent(events[0]!)).status, 'SKIPPED_NO_CANDIDATE');
        assert.equal((await queries.get(siteId, assessmentId)).frameDelivery?.status, 'COMPLETE');
        assert.equal((await queries.list(siteId)).items[0]?.frameDelivery?.receivedParts, 2);
        assert.equal((await service.ingestEvent(events[0]!)).status, 'DUPLICATE_ACCEPTED');
        await assert.rejects(queries.get(foreignSiteId, assessmentId));
      }
      const expected = { requestId: claim.requestId, eventId };
      const frame = await queries.readFrame(siteId, final.assessment.assessmentId, expected);
      assert.equal(frame.sha256, sha256);
      await assert.rejects(
        queries.readFrame(foreignSiteId, final.assessment.assessmentId, expected),
      );
      await assert.rejects(
        queries.readFrame(siteId, final.assessment.assessmentId, {
          ...expected,
          eventId: events.find((event) => event.eventId !== eventId)!.eventId,
        }),
      );
    }
    assert.deepEqual(seen, new Set(events.map((event) => event.eventId)));
    const queries = new Mf06AssessmentQueryService(db, config);
    const complete = await queries.list(siteId);
    assert.equal(complete.items.length, 2);
    assert(complete.items.every((item) => item.frameDelivery?.status === 'COMPLETE'));
    await assert.rejects(
      db.query('UPDATE ai_observation_event SET payload_hash=$2 WHERE event_id=$1', [
        events[0]!.eventId,
        'c'.repeat(64),
      ]),
      (error: unknown) => (error as { code: string }).code === '23514',
    );
    assert.equal(
      (await queries.get(siteId, complete.items[0]!.assessmentId)).frameDelivery?.status,
      'COMPLETE',
    );
    assert.equal(
      Number((await db.query('SELECT count(*) AS n FROM zone_entry_assessment'))[0].n),
      2,
    );
  } finally {
    await owned.dispose();
  }
});
