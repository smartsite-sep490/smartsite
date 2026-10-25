import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import {
  AuthClientType,
  CameraEntity,
  CameraObservationRegionEntity,
  CameraStatus,
  EventProcessingStatus,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('MF06 historical assessment frame HTTP enforces Site scope, exact requestId+eventId query binding, and frame SHA integrity', async (t) => {
  const owned = createIsolatedTestDatabase();
  const schema = String((owned.dataSource.options as { schema: string }).schema);
  t.diagnostic(`ownedMf06FrameSchema=${schema}`);

  const evidenceRoot = await mkdtemp(join(tmpdir(), 'smartsite-mf06-frame-http-'));
  const createdFiles: string[] = [];
  let app: NestExpressApplication | undefined;

  try {
    await owned.initialize();
    const db = owned.dataSource;

    const siteId = randomUUID();
    const foreignSiteId = randomUUID();
    const cameraId = randomUUID();
    const externalId = `cam-mf06-frame-${randomUUID().slice(0, 8)}`;
    const zoneId = randomUUID();
    const regionId = randomUUID();
    const officerId = randomUUID();
    const foreignOfficerId = randomUUID();
    const password = 'SyntheticOfficerPassword1!';
    const passwordHash = await hashPassword(password);

    await db.transaction(async (manager) => {
      await manager.getRepository(SiteEntity).insert([
        { id: siteId, code: `S1-${siteId.slice(0, 6)}`, name: 'Primary MF06 Evidence Site' },
        { id: foreignSiteId, code: `S2-${foreignSiteId.slice(0, 6)}`, name: 'Foreign Site' },
      ]);
      await manager.getRepository(CameraEntity).insert({
        id: cameraId,
        siteId,
        externalId,
        code: `CAM-${cameraId.slice(0, 6)}`,
        name: 'Primary MF06 Gate Camera',
        status: CameraStatus.ACTIVE,
      });
      await manager.getRepository(ZoneEntity).insert({
        id: zoneId,
        siteId,
        code: `Z-${zoneId.slice(0, 6)}`,
        name: 'Restricted Assessment Zone',
        type: ZoneType.RESTRICTED,
        restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      });
      await manager.getRepository(CameraObservationRegionEntity).insert({
        id: regionId,
        cameraId,
        zoneId,
        polygon: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
      });
      await manager.getRepository(UserEntity).insert([
        {
          id: officerId,
          username: `officer.${officerId.slice(0, 8)}@smartsite.local`,
          displayName: 'Site 1 Safety Officer',
          passwordHash,
          isActive: true,
          mustChangePassword: false,
        },
        {
          id: foreignOfficerId,
          username: `officer.${foreignOfficerId.slice(0, 8)}@smartsite.local`,
          displayName: 'Site 2 Safety Officer',
          passwordHash,
          isActive: true,
          mustChangePassword: false,
        },
      ]);
      await manager.getRepository(UserRoleAssignmentEntity).insert([
        { id: randomUUID(), userId: officerId, role: UserRole.SAFETY_OFFICER, siteId },
        {
          id: randomUUID(),
          userId: foreignOfficerId,
          role: UserRole.SAFETY_OFFICER,
          siteId: foreignSiteId,
        },
      ]);
    });

    const eventId = randomUUID();
    const streamSessionId = randomUUID();
    const capturedAt = '2026-10-21T12:00:00.000Z';
    const jpegBytes = await sharp({
      create: { width: 16, height: 12, channels: 3, background: { r: 24, g: 96, b: 180 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const frameSha256 = createHash('sha256').update(jpegBytes).digest('hex');
    const framePath = join(evidenceRoot, `${streamSessionId}_0_${eventId}.jpg`);
    await writeFile(framePath, jpegBytes);
    createdFiles.push(framePath);

    const config = createTestConfig({
      MF06_ENQUEUE_ENABLED: 'true',
      MF06_ENQUEUE_MAX_OUTSTANDING: '100',
      MF06_ASSESSMENT_READ_ENABLED: 'true',
      MF06_WORKER_ENABLED: 'false',
      EVIDENCE_LOCAL_ROOT: evidenceRoot,
      LOG_FORMAT: 'json',
      HTTP_RATE_LIMIT_LIMIT: '1000',
    });

    const ingestion = new AiIngestionService(
      db,
      new ObservationContextResolverService(),
      new AlertCandidateEvaluator(),
      new DurableGroupingService(config, new SchedulingNotificationService(db)),
      config,
      () => new Date(capturedAt),
      new ZoneEntryAuthorizationService(),
      new Mf06IngestionEnqueueService(db, config),
    );

    const ingestResult = await ingestion.ingestEvent({
      schemaVersion: '1.2.0',
      eventId,
      cameraExternalId: externalId,
      streamSessionId,
      capturedAt,
      frameDimensions: { width: 16, height: 12 },
      observations: [
        {
          type: 'PERSON',
          trackId: 7,
          confidence: 0.96,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
        },
        { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 1, confidence: 0.94 },
      ],
      evidence: [
        {
          kind: 'FRAME',
          uri: `local://evidence/${streamSessionId}/0/${eventId}.jpg`,
          sha256: frameSha256,
        },
      ],
    });
    assert.ok(
      [EventProcessingStatus.PROCESSED, EventProcessingStatus.SKIPPED_NO_CANDIDATE].some(
        (status) => status === ingestResult.status,
      ),
    );

    const [requestRow] = (await db.query(
      'SELECT r.request_id, r.binding_hash, j.status FROM zone_entry_assessment_request r JOIN zone_entry_assessment_job j ON j.request_id = r.request_id WHERE r.event_id = $1 AND r.site_id = $2',
      [eventId, siteId],
    )) as { request_id: string; binding_hash: string; status: string }[];
    assert.ok(requestRow);
    assert.equal(requestRow.status, 'PENDING');

    const leases = new Mf06JobLeaseService(db, {
      leaseSeconds: 30,
      maxAttempts: 3,
      retryDelaySeconds: 5,
    });
    const claim = await leases.claim();
    assert.ok(claim);
    assert.equal(claim.requestId, requestRow.request_id);

    const finalized = await new Mf06AssessmentStore(db).finalize({
      claim: {
        requestId: claim.requestId,
        leaseToken: claim.leaseToken,
        headRevision: claim.headRevision,
      },
      commandId: claim.requestId,
      siteId,
      bindingHash: requestRow.binding_hash,
      evaluatorVersion: 'mf06-workport-qualified-v1',
      outcome: 'UNAVAILABLE',
      reasonCode: 'SERVICE_DISABLED',
      provenance: 'UNAVAILABLE',
      workerId: null,
      profileRevision: null,
      frameSha256: null,
      cropSha256: null,
      authorityArtifact: null,
    });
    assert.equal(finalized.state, 'RECORDED');
    const assessmentId = finalized.assessment.assessmentId;

    const [persistedAssessment] = (await db.query(
      'SELECT assessment_id, outcome, reason_code, provenance FROM zone_entry_assessment WHERE assessment_id = $1 AND site_id = $2',
      [assessmentId, siteId],
    )) as {
      assessment_id: string;
      outcome: string;
      reason_code: string;
      provenance: string;
    }[];
    assert.deepEqual(persistedAssessment, {
      assessment_id: assessmentId,
      outcome: 'UNAVAILABLE',
      reason_code: 'SERVICE_DISABLED',
      provenance: 'UNAVAILABLE',
    });

    // Test-only provider overrides bind AppModule HTTP to this isolated schema and test config.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(db)
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();

    const auth = app.get(AuthService);
    const officerUser = await db.getRepository(UserEntity).findOneByOrFail({ id: officerId });
    const foreignUser = await db
      .getRepository(UserEntity)
      .findOneByOrFail({ id: foreignOfficerId });
    const officerSession = await auth.login(officerUser.username, password, AuthClientType.WEB);
    const foreignSession = await auth.login(foreignUser.username, password, AuthClientType.WEB);

    const frameUrl = (
      targetSiteId = siteId,
      targetAssessmentId = assessmentId,
      query = `requestId=${claim.requestId}&eventId=${eventId}`,
    ) =>
      `${baseUrl}/api/v1/sites/${targetSiteId}/mf06-assessments/${targetAssessmentId}/frame${query ? `?${query}` : ''}`;

    assert.equal((await fetch(frameUrl())).status, 401);
    assert.equal(
      (
        await fetch(frameUrl(), {
          headers: { Authorization: `Bearer ${foreignSession.accessToken}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(frameUrl(foreignSiteId), {
          headers: { Authorization: `Bearer ${officerSession.accessToken}` },
        })
      ).status,
      403,
    );

    const authHeaders = { Authorization: `Bearer ${officerSession.accessToken}` };
    for (const badQuery of [
      '',
      `requestId=${claim.requestId}`,
      `eventId=${eventId}`,
      `requestId=${claim.requestId}&eventId=${eventId}&extra=1`,
      `requestId=${claim.requestId}&eventId=${eventId}&frameSha256=${frameSha256}`,
    ]) {
      const badRes = await fetch(frameUrl(siteId, assessmentId, badQuery), {
        headers: authHeaders,
      });
      assert.equal(badRes.status, 400, `Expected 400 for query "${badQuery}"`);
    }

    for (const [badAssessmentId, badQuery] of [
      [randomUUID(), `requestId=${claim.requestId}&eventId=${eventId}`],
      [assessmentId, `requestId=${randomUUID()}&eventId=${eventId}`],
      [assessmentId, `requestId=${claim.requestId}&eventId=${randomUUID()}`],
    ] as const) {
      const notFoundRes = await fetch(frameUrl(siteId, badAssessmentId, badQuery), {
        headers: authHeaders,
      });
      assert.equal(notFoundRes.status, 404);
    }

    const okRes = await fetch(frameUrl(), { headers: authHeaders });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('cache-control'), 'private, no-store');
    assert.equal(okRes.headers.get('x-content-type-options'), 'nosniff');
    assert.match(okRes.headers.get('content-type') ?? '', /^image\/jpeg\b/);
    assert.deepEqual(Buffer.from(await okRes.arrayBuffer()), jpegBytes);

    const mutatedJpeg = await sharp({
      create: { width: 16, height: 12, channels: 3, background: { r: 210, g: 20, b: 40 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    assert.notEqual(createHash('sha256').update(mutatedJpeg).digest('hex'), frameSha256);
    await writeFile(framePath, mutatedJpeg);
    assert.equal((await fetch(frameUrl(), { headers: authHeaders })).status, 404);
  } finally {
    if (app) await app.close();
    await owned.dispose();
    for (const file of createdFiles) await unlink(file).catch(() => undefined);
    await rmdir(evidenceRoot).catch(() => undefined);
  }
});
