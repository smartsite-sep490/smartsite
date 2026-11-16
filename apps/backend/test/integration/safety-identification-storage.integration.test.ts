import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { TrackedEpisodeFrameQuery } from '../../src/modules/safety/alerts/tracked-episode-frame-query.js';
import {
  inspectC02EvidenceInventory,
  scanC02EvidenceInventory,
  removeExpiredC02Evidence,
  lockC02EvidenceStaging,
} from '../../src/modules/safety/identification/c02-evidence-inventory.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { seedZonePermissionActors } from '../support/c02-identification-fixture.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SafetyIdentificationService } from '../../src/modules/safety/identification/safety-identification.service.js';
import { createTestConfig } from '../support/config.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';

test('C02 storage retains subject scope, versioned responses and append-only commands', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  let profile: DataSource | undefined;
  let app: NestExpressApplication | undefined;
  let framePath: string | undefined;
  let mediaRoot: string | undefined;
  let cleanupMedia: (() => Promise<void>) | undefined;
  try {
    await owned.initialize();
    profile = new DataSource(
      buildMigrationOptions(
        { DATABASE_URL: resolveTestDatabaseUrl() },
        { profile: 'tracked-v16-identification', schema: db.driver.schema! },
      ),
    );
    await profile.initialize();
    const applied = await profile.runMigrations();
    assert.equal(applied.at(-1)?.name, 'SafetyIdentificationRequests1795046400009');
    assert.deepEqual(await profile.runMigrations(), []);
    await profile.undoLastMigration();
    assert.deepEqual(
      (await profile.runMigrations()).map(({ name }) => name),
      ['SafetyIdentificationRequests1795046400009'],
    );

    const fixture = await seedTrackedFrameFixture(db, ['HARD_HAT']);
    const eventId = randomUUID(),
      episodeId = randomUUID(),
      actorId = randomUUID();
    const otherSite = randomUUID(),
      requestId = randomUUID(),
      createId = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic C02 actor','synthetic')",
      [actorId],
    );
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Other C02 Site')", [
      otherSite,
    ]);
    const frame = await sharp({
      create: { width: 48, height: 48, channels: 3, background: '#cd7034' },
    })
      .jpeg()
      .toBuffer();
    const frameSha = createHash('sha256').update(frame).digest('hex');
    const streamSessionId = randomUUID();
    const rawEvent = {
      schemaVersion: '1.2.0',
      eventId,
      cameraExternalId: 'C02-storage-camera',
      streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 48, height: 48 },
      observations: [
        {
          type: 'PERSON',
          trackId: 7,
          confidence: 0.9,
          boundingBox: {
            x1: 0.25,
            y1: 0.25,
            x2: 0.75,
            y2: 0.75,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
      ],
      evidence: [
        {
          kind: 'FRAME',
          uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg`,
          sha256: frameSha,
        },
      ],
    };
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED')`,
      [
        eventId,
        computeCanonicalPayloadHash(rawEvent),
        rawEvent.cameraExternalId,
        fixture.cameraId,
        streamSessionId,
        rawEvent.capturedAt,
        rawEvent,
      ],
    );
    await db.query(
      `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
      SELECT $1,$2,$3,event_id,0,payload_hash,captured_at,captured_at FROM ai_observation_event WHERE event_id=$4`,
      [episodeId, fixture.siteId, fixture.cameraId, eventId],
    );
    const create = (id: string, siteId = fixture.siteId) =>
      db.query(
        `INSERT INTO safety_identification_request(id,site_id,episode_id,assigned_to,requested_by,reason)
       VALUES($1,$2,$3,$4,$4,'Synthetic request')`,
        [id, siteId, episodeId, actorId],
      );
    const history = (
      commandId: string,
      version: number,
      kind = 'CREATE',
      siteId = fixture.siteId,
    ) =>
      db.query(
        `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
        VALUES($1,$2,$3,$4,$5,$6,$7,'{}','{}')`,
        [commandId, requestId, siteId, actorId, version, kind, 'b'.repeat(64)],
      );
    await assert.rejects(create(randomUUID(), otherSite));
    await create(requestId);
    await history(createId, 1);
    await assert.rejects(create(randomUUID()));
    await assert.rejects(history(randomUUID(), 2, 'RESPOND', otherSite));
    await assert.rejects(history(createId, 2));
    await assert.rejects(
      db.query("UPDATE safety_identification_action SET payload='{}' WHERE command_id=$1", [
        createId,
      ]),
    );
    await assert.rejects(
      db.query('DELETE FROM safety_identification_action WHERE command_id=$1', [createId]),
    );
    await assert.rejects(
      db.query('UPDATE safety_identification_request SET version=3 WHERE id=$1', [requestId]),
    );
    await assert.rejects(
      db.query('UPDATE safety_identification_request SET site_id=$2,version=2 WHERE id=$1', [
        requestId,
        otherSite,
      ]),
    );

    const responseId = randomUUID();
    await db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
        VALUES($1,$2,$3,$4,2,'RESPOND',$5,'{"outcome":"UNRESOLVED"}','{}')`,
        [responseId, requestId, fixture.siteId, actorId, 'c'.repeat(64)],
      );
      await manager.query(
        `UPDATE safety_identification_request SET status='RESPONDED',version=2,current_result_id=$2,updated_at=clock_timestamp() WHERE id=$1`,
        [requestId, responseId],
      );
    });
    await assert.rejects(
      db.query(
        "UPDATE safety_identification_request SET status='RESPONDED',version=3,current_result_id=$2 WHERE id=$1",
        [requestId, randomUUID()],
      ),
    );
    await assert.rejects(profile.undoLastMigration());
    assert.deepEqual(
      await db.query('SELECT status,version FROM safety_identification_request WHERE id=$1', [
        requestId,
      ]),
      [{ status: 'RESPONDED', version: 2 }],
    );
    await db.query(
      "UPDATE safety_identification_request SET status='CLOSED',version=3,updated_at=clock_timestamp() WHERE id=$1",
      [requestId],
    );
    await assert.rejects(
      db.query("UPDATE safety_identification_request SET status='OPEN',version=4 WHERE id=$1", [
        requestId,
      ]),
    );
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM safety_identification_action'))[0].n,
      2,
    );
    const managerId = randomUUID();
    const password = 'Synthetic_C02_password_123';
    const passwordHash = await hashPassword(password);
    await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [actorId, passwordHash]);
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic C02 Manager',$2)",
      [managerId, passwordHash],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER'),($4,$5,$3,'SITE_MANAGER')",
      [randomUUID(), actorId, fixture.siteId, randomUUID(), managerId],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
    const officer = await auth.login(actorId, password, AuthClientType.WEB);
    const siteManager = await auth.login(managerId, password, AuthClientType.WEB);
    const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
    const service = new SafetyIdentificationService(
      db,
      new UserAuthGuard(auth),
      new StorageService(createTestConfig()),
      new TrackedEpisodeFrameQuery(db, new UserAuthGuard(auth), ''),
      new SafetyAlertEvidenceService(db, createTestConfig()),
    );
    const input = {
      commandId: randomUUID(),
      episodeId,
      assignedTo: managerId,
      reason: 'Check this subject',
      evidenceRefs: [],
    };
    const submit = () => service.create(bearer(officer.accessToken), fixture.siteId, input);
    const [first, second] = await Promise.all([submit(), submit()]);
    assert.equal(first.request.id, second.request.id);
    assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
    await assert.rejects(
      service.create(bearer(officer.accessToken), fixture.siteId, {
        ...input,
        reason: 'Different command',
      }),
      { status: 409 },
    );
    const managerRequest = bearer(siteManager.accessToken);
    assert.deepEqual(
      (await service.get(managerRequest, fixture.siteId, first.request.id)).subject,
      { kind: 'EVENT_LOCAL', eventId, personObservationIndex: 0 },
    );
    assert.equal((await service.list(managerRequest, fixture.siteId)).items.length, 1);
    await assert.rejects(service.create(managerRequest, fixture.siteId, input), { status: 403 });
    await assert.rejects(service.get(managerRequest, otherSite, first.request.id), { status: 403 });
    const reply = {
      commandId: randomUUID(),
      expectedVersion: 1,
      reason: 'Cannot identify this subject',
      outcome: 'UNRESOLVED',
      workerId: null,
      contractorId: null,
      evidenceRefs: [],
    };
    const respond = () =>
      service.change(managerRequest, fixture.siteId, first.request.id, 'respond', reply);
    const [response, duplicate] = await Promise.all([respond(), respond()]);
    assert.deepEqual([response.replayed, duplicate.replayed].sort(), [false, true]);
    const officerRequest = bearer(officer.accessToken);
    await assert.rejects(
      service.change(officerRequest, fixture.siteId, first.request.id, 'review', {
        commandId: randomUUID(),
        expectedVersion: 1,
        reason: 'Stale review',
        decision: 'ACCEPT',
      }),
      { status: 409 },
    );
    const returned = await service.change(
      officerRequest,
      fixture.siteId,
      first.request.id,
      'review',
      {
        commandId: randomUUID(),
        expectedVersion: 2,
        reason: 'Review again',
        decision: 'RETURN',
      },
    );
    assert.equal(returned.request.status, 'OPEN');
    assert.equal(returned.request.result, null);
    assert.equal((await respond()).request.result?.outcome, 'UNRESOLVED');
    const [responseHistory] = await db.query(
      "SELECT count(*)::int AS total FROM safety_identification_action WHERE request_id=$1 AND kind='RESPOND'",
      [first.request.id],
    );
    assert.equal(responseHistory.total, 1);
    const historyPage = await service.history(
      officerRequest,
      fixture.siteId,
      first.request.id,
      '1',
      '2',
    );
    assert.equal(historyPage.total, 3);
    assert.deepEqual(
      historyPage.items.map(({ kind, version }) => [kind, version]),
      [
        ['RESPOND', 2],
        ['CREATE', 1],
      ],
    );
    assert.equal(historyPage.items[0]?.proposal?.outcome, 'UNRESOLVED');
    assert.equal(historyPage.items[0]?.reason, reply.reason);
    await assert.rejects(service.history(managerRequest, fixture.siteId, first.request.id), {
      status: 403,
    });
    await assert.rejects(service.history(officerRequest, otherSite, first.request.id), {
      status: 403,
    });
    await assert.rejects(service.history(officerRequest, fixture.siteId, randomUUID()), {
      status: 404,
    });
    await service.change(managerRequest, fixture.siteId, first.request.id, 'respond', {
      ...reply,
      commandId: randomUUID(),
      expectedVersion: 3,
    });
    const closed = await service.change(
      officerRequest,
      fixture.siteId,
      first.request.id,
      'review',
      {
        commandId: randomUUID(),
        expectedVersion: 4,
        reason: 'Confirm unresolved',
        decision: 'ACCEPT',
      },
    );
    assert.equal(closed.request.status, 'CLOSED');
    assert.deepEqual(
      (await service.get(managerRequest, fixture.siteId, first.request.id)).result,
      closed.request.result,
    );
    await assert.rejects(
      service.change(officerRequest, fixture.siteId, first.request.id, 'cancel', {
        commandId: randomUUID(),
        expectedVersion: 5,
        reason: 'Already closed',
      }),
      { status: 409 },
    );
    const reopened = (
      await service.create(officerRequest, fixture.siteId, {
        ...input,
        commandId: randomUUID(),
      })
    ).request;
    const nextReply = { ...reply, commandId: randomUUID() };
    await service.change(managerRequest, fixture.siteId, reopened.id, 'respond', nextReply);
    await db.query('DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2', [
      managerId,
      fixture.siteId,
    ]);
    const nextManagerId = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic replacement Manager',$2)",
      [nextManagerId, passwordHash],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
      [randomUUID(), nextManagerId, fixture.siteId],
    );
    const nextManager = await auth.login(nextManagerId, password, AuthClientType.WEB);
    const nextRequest = bearer(nextManager.accessToken);
    await assert.rejects(service.get(nextRequest, fixture.siteId, reopened.id), { status: 404 });
    const reassigned = await service.change(
      officerRequest,
      fixture.siteId,
      reopened.id,
      'reassign',
      {
        commandId: randomUUID(),
        expectedVersion: 2,
        reason: 'Transfer to replacement',
        assignedTo: nextManagerId,
      },
    );
    assert.equal(reassigned.request.status, 'OPEN');
    assert.equal(reassigned.request.result, null);
    await assert.rejects(service.get(managerRequest, fixture.siteId, reopened.id), { status: 401 });
    await assert.rejects(
      service.change(managerRequest, fixture.siteId, reopened.id, 'respond', nextReply),
      { status: 401 },
    );
    assert.equal(
      (await service.get(nextRequest, fixture.siteId, reopened.id)).assignedTo,
      nextManagerId,
    );
    const cancelled = await service.change(officerRequest, fixture.siteId, reopened.id, 'cancel', {
      commandId: randomUUID(),
      expectedVersion: 3,
      reason: 'No longer needed',
    });
    assert.equal(cancelled.request.status, 'CANCELLED');
    await assert.rejects(service.get(managerRequest, fixture.siteId, first.request.id), {
      status: 401,
    });
    assert.ok(fixture.ppeRegionId);
    const { workerId, contractorId, representativeId } = await seedZonePermissionActors(
      db,
      fixture.siteId,
      fixture.ppeRegionId,
      passwordHash,
    );
    const { AppModule } = await import('../../src/app.module.js');
    mediaRoot = await mkdtemp(join(tmpdir(), 'smartsite-c02-jpeg-'));
    const config = createTestConfig({
      SAFETY_IDENTIFICATION_ENABLED: 'true',
      SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v16-identification',
      DATABASE_SCHEMA: db.driver.schema!,
      SAFETY_TRACKED_HISTORY_READ_ENABLED: 'true',
      STORAGE_LOCAL_ROOT: mediaRoot,
      EVIDENCE_LOCAL_ROOT: mediaRoot,
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const api = (await app.getUrl()) + '/api/v1';
    const root = api + '/sites/' + fixture.siteId + '/safety-identification-requests';
    const send = async (path: string, token: string, status: number, body?: unknown) => {
      const res = await fetch(root + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...bearer(token).headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(res.status, status, path);
      if (status < 400) assert.equal(res.headers.get('cache-control'), 'private, no-store');
      return res.json();
    };
    const officerToken = officer.accessToken;
    const managerToken = nextManager.accessToken;
    const previousIdentificationFlag = process.env.SAFETY_IDENTIFICATION_ENABLED;
    try {
      config.set('SAFETY_IDENTIFICATION_ENABLED', false);
      await send('/assignee', officerToken, 404);
      config.set('SAFETY_IDENTIFICATION_ENABLED', true);
    } finally {
      // ConfigService.set also writes process.env; do not leak the HTTP fixture flag to child CLIs.
      if (previousIdentificationFlag === undefined)
        delete process.env.SAFETY_IDENTIFICATION_ENABLED;
      else process.env.SAFETY_IDENTIFICATION_ENABLED = previousIdentificationFlag;
    }
    assert.deepEqual(await send('/assignee', officerToken, 200), {
      assignee: { id: nextManagerId, displayName: 'Synthetic replacement Manager' },
    });
    await send('/assignee', managerToken, 403);
    await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [nextManagerId]);
    assert.deepEqual(await send('/assignee', officerToken, 200), { assignee: null });
    await db.query('UPDATE app_user SET must_change_password=false WHERE id=$1', [nextManagerId]);
    const { request: created } = await send('', officerToken, 201, {
      ...input,
      commandId: randomUUID(),
      assignedTo: nextManagerId,
    });
    const path = '/' + created.id;
    const open = await send('?status=OPEN&limit=1', managerToken, 200);
    assert.equal(open.total, 1);
    assert.equal(open.items[0]?.id, created.id);
    const closedForManager = await send('?status=CLOSED', managerToken, 200);
    assert.deepEqual(closedForManager, { items: [], total: 0 });
    const closedForOfficer = await send('?status=CLOSED', officerToken, 200);
    assert.ok(closedForOfficer.total > 0);
    await send('?status=INVALID', managerToken, 400);
    await send('?status=OPEN&status=CLOSED', managerToken, 400);
    const managerView = await send(path, managerToken, 200);
    assert.equal(managerView.id, created.id);
    assert.deepEqual(managerView.evidenceRefs, []);
    assert.deepEqual(managerView.evidenceAvailability, {
      status: 'UNAVAILABLE',
      reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
    });
    await send('', officerToken, 400, {
      ...input,
      commandId: randomUUID(),
      assignedTo: nextManagerId,
      evidenceRefs: [randomUUID()],
    });
    await send(path + '/history', managerToken, 403);
    const managerLookup = async (siteId: string, endpoint: string, status: number) => {
      const res = await fetch(api + '/sites/' + siteId + endpoint, {
        headers: bearer(managerToken).headers,
      });
      assert.equal(res.status, status, endpoint);
      return res.json();
    };
    const workers = await managerLookup(fixture.siteId, '/workers?limit=20', 200);
    assert.ok(workers.items.some((worker: { id: string }) => worker.id === workerId));
    const overview = await managerLookup(fixture.siteId, '/management/overview?limit=20', 200);
    assert.ok(
      overview.contractors.items.some(
        (contractor: { id: string }) => contractor.id === contractorId,
      ),
    );
    await managerLookup(otherSite, '/workers?limit=20', 403);
    await managerLookup(otherSite, '/management/overview?limit=20', 403);
    const identified = {
      ...reply,
      commandId: randomUUID(),
      outcome: 'IDENTIFIED',
      workerId,
      contractorId,
    };
    await send(path + '/respond', managerToken, 400, { ...identified, workerId: randomUUID() });
    await send(path + '/respond', managerToken, 400, { ...identified, contractorId: randomUUID() });
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [contractorId]);
    await send(path + '/respond', managerToken, 400, identified);
    await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [contractorId]);
    const { request: proposed } = await send(path + '/respond', managerToken, 201, identified);
    assert.equal(proposed.result.workerId, workerId);
    assert.equal(proposed.result.contractorId, contractorId);
    const staleReview = {
      commandId: randomUUID(),
      expectedVersion: 2,
      reason: 'Verify current assignment',
      decision: 'ACCEPT',
    };
    await db.query('UPDATE worker SET is_active=false WHERE id=$1', [workerId]);
    await send(path + '/review', officerToken, 409, staleReview);
    await db.query('UPDATE worker SET is_active=true WHERE id=$1', [workerId]);
    await db.query(
      'UPDATE contractor_site_participation SET is_active=false WHERE site_id=$1 AND contractor_id=$2',
      [fixture.siteId, contractorId],
    );
    await send(path + '/review', officerToken, 409, staleReview);
    await db.query(
      'UPDATE contractor_site_participation SET is_active=true WHERE site_id=$1 AND contractor_id=$2',
      [fixture.siteId, contractorId],
    );
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [contractorId]);
    await send(path + '/review', officerToken, 409, staleReview);
    await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [contractorId]);
    const retained = await send(path, managerToken, 200);
    assert.equal(retained.status, 'RESPONDED');
    assert.equal(retained.version, 2);
    const { request: accepted } = await send(path + '/review', officerToken, 201, {
      commandId: randomUUID(),
      expectedVersion: 2,
      reason: 'Verified for this case',
      decision: 'ACCEPT',
    });
    assert.equal(accepted.status, 'CLOSED');
    const historyHttp = await send(path + '/history?limit=1&offset=1', officerToken, 200);
    assert.equal(historyHttp.total, 3);
    assert.equal(historyHttp.items[0]?.proposal?.workerId, workerId);
    await send(path + '/history', siteManager.accessToken, 401);
    const representative = await auth.login(representativeId, password, AuthClientType.WEB);
    const handoverNotices = async () => {
      const res = await fetch(api + '/me/notifications', {
        headers: bearer(representative.accessToken).headers,
      });
      assert.equal(res.status, 200);
      const page = await res.json();
      return page.items.filter((item: { event: string }) => item.event === 'SAFETY_HANDOVER');
    };
    assert.equal((await handoverNotices()).length, 0);

    const alertId = randomUUID();
    await db.query(
      `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,status,first_detected_at,last_detected_at)
       VALUES($1,$2,$3,'PPE_VIOLATION','PPE_HARD_HAT_MISSING',$1::uuid::text,'CONFIRMED',now(),now())`,
      [alertId, fixture.siteId, accepted.episodeId],
    );
    await db.query(
      'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,0)',
      [alertId, eventId],
    );
    framePath = join(mediaRoot, `${streamSessionId}_1_${eventId}.jpg`);
    await writeFile(framePath, frame);
    const preview = async (token: string, personObservationIndex: number) =>
      fetch(root + '/evidence-preview', {
        method: 'POST',
        headers: { ...bearer(token).headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          alertId,
          eventId,
          personObservationIndex,
          evidenceIndex: 0,
          masks: [{ left: 5000, top: 0, right: 10000, bottom: 10000 }],
        }),
      });
    const masked = await preview(officerToken, 0);
    assert.equal(masked.status, 200);
    assert.equal(masked.headers.get('x-smartsite-frame-sha256'), frameSha);
    const maskedBytes = Buffer.from(await masked.arrayBuffer());
    const { data, info } = await sharp(maskedBytes).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 24);
    assert.equal(info.height, 24);
    assert.ok(data.readUInt8(0) > 100);
    assert.ok(
      [...data.subarray(20 * info.channels, 21 * info.channels)].every((value) => value <= 2),
    );
    assert.equal((await preview(officerToken, 1)).status, 404);
    assert.equal((await preview(managerToken, 0)).status, 403);
    const trackedRoot = api + '/sites/' + fixture.siteId + '/safety-episodes/' + episodeId;
    const mediaPath =
      trackedRoot +
      '/findings/' +
      alertId +
      '/events/' +
      eventId +
      '/frame?personObservationIndex=0&evidenceIndex=0';
    for (const url of [
      trackedRoot + '/tracked',
      mediaPath,
      mediaPath + '&representation=SUBJECT',
    ]) {
      const res = await fetch(url, { headers: bearer(managerToken).headers });
      assert.equal(res.status, 403);
      assert.ok(!res.headers.get('content-type')?.includes('image/'));
      await res.body?.cancel();
    }
    const incidentUrl = api + '/sites/' + fixture.siteId + '/incidents';
    const handover = {
      commandId: randomUUID(),
      title: 'Synthetic C02 corrective handover',
      description: 'Follow up on the confirmed finding',
      severity: 'HIGH',
      occurredAt: new Date().toISOString(),
      alertIds: [alertId],
      workerIds: [accepted.result.workerId],
      contractorId: accepted.result.contractorId,
      responsibilityReason: 'Officer separately confirmed responsibility for the selected finding',
      initialAction: { assignedTo: representativeId, description: 'Review corrective measures' },
    };
    const submitHandover = async (token: string, status: number) => {
      const res = await fetch(incidentUrl, {
        method: 'POST',
        headers: { ...bearer(token).headers, 'content-type': 'application/json' },
        body: JSON.stringify(handover),
      });
      assert.equal(res.status, status);
      return res.json();
    };
    await submitHandover(managerToken, 403);
    const { resource: incident } = await submitHandover(officerToken, 201);
    const replay = await submitHandover(officerToken, 201);
    assert.equal(replay.replayed, true);
    assert.equal(replay.resource.id, incident.id);
    assert.deepEqual(incident.workerIds, [workerId]);
    assert.equal(incident.alerts[0]?.id, alertId);
    assert.equal(incident.actions[0]?.assignedTo, representativeId);
    const notices = await handoverNotices();
    assert.equal(notices.length, 1);
    assert.equal(notices[0].siteId, fixture.siteId);

    const actionUrl = incidentUrl + '/' + incident.id + '/actions/' + incident.actions[0].id;
    const postAction = async (
      suffix: string,
      token: string,
      status: number,
      body: object | FormData,
    ) => {
      const res = await fetch(actionUrl + suffix, {
        method: 'POST',
        headers:
          body instanceof FormData
            ? bearer(token).headers
            : {
                ...bearer(token).headers,
                'content-type': 'application/json',
              },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      assert.equal(res.status, status, suffix);
      return res.json();
    };
    const representativeToken = representative.accessToken;
    const started = await postAction('/start', representativeToken, 201, {
      commandId: randomUUID(),
      expectedVersion: incident.actions[0].version,
    });
    const startedAction = started.resource.actions[0];
    assert.equal(startedAction.status, 'IN_PROGRESS');
    const form = new FormData();
    form.set('commandId', randomUUID());
    form.set('expectedVersion', String(startedAction.version));
    form.set('resultDescription', 'Synthetic corrective work completed');
    await postAction('/submissions', managerToken, 403, form);
    const submitted = await postAction('/submissions', representativeToken, 201, form);
    const submittedAction = submitted.resource.actions[0];
    assert.equal(submittedAction.status, 'SUBMITTED');
    const decision = {
      commandId: randomUUID(),
      expectedVersion: submittedAction.version,
      submissionId: submittedAction.submissions[0].id,
      decision: 'APPROVED',
      reason: 'Officer reviewed the corrective result',
    };
    await postAction('/reviews', representativeToken, 403, decision);
    const resolved = await postAction('/reviews', officerToken, 201, decision);
    assert.equal(resolved.resource.actions[0].status, 'CLOSED');
    const [finding] = await db.query('SELECT status,episode_id FROM safety_alert WHERE id=$1', [
      alertId,
    ]);
    assert.deepEqual(finding, { status: 'CLOSED', episode_id: episodeId });
    const verified = await send(path, officerToken, 200);
    assert.equal(verified.status, 'CLOSED');
    assert.equal(verified.version, accepted.version);
    assert.deepEqual(verified.result, accepted.result);
    const evidenceApproval = {
      preview: {
        episodeId,
        alertId,
        eventId,
        personObservationIndex: 0,
        evidenceIndex: 0,
        masks: [{ left: 5000, top: 0, right: 10000, bottom: 10000 }],
      },
      frameSha256: frameSha,
      sha256: createHash('sha256').update(maskedBytes).digest('hex'),
    };
    const withEvidence = {
      ...input,
      commandId: randomUUID(),
      assignedTo: nextManagerId,
      evidenceApproval,
    };
    await send('', officerToken, 409, {
      ...withEvidence,
      evidenceApproval: { ...evidenceApproval, sha256: '0'.repeat(64) },
    });
    const fixtureStorage = app.get(StorageService);
    const saveObject = fixtureStorage.save.bind(fixtureStorage);

    const staleSave = t.mock.method(
      fixtureStorage,
      'save',
      async (...args: Parameters<StorageService['save']>) => {
        const object = await saveObject(...args);
        const staleKey = object.storageKey.replace(
          /[0-9]{13}/,
          String(Date.now() - 2 * 86_400_000),
        );
        await rename(join(mediaRoot!, object.storageKey), join(mediaRoot!, staleKey));

        return { ...object, storageKey: staleKey };
      },
    );
    try {
      await send('', officerToken, 409, withEvidence);
      assert.equal(staleSave.mock.callCount(), 1);
    } finally {
      staleSave.mock.restore();
    }
    const [staleReceipt] = await db.query(
      'SELECT 1 FROM safety_identification_action WHERE command_id=$1',
      [withEvidence.commandId],
    );
    assert.equal(staleReceipt, undefined);
    const [firstPublication, secondPublication] = await Promise.all([
      send('', officerToken, 201, withEvidence),
      send('', officerToken, 201, withEvidence),
    ]);
    assert.deepEqual([firstPublication.replayed, secondPublication.replayed].sort(), [false, true]);
    const uncertain = firstPublication.replayed
      ? secondPublication.request
      : firstPublication.request;
    assert.equal(firstPublication.request.id, secondPublication.request.id);
    const [receipt] = await db.query(
      'SELECT payload FROM safety_identification_action WHERE command_id=$1',
      [withEvidence.commandId],
    );
    const publicationObject = receipt.payload.publishedEvidence[0].object;
    cleanupMedia = () => new StorageService(config).remove(publicationObject);
    assert.match(publicationObject.storageKey, /^c02-evidence-[0-9]{13}-[a-f0-9-]{36}\.jpg$/);
    assert.equal(uncertain.evidenceAvailability.status, 'AVAILABLE');
    const publicationReplay = await send('', officerToken, 201, withEvidence);
    assert.equal(publicationReplay.replayed, true);
    assert.equal(publicationReplay.request.id, uncertain.id);
    const detail = await send('/' + uncertain.id, managerToken, 200);
    assert.deepEqual(detail.evidenceRefs, uncertain.evidenceRefs);
    const shared = await fetch(root + '/' + uncertain.id + '/evidence/' + detail.evidenceRefs[0], {
      headers: bearer(managerToken).headers,
    });
    assert.equal(shared.status, 200);
    assert.deepEqual(Buffer.from(await shared.arrayBuffer()), maskedBytes);
    const uncertainPath = '/' + uncertain.id;
    const partial = {
      ...reply,
      commandId: randomUUID(),
      outcome: 'PARTIAL',
      contractorId,
      reason: 'Contractor may be known; Worker could not be identified',
    };
    await send(uncertainPath + '/respond', managerToken, 400, { ...partial, workerId });
    const { request: suggested } = await send(
      uncertainPath + '/respond',
      managerToken,
      201,
      partial,
    );
    assert.equal(suggested.result.workerId, null);
    assert.equal(suggested.result.contractorId, contractorId);
    await send(uncertainPath + '/review', officerToken, 201, {
      commandId: randomUUID(),
      expectedVersion: 2,
      reason: 'Ask for more context',
      decision: 'RETURN',
    });
    const { request: disputed } = await send(uncertainPath + '/respond', managerToken, 201, {
      ...reply,
      commandId: randomUUID(),
      expectedVersion: 3,
      outcome: 'DISPUTED',
      reason: 'Reports disagree about the subject',
    });
    assert.equal(disputed.result.workerId, null);
    assert.equal(disputed.result.contractorId, null);
    const { request: closedDisputed } = await send(uncertainPath + '/review', officerToken, 201, {
      commandId: randomUUID(),
      expectedVersion: 4,
      reason: 'Record the disputed outcome',
      decision: 'ACCEPT',
    });
    assert.equal(closedDisputed.status, 'CLOSED');
    assert.equal(closedDisputed.result.outcome, 'DISPUTED');
    const uncertainHistory = await send(uncertainPath + '/history', officerToken, 200);
    assert.deepEqual(
      uncertainHistory.items
        .filter((entry: { kind: string }) => entry.kind === 'RESPOND')
        .map((entry: { proposal: { outcome: string; workerId: string | null } }) => [
          entry.proposal.outcome,
          entry.proposal.workerId,
        ]),
      [
        ['DISPUTED', null],
        ['PARTIAL', null],
      ],
    );
    assert.equal((await handoverNotices()).length, 1);

    const storage = new StorageService(config);
    const jpeg = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#326a47' },
    })
      .jpeg()
      .toBuffer();
    const object = await storage.save(jpeg, 'image/jpeg', 'jpg');
    const cleanupPublished = cleanupMedia;
    cleanupMedia = async () => {
      await cleanupPublished?.();
      await storage.remove(object);
    };
    const evidenceRequestId = randomUUID();
    const evidenceId = randomUUID();
    const expiredId = randomUUID();
    const expiredObject = await storage.save(jpeg, 'image/jpeg', 'jpg', 'c02-evidence');
    const cleanupBeforeExpiry = cleanupMedia;
    cleanupMedia = async () => {
      await cleanupBeforeExpiry?.();
      await storage.remove(expiredObject);
    };
    const wrongSubjectId = randomUUID();
    const publication = {
      id: evidenceId,
      sourceEventId: eventId,
      personObservationIndex: 0,
      sourceSha256: 'a'.repeat(64),
      transformVersion: 'REVIEWED_SUBJECT_JPEG_V1',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      object,
    };
    await db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO safety_identification_request(id,site_id,episode_id,assigned_to,requested_by,reason)
         VALUES($1,$2,$3,$4,$5,'Synthetic evidence publication')`,
        [evidenceRequestId, fixture.siteId, episodeId, nextManagerId, actorId],
      );
      await manager.query(
        `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
         VALUES($1,$2,$3,$4,1,'CREATE',$5,$6,'{}')`,
        [
          randomUUID(),
          evidenceRequestId,
          fixture.siteId,
          actorId,
          'b'.repeat(64),
          {
            publishedEvidence: [
              publication,
              { ...publication, id: expiredId, expiresAt: '2000-01-01T00:00:00.000Z' },
              {
                ...publication,
                id: randomUUID(),
                object: expiredObject,
                expiresAt: '2000-01-01T00:00:00.000Z',
              },
              { ...publication, id: wrongSubjectId, personObservationIndex: 1 },
            ],
          },
        ],
      );
    });
    await send('', officerToken, 400, {
      ...input,
      commandId: randomUUID(),
      publishedEvidence: [publication],
    });
    const orphan = await storage.save(jpeg, 'image/jpeg', 'jpg', 'c02-evidence');
    const cleanupExistingMedia = cleanupMedia;
    cleanupMedia = async () => {
      await cleanupExistingMedia?.();
      await storage.remove(orphan);
    };
    const keys = [
      publicationObject.storageKey,
      object.storageKey,
      orphan.storageKey,
      expiredObject.storageKey,
      randomUUID() + '.jpg',
    ];
    assert.deepEqual(await inspectC02EvidenceInventory(db.manager, 'LOCAL', keys), [
      { storageKey: publicationObject.storageKey, status: 'REFERENCED_ACTIVE' },
      { storageKey: object.storageKey, status: 'REFERENCED_ACTIVE' },
      { storageKey: orphan.storageKey, status: 'UNREFERENCED_C02' },
      { storageKey: expiredObject.storageKey, status: 'REFERENCED_EXPIRED' },
    ]);
    assert.deepEqual(
      (await inspectC02EvidenceInventory(db.manager, 'LOCAL', keys, Date.now() + 3_600_001)).map(
        ({ status }) => status,
      ),
      ['REFERENCED_EXPIRED', 'REFERENCED_EXPIRED', 'UNREFERENCED_C02', 'REFERENCED_EXPIRED'],
    );
    assert.deepEqual(await inspectC02EvidenceInventory(db.manager, 'R2', [object.storageKey]), []);
    const scanned = [];
    for await (const batch of scanC02EvidenceInventory(db.manager, storage, 'LOCAL')) {
      scanned.push(...batch);
    }
    assert.equal(scanned.length, 4);
    assert.deepEqual(
      scanned.sort((a, b) => a.storageKey.localeCompare(b.storageKey)),
      (await inspectC02EvidenceInventory(db.manager, 'LOCAL', keys)).sort((a, b) =>
        a.storageKey.localeCompare(b.storageKey),
      ),
    );
    const runRetention = async (...args: string[]) => {
      const script = fileURLToPath(
        new URL('../../src/scripts/c02-evidence-retention.js', import.meta.url),
      );
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [script, '--schema', db.driver.schema!, '--provider', 'LOCAL', ...args],
        {
          env: {
            ...process.env,
            NODE_ENV: 'test',
            STORAGE_PROVIDER: 'LOCAL',
            C02_RETENTION_DATABASE_URL: resolveTestDatabaseUrl(),
            STORAGE_LOCAL_ROOT: mediaRoot,
          },
          timeout: 15000,
          windowsHide: true,
        },
      );
      return JSON.parse(stdout);
    };
    assert.deepEqual(await runRetention(), {
      mode: 'inventory',
      active: 2,
      expired: 1,
      unreferenced: 1,
      removed: 0,
    });
    assert.deepEqual(await storage.read(expiredObject), jpeg);
    assert.deepEqual(await runRetention('--delete-expired'), {
      mode: 'delete-expired',
      active: 0,
      expired: 0,
      unreferenced: 0,
      removed: 1,
    });
    await assert.rejects(storage.read(expiredObject));
    const oldOrphan = {
      ...orphan,
      storageKey: orphan.storageKey.replace(/[0-9]{13}/, String(Date.now() - 2 * 86_400_000)),
    };
    await writeFile(join(mediaRoot, oldOrphan.storageKey), jpeg, { flag: 'wx' });
    const cleanupBeforeOrphan = cleanupMedia;
    cleanupMedia = async () => {
      await cleanupBeforeOrphan?.();
      await storage.remove(oldOrphan);
    };
    // Model a publication that acquired its key before the age boundary and commits
    // its receipt after inventory but before the waiting sweep may delete.
    const crossing = {
      ...orphan,
      storageKey: oldOrphan.storageKey.replace(
        /-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/,
        '-' + randomUUID() + '.jpg',
      ),
    };
    await writeFile(join(mediaRoot, crossing.storageKey), jpeg, { flag: 'wx' });
    const cleanupBeforeCrossing = cleanupMedia;
    cleanupMedia = async () => {
      await cleanupBeforeCrossing?.();
      await storage.remove(crossing);
    };
    const holder = db.createQueryRunner();
    await holder.connect();
    let sweep: Promise<unknown> | undefined;
    try {
      await holder.startTransaction();
      assert.equal(await lockC02EvidenceStaging(holder.manager, crossing), true);
      const [backend] = await holder.query('SELECT pg_backend_pid() AS pid');
      sweep = runRetention('--delete-orphans');
      void sweep.catch(() => undefined);
      let waited = false;
      const deadline = Date.now() + 7000;
      while (!waited && Date.now() < deadline) {
        const [waiter] = await db.query(
          `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
            WHERE wait_event='advisory' AND $1::int=ANY(pg_blocking_pids(pid))) AS waiting`,
          [backend.pid],
        );
        waited = waiter.waiting;
        if (!waited) await delay(25);
      }
      assert.equal(waited, true, 'Cleanup must wait for the held publication key');
      const raceRequestId = randomUUID();
      await holder.query(
        `INSERT INTO safety_identification_request(id,site_id,episode_id,assigned_to,requested_by,reason,status)
         VALUES($1,$2,$3,$4,$5,'Retained publication race fixture','CANCELLED')`,
        [raceRequestId, fixture.siteId, episodeId, nextManagerId, actorId],
      );
      await holder.query(
        `INSERT INTO safety_identification_action(command_id,request_id,site_id,actor_user_id,request_version,kind,request_hash,payload,result)
         VALUES($1,$2,$3,$4,1,'CREATE',$5,$6,'{}')`,
        [
          randomUUID(),
          raceRequestId,
          fixture.siteId,
          actorId,
          'c'.repeat(64),
          {
            publishedEvidence: [
              {
                ...publication,
                id: randomUUID(),
                object: crossing,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
            ],
          },
        ],
      );
      await holder.commitTransaction();
    } finally {
      if (holder.isTransactionActive) await holder.rollbackTransaction();
      await holder.release();
      if (sweep) await sweep;
    }
    assert.deepEqual(await storage.read(crossing), jpeg);
    assert.deepEqual(await sweep, {
      mode: 'delete-orphans',
      active: 0,
      expired: 0,
      unreferenced: 0,
      removed: 1,
    });
    await assert.rejects(storage.read(oldOrphan));
    assert.deepEqual(await storage.read(orphan), jpeg);
    for await (const key of removeExpiredC02Evidence(db.manager, storage, 'LOCAL')) {
      assert.fail('Unexpected second deletion: ' + key);
    }
    assert.deepEqual(await storage.read(orphan), jpeg);
    assert.deepEqual(await storage.read(object), jpeg);
    assert.deepEqual(await storage.read(publicationObject), maskedBytes);
    const evidencePath = '/' + evidenceRequestId + '/evidence/';
    const getImage = (path: string, token: string) =>
      fetch(root + path, { headers: bearer(token).headers });
    const assertNoImage = async (path: string, token: string, status: number) => {
      const res = await getImage(path, token);
      assert.equal(res.status, status, path);
      assert.doesNotMatch(res.headers.get('content-type') ?? '', /^image\//);
      await res.arrayBuffer();
    };
    const approved = await getImage(evidencePath + evidenceId, managerToken);
    assert.equal(approved.status, 200);
    assert.equal(approved.headers.get('content-type'), 'image/jpeg');
    assert.equal(approved.headers.get('cache-control'), 'private, no-store');
    assert.equal(approved.headers.get('x-smartsite-content-sha256'), object.sha256);
    assert.deepEqual(Buffer.from(await approved.arrayBuffer()), jpeg);
    await assertNoImage(evidencePath + evidenceId, representativeToken, 403);
    await assertNoImage(evidencePath + expiredId, managerToken, 404);
    await assertNoImage(evidencePath + wrongSubjectId, managerToken, 404);
    await assertNoImage('/' + uncertain.id + '/evidence/' + evidenceId, managerToken, 404);
    const corrupted = Buffer.from(jpeg);
    corrupted.writeUInt8(corrupted.readUInt8(12) ^ 1, 12);
    await writeFile(join(mediaRoot, object.storageKey), corrupted);
    await assertNoImage(evidencePath + evidenceId, managerToken, 503);
    await writeFile(join(mediaRoot, object.storageKey), jpeg);

    // Rotate the role after the actual storage read but before the response is authorized.
    const appStorage = app.get(StorageService);
    const readObject = appStorage.read.bind(appStorage);
    const rotatedRead = t.mock.method(appStorage, 'read', async (ref: typeof object) => {
      const bytes = await readObject(ref);
      await db.transaction(async (manager) => {
        await manager.query(
          "DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SITE_MANAGER'",
          [nextManagerId, fixture.siteId],
        );
        await manager.query(
          "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
          [randomUUID(), managerId, fixture.siteId],
        );
      });
      return bytes;
    });
    try {
      await assertNoImage(evidencePath + evidenceId, managerToken, 401);
      assert.equal(rotatedRead.mock.callCount(), 1);
    } finally {
      rotatedRead.mock.restore();
    }
    const restoredManager = await auth.login(managerId, password, AuthClientType.WEB);
    const restoredToken = restoredManager.accessToken;
    assert.equal((await send('/' + first.request.id, restoredToken, 200)).id, first.request.id);
    const restoredQueue = await send('', restoredToken, 200);
    assert.deepEqual(
      restoredQueue.items.map((item: { id: string }) => item.id),
      [first.request.id],
    );
    await send('/' + reopened.id, restoredToken, 404);
    await send('/' + reopened.id + '/respond', restoredToken, 404, {
      ...nextReply,
      commandId: randomUUID(),
      expectedVersion: cancelled.request.version,
    });
    assert.equal((await send('/' + reopened.id, officerToken, 200)).assignedTo, nextManagerId);
    await assertNoImage(evidencePath + evidenceId, restoredToken, 404);
    await assertNoImage(evidencePath + evidenceId, managerToken, 401);
  } finally {
    if (app) await app.close();
    if (cleanupMedia) await cleanupMedia();
    if (framePath) await unlink(framePath);
    if (mediaRoot) await rmdir(mediaRoot);
    if (profile?.isInitialized) await profile.destroy();
    await owned.dispose();
  }
});
