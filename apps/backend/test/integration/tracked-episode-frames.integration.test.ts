import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from '../../src/common/http/http-exception.filter.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { createTestConfig } from '../support/config.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { TrackedPpeEpisodeProjection } from '../../src/modules/safety/alerts/tracked-ppe-episode-projection.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { readMf06FrameMedia } from '../../src/modules/safety/assessments/mf06-frame-media.reader.js';

test('tracked finding pages and JPEG reads retain exact original sources and recheck real account/session scope after IO', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const root = await mkdtemp(join(tmpdir(), 'smartsite-tracked-frames-'));
  let httpApp: NestExpressApplication | undefined;
  try {
    await owned.initialize();

    const f = await seedTrackedFrameFixture(db, ['HARD_HAT', 'SAFETY_VEST']);
    const actor = randomUUID(),
      session = randomUUID(),
      role = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic reader','synthetic-non-login-hash')",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [role, actor, f.siteId],
    );
    await db.query(
      `INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,last_refreshed_at,expires_at)
      VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [session, actor, 'a'.repeat(64)],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const { accessToken } = await tokens.issueAccessToken(actor, session);
    const guard = new UserAuthGuard(new AuthService(db, tokens));
    const request = (): AuthenticatedRequest => ({
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const { SafetyEpisodeInboxService } =
      await import('../../src/modules/safety/alerts/safety-episode-inbox.service.js');
    const inbox = new SafetyEpisodeInboxService(db, guard);
    // Existing EVENT_LOCAL-only schema has no candidate columns: list still executes safely.
    assert.equal((await inbox.list(request(), { siteId: f.siteId })).total, 0);
    await db.transaction((m) => new TrackedSubjectStorage1795046400003().up(m.queryRunner!));
    const authenticator = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [f.cameraId],
      clockToleranceMs: 1000,
      routeEpoch: '00000000-0000-4000-8000-000000000001',
    });
    const store = new TrackedFramePrototypeStore(authenticator, {
      pendingTtlMs: 30000,
      maxPendingFrames: 16,
      maxPendingParts: 32,
      maxPendingPayloadBytes: 100000,
    });
    const projection = new TrackedPpeEpisodeProjection(db);
    const admission = new TrackedFrameAdmission(
      authenticator,
      {
        firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
        maxCaptureGapMs: 10000,
        maxSourceSequenceGap: '1',
        maxSegmentRows: 32,
      },
      {
        async project(m, frame) {
          await projection.projectFrame(m, {
            siteId: f.siteId,
            cameraId: f.cameraId,
            scopeSha256: frame.scope.scopeSha256,
            coordinatorEventId: frame.coordinatorEventId,
          });
        },
      },
    );
    const segmentId = randomUUID();
    const emit = async (
      sequence: string,
      ppeItem: string,
      trackId: number,
      previousEventId?: string,
    ) => {
      const base = f.event(0, 1, sequence);
      const bytes = await sharp({
        create: {
          width: 120,
          height: 80,
          channels: 3,
          background: previousEventId ? '#dd8822' : '#336699',
        },
      })
        .jpeg()
        .toBuffer();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const payload = {
        ...base,
        observations: [
          {
            type: 'PERSON',
            trackId,
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
          },
          {
            type: 'PPE',
            trackId,
            ppeItem,
            status: 'MISSING',
            regionId: f.ppeRegionId!,
            geometryVersion: 1,
          },
        ],
        evidence: [
          {
            kind: 'FRAME',
            uri: `local://evidence/${f.generation.streamSessionId}/${sequence}/${base.eventId}.jpg`,
            sha256,
          },
        ],
        continuity: {
          ...base.continuity,
          subjects: [
            {
              personObservationIndex: 0,
              segmentId,
              link: previousEventId
                ? { kind: 'CONTINUE', previousEventId, previousPersonObservationIndex: 0 }
                : { kind: 'START', reason: 'INITIAL' },
            },
          ],
        },
      };
      const file = join(root, `${f.generation.streamSessionId}_${sequence}_${base.eventId}.jpg`);
      await writeFile(file, bytes);
      await store.store(db, payload, f.context, f.generation.secret);
      assert.equal(
        (
          await admission.process(
            db,
            {
              cameraId: f.cameraId,
              generationId: f.generation.workerGenerationId,
              streamSessionId: f.generation.streamSessionId,
              frameId: base.framePartition.frameId,
            },
            f.generation.secret,
          )
        ).kind,
        'SEALED',
      );
      return { payload, bytes, file, sha256 };
    };
    const first = await emit('9007199254740993', 'HARD_HAT', 1);
    const later = await emit('9007199254740994', 'SAFETY_VEST', 99, first.payload.eventId);
    const [{ id: episodeId }] = await db.query(
      'SELECT id FROM safety_episode WHERE tracking_segment_id=$1',
      [segmentId],
    );

    await db.query(
      'INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), episodeId, f.siteId, actor],
    );

    const inboxPage = await inbox.list(request(), { siteId: f.siteId });
    assert.equal(inboxPage.items.length, 1);
    assert.deepEqual(inboxPage.items[0]!.episode.subject, {
      kind: 'TRACKED',
      segmentId,
      scopeSha256: (
        await db.query('SELECT tracking_scope_sha256 AS scope FROM safety_episode WHERE id=$1', [
          episodeId,
        ])
      )[0].scope,
    });
    const { TrackedEpisodeFrameQuery } =
      await import('../../src/modules/safety/alerts/tracked-episode-frame-query.js');
    const reader = new TrackedEpisodeFrameQuery(db, guard, root);
    const page = await reader.pageObservations(request(), f.siteId, episodeId, { limit: 1 });
    assert.equal(page.total, 2);
    assert.equal(page.hasMore, true);
    assert.equal(page.throughSequence, '9007199254740994');
    assert.equal(page.items[0]!.eventId, later.payload.eventId);
    await emit('9007199254740995', 'HARD_HAT', 500, later.payload.eventId);
    const second = await reader.pageObservations(request(), f.siteId, episodeId, {
      offset: 1,
      limit: 1,
      throughSequence: page.throughSequence,
    });
    assert.equal(second.hasMore, false);
    assert.equal(second.total, 2); // Appending frames cannot shift a fenced historical page.
    assert.equal(second.items[0]!.eventId, first.payload.eventId);
    assert.equal(second.items[0]!.sourceSequence, '9007199254740993');
    assert.ok(!JSON.stringify([page, second]).includes('local://'));
    const source = {
      alertId: page.items[0]!.alertId,
      eventId: later.payload.eventId,
      personObservationIndex: 0,
      evidenceIndex: 0,
    };
    const content = await reader.read(request(), f.siteId, episodeId, source);
    assert.deepEqual(content.bytes, later.bytes);
    assert.equal(content.frameSha256, later.sha256);
    const { TrackedEpisodeFramesController } =
      await import('../../src/modules/safety/alerts/tracked-episode-frames.controller.js');
    const { SafetyEpisodeInboxController } =
      await import('../../src/modules/safety/alerts/safety-episode-inbox.controller.js');
    const module = await Test.createTestingModule({
      controllers: [TrackedEpisodeFramesController, SafetyEpisodeInboxController],
      providers: [
        { provide: SafetyEpisodeInboxService, useValue: inbox },
        { provide: TrackedEpisodeFrameQuery, useValue: reader },
        { provide: UserAuthGuard, useValue: guard },
        { provide: AuthService, useValue: new AuthService(db, tokens) },
      ],
    }).compile();
    httpApp = module.createNestApplication<NestExpressApplication>({ logger: false });
    httpApp.setGlobalPrefix('api/v1');
    httpApp.useGlobalFilters(new HttpExceptionFilter());
    await httpApp.listen(0, '127.0.0.1');
    const endpoint = `${await httpApp.getUrl()}/api/v1/sites/${f.siteId}/safety-episodes/${episodeId}`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const inboxEndpoint = `${await httpApp.getUrl()}/api/v1/me/safety-episode-inbox`;
    const inboxHttp = await fetch(`${inboxEndpoint}?siteId=${f.siteId}`, { headers });
    assert.equal(inboxHttp.status, 200);
    const inboxBody = await inboxHttp.json();
    assert.equal(inboxBody.items[0].episode.subject.kind, 'TRACKED');
    const displayedRevision: number = inboxBody.items[0].episode.contentRevision;
    // Exercise the existing human review transaction on a synthetic TRACKED finding.
    const { SafetyAlertReviewService } =
      await import('../../src/modules/safety/alerts/safety-alert-review.service.js');
    const { AlertStatus } = await import('../../src/database/entities/enums.js');
    const reviews = new SafetyAlertReviewService(db);
    const reviewCommand: import('../../src/modules/safety/alerts/safety-alert-review.service.js').ReviewSafetyAlertCommand =
      {
        commandId: randomUUID(),
        expectedRevision: 0,
        targetStatus: AlertStatus.DISMISSED,
        reason: 'Synthetic fixture review, not a real observation judgement',
      };
    assert.equal(
      (await reviews.review(f.siteId, source.alertId, actor, reviewCommand)).replayed,
      false,
    );
    assert.equal(
      (await reviews.review(f.siteId, source.alertId, actor, reviewCommand)).replayed,
      true,
    );
    const readHttp = await fetch(`${inboxEndpoint}/${inboxBody.items[0].id}/read`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seenRevision: displayedRevision }),
    });
    assert.equal(readHttp.status, 200);
    assert.deepEqual(await readHttp.json(), {
      id: inboxBody.items[0].id,
      contentRevision: displayedRevision + 1,
      seenRevision: displayedRevision,
      unread: true,
    });
    const initialAlertRevisions = await db.query(
      'SELECT revision FROM safety_alert WHERE episode_id=$1',
      [episodeId],
    );
    assert.deepEqual(
      [...new Set(initialAlertRevisions.map((row: { revision: number }) => row.revision))].sort(),
      [0, 1],
    );
    const trackedDetail = await fetch(`${endpoint}/tracked`, { headers });
    assert.equal(trackedDetail.status, 200, await trackedDetail.clone().text());
    const trackedBody = await trackedDetail.json();
    assert.equal(trackedBody.episodeId, episodeId);
    assert.equal(trackedBody.siteId, f.siteId);
    assert.equal(trackedBody.subject.kind, 'TRACKED');
    assert.equal(trackedBody.subject.segmentId, segmentId);
    assert.equal(trackedBody.findings.length, 2);
    assert.equal(
      trackedBody.findings.reduce(
        (n: number, finding: { observationCount: number }) => n + finding.observationCount,
        0,
      ),
      3,
    );
    assert.equal('identityDecision' in trackedBody, false);
    assert.equal('eventId' in trackedBody.subject, false);
    assert.ok(trackedBody.findings.every((finding: object) => !('evidenceRefs' in finding)));
    assert.equal((await fetch(`${endpoint}/tracked?identity=true`, { headers })).status, 400);
    assert.equal((await fetch(`${endpoint}/tracked`)).status, 401);
    assert.equal(
      (await fetch(`${endpoint.replace(f.siteId, randomUUID())}/tracked`, { headers })).status,
      403,
    );
    const identityUrl = `${endpoint}/findings/${source.alertId}/events/${source.eventId}/identity?personObservationIndex=0&evidenceIndex=0`;
    const noDecisionResponse = await fetch(identityUrl, { headers });
    assert.equal(noDecisionResponse.status, 200);
    const noDecision = await noDecisionResponse.json();
    assert.equal(noDecision.revision, 0);
    assert.equal(noDecision.latestDecision, null);
    assert.equal(noDecision.subjectRef.eventId, later.payload.eventId);
    assert.equal(noDecision.subjectRef.trackId, 99);
    const firstSource = {
      alertId: second.items[0]!.alertId,
      eventId: first.payload.eventId,
      personObservationIndex: 0,
      evidenceIndex: 0,
    };
    const firstRef = {
      eventId: first.payload.eventId,
      personObservationIndex: 0,
      payloadHash: computeCanonicalPayloadHash(first.payload),
      cameraId: f.cameraId,
      cameraExternalId: first.payload.cameraExternalId,
      streamSessionId: first.payload.streamSessionId,
      capturedAt: first.payload.capturedAt,
      trackId: 1,
      personBoundingBox: first.payload.observations[0]!.boundingBox,
    };
    const resolutionId = randomUUID(),
      decisionId = randomUUID();
    await db.query(
      `INSERT INTO observation_identity_resolution(id,event_id,person_observation_index,site_id,payload_hash,subject_ref)
      VALUES($1,$2,0,$3,$4,$5::jsonb)`,
      [
        resolutionId,
        first.payload.eventId,
        f.siteId,
        firstRef.payloadHash,
        JSON.stringify(firstRef),
      ],
    );
    await db.query(
      `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,reason)
      VALUES($1,$2,$3,$4,1,0,$5,'CLEAR','Synthetic exact observation fixture')`,
      [decisionId, resolutionId, f.siteId, actor, 'b'.repeat(64)],
    );
    await db.query(
      'UPDATE observation_identity_resolution SET revision=1,current_decision_id=$2 WHERE id=$1',
      [resolutionId, decisionId],
    );
    const firstIdentityUrl = `${endpoint}/findings/${firstSource.alertId}/events/${firstSource.eventId}/identity?personObservationIndex=0&evidenceIndex=0`;
    const firstDecision = await fetch(firstIdentityUrl, { headers });
    assert.equal(firstDecision.status, 200);
    const firstDecisionBody = await firstDecision.json();
    assert.equal(firstDecisionBody.revision, 1);
    assert.equal(firstDecisionBody.latestDecision.action, 'CLEAR');
    assert.equal(firstDecisionBody.latestDecision.workerId, null);
    assert.equal(firstDecisionBody.latestDecision.subjectRef.eventId, first.payload.eventId);
    assert.equal((await (await fetch(identityUrl, { headers })).json()).latestDecision, null);
    const workerId = randomUUID(),
      resolvedId = randomUUID();
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic worker')",
      [workerId, f.siteId],
    );
    await db.query(
      `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,worker_id,evidence_index,evidence_sha256,reason)
      VALUES($1,$2,$3,$4,2,1,$5,'RESOLVE',$6,0,$7,'Synthetic exact resolution fixture')`,
      [resolvedId, resolutionId, f.siteId, actor, 'c'.repeat(64), workerId, first.sha256],
    );
    await db.query(
      'UPDATE observation_identity_resolution SET revision=2,current_decision_id=$2 WHERE id=$1',
      [resolutionId, resolvedId],
    );
    const resolved = await (await fetch(firstIdentityUrl, { headers })).json();
    assert.equal(resolved.latestDecision.action, 'RESOLVE');
    assert.equal(resolved.latestDecision.workerId, workerId);
    assert.equal(resolved.latestDecision.evidenceSha256, first.sha256);
    assert.equal((await (await fetch(identityUrl, { headers })).json()).latestDecision, null);
    const badDecisionId = randomUUID();
    await db.query(
      `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,worker_id,evidence_index,evidence_sha256,reason)
      VALUES($1,$2,$3,$4,3,2,$5,'RESOLVE',$6,0,$7,'Synthetic inconsistent evidence fixture')`,
      [badDecisionId, resolutionId, f.siteId, actor, 'd'.repeat(64), workerId, 'f'.repeat(64)],
    );
    await db.query(
      'UPDATE observation_identity_resolution SET revision=3,current_decision_id=$2 WHERE id=$1',
      [resolutionId, badDecisionId],
    );
    assert.equal((await fetch(firstIdentityUrl, { headers })).status, 409);
    assert.equal((await fetch(`${identityUrl}&representation=SUBJECT`, { headers })).status, 400);
    assert.equal((await fetch(identityUrl)).status, 401);
    assert.equal(
      (await fetch(identityUrl.replace(f.siteId, randomUUID()), { headers })).status,
      403,
    );
    await db.query("UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE id=$1", [role]);
    assert.equal((await fetch(firstIdentityUrl, { headers })).status, 403);
    await db.query("UPDATE user_role_assignment SET role='SAFETY_OFFICER',site_id=$2 WHERE id=$1", [
      role,
      f.siteId,
    ]);
    const badRef = { ...noDecision.subjectRef, trackId: 1 };
    await db.query(
      `INSERT INTO observation_identity_resolution(id,event_id,person_observation_index,site_id,payload_hash,subject_ref)
      VALUES($1,$2,0,$3,$4,$5::jsonb)`,
      [
        randomUUID(),
        later.payload.eventId,
        f.siteId,
        noDecision.subjectRef.payloadHash,
        JSON.stringify(badRef),
      ],
    );
    assert.equal((await fetch(identityUrl, { headers })).status, 409);
    const httpPage = await fetch(`${endpoint}/observations?limit=1`, { headers });
    assert.equal(httpPage.status, 200);
    assert.equal(httpPage.headers.get('cache-control'), 'no-store');
    assert.equal((await httpPage.json()).throughSequence, '9007199254740995');
    const mediaEndpoint = `${endpoint}/findings/${source.alertId}/events/${source.eventId}/frame?personObservationIndex=0&evidenceIndex=0`;
    const httpFrame = await fetch(mediaEndpoint, { headers });
    assert.equal(httpFrame.status, 200);
    assert.equal(httpFrame.headers.get('content-type'), 'image/jpeg');
    assert.equal(httpFrame.headers.get('cache-control'), 'private, no-store');
    assert.equal(httpFrame.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(httpFrame.headers.get('x-smartsite-frame-sha256'), later.sha256);
    assert.equal(httpFrame.headers.get('x-smartsite-content-sha256'), later.sha256);
    assert.equal(httpFrame.headers.get('x-smartsite-media-representation'), 'FRAME');
    assert.deepEqual(Buffer.from(await httpFrame.arrayBuffer()), later.bytes);
    const httpCrop = await fetch(`${mediaEndpoint}&representation=SUBJECT`, { headers });
    assert.equal(httpCrop.status, 200);
    const httpCropBytes = Buffer.from(await httpCrop.arrayBuffer());
    assert.notDeepEqual(httpCropBytes, later.bytes);
    assert.equal(httpCrop.headers.get('x-smartsite-frame-sha256'), later.sha256);
    assert.equal(
      httpCrop.headers.get('x-smartsite-content-sha256'),
      createHash('sha256').update(httpCropBytes).digest('hex'),
    );
    assert.equal(httpCrop.headers.get('x-smartsite-media-representation'), 'SUBJECT');
    assert.equal(
      (await fetch(`${endpoint}/observations?limit=1&limit=2`, { headers })).status,
      400,
    );
    assert.equal((await fetch(`${mediaEndpoint}&representation=FACE`, { headers })).status, 400);
    assert.equal((await fetch(`${endpoint}/observations`)).status, 401);
    assert.equal(
      (await fetch(endpoint.replace(f.siteId, randomUUID()) + '/observations', { headers })).status,
      403,
    );
    const crop = await reader.read(request(), f.siteId, episodeId, source, 'SUBJECT');
    assert.equal(crop.frameSha256, later.sha256);
    assert.notEqual(crop.sha256, later.sha256);
    await assert.rejects(
      reader.read(request(), f.siteId, episodeId, { ...source, eventId: first.payload.eventId }),
    );
    await assert.rejects(reader.pageObservations(request(), randomUUID(), episodeId));
    await assert.rejects(reader.pageObservations(request(), f.siteId, episodeId, { limit: 0 }));
    await writeFile(join(root, 'sha-mismatch-fixture.jpg'), first.bytes);
    await writeFile(later.file, first.bytes);
    await assert.rejects(reader.read(request(), f.siteId, episodeId, source));
    await writeFile(later.file, later.bytes);
    const aborted = AbortSignal.abort();
    await assert.rejects(reader.read(request(), f.siteId, episodeId, source, 'FRAME', aborted));
    const disabledReader = new TrackedEpisodeFrameQuery(
      db,
      guard,
      root,
      async (...args: Parameters<typeof readMf06FrameMedia>) => {
        const media = await readMf06FrameMedia(...args);
        await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
        return media;
      },
    );
    await assert.rejects(disabledReader.read(request(), f.siteId, episodeId, source));
    assert.equal((await fetch(firstIdentityUrl, { headers })).status, 401);
    await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
    const removedMappingReader = new TrackedEpisodeFrameQuery(
      db,
      guard,
      root,
      async (...args: Parameters<typeof readMf06FrameMedia>) => {
        const media = await readMf06FrameMedia(...args);
        await db.query('DELETE FROM alert_detection_mapping WHERE alert_id=$1 AND event_id=$2', [
          source.alertId,
          source.eventId,
        ]);
        return media;
      },
    );
    await assert.rejects(removedMappingReader.read(request(), f.siteId, episodeId, source));
    await db.query(
      'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,0)',
      [source.alertId, source.eventId],
    );
    const revokedRoleReader = new TrackedEpisodeFrameQuery(
      db,
      guard,
      root,
      async (...args: Parameters<typeof readMf06FrameMedia>) => {
        const media = await readMf06FrameMedia(...args);
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
        return media;
      },
    );
    await assert.rejects(revokedRoleReader.read(request(), f.siteId, episodeId, source));
    // Existing AuthService rejects an account with no role assignments as unauthenticated.
    assert.equal((await fetch(firstIdentityUrl, { headers })).status, 401);
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [role, actor, f.siteId],
    );
    const revokedSessionReader = new TrackedEpisodeFrameQuery(
      db,
      guard,
      root,
      async (...args: Parameters<typeof readMf06FrameMedia>) => {
        const media = await readMf06FrameMedia(...args);
        await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
          session,
        ]);
        return media;
      },
    );
    await assert.rejects(revokedSessionReader.read(request(), f.siteId, episodeId, source));
    assert.equal((await fetch(firstIdentityUrl, { headers })).status, 401);
  } finally {
    await httpApp?.close();
    await owned.dispose();
  }
});
