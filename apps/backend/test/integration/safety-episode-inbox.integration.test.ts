import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { SafetyEpisodeInboxService } from '../../src/modules/safety/alerts/safety-episode-inbox.service.js';
import { SafetyAlertEvidenceService } from '../../src/modules/safety/alerts/safety-alert-evidence.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
const password = 'Synthetic_test_password_123';
let app: NestExpressApplication, auth: AuthService, inbox: SafetyEpisodeInboxService, url: string;
let hashedPassword: string;
let evidenceRoot: string;
before(async () => {
  await owned.initialize();
  hashedPassword = await hashPassword(password);
  evidenceRoot = join(tmpdir(), `episode-http-${randomUUID()}`);
  await mkdir(evidenceRoot);
  const config = createTestConfig({ LOG_FORMAT: 'json', EVIDENCE_LOCAL_ROOT: evidenceRoot });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  auth = module.get(AuthService);
  inbox = module.get(SafetyEpisodeInboxService);
  url = `${await app.getUrl()}/api/v1/me/safety-episode-inbox`;
});

test('episode detail returns only exact-subject findings and hash-bound evidence', async () => {
  const f = await fixture();
  const [camera] = await db.query('SELECT camera_id FROM safety_episode WHERE id=$1', [
    f.episodes[0],
  ]);
  const event = randomUUID(),
    session = randomUUID(),
    episode = randomUUID();
  // Synthetic JPEG marker fixture verifies digest/file handling, not image quality or a real detection.
  const bytes = Buffer.from([255, 216, 255, 217]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const payload = {
    schemaVersion: '1.2.0',
    eventId: event,
    cameraExternalId: camera.camera_id,
    streamSessionId: session,
    capturedAt: '2026-10-29T00:00:00Z',
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      {
        type: 'PERSON',
        trackId: 8,
        boundingBox: { x1: 0.6, y1: 0.1, x2: 0.9, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [
      { kind: 'FRAME', uri: `local://evidence/${session}/1/${event}.jpg`, sha256 },
      { kind: 'CROP', trackId: 8, uri: `local://evidence/${session}/1/${event}.jpg`, sha256 },
    ],
  };
  const hash = computeCanonicalPayloadHash(payload);
  await writeFile(join(evidenceRoot, `${session}_1_${event}.jpg`), bytes);
  await db.query(
    `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
    VALUES($1,$2,$3::text,$3::uuid,$4,$5,$6::jsonb,'PROCESSED')`,
    [event, hash, camera.camera_id, session, payload.capturedAt, JSON.stringify(payload)],
  );
  await db.query(
    `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
    VALUES($1,$2,$3,$4,0,$5,$6,$6)`,
    [episode, f.sites[0], camera.camera_id, event, hash, payload.capturedAt],
  );
  const alerts = [randomUUID(), randomUUID()];
  for (const [index, alert] of alerts.entries()) {
    await db.query(
      `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,status,first_detected_at,last_detected_at)
      VALUES($1::uuid,$2,$3,'PPE_VIOLATION',$4,$1::text,$5,now(),now())`,
      [
        alert,
        f.sites[0],
        episode,
        index === 0 ? 'PPE_HARD_HAT_MISSING' : 'PPE_SAFETY_VEST_MISSING',
        index === 0 ? 'PENDING_REVIEW' : 'DISMISSED',
      ],
    );
    await db.query(
      'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,0)',
      [alert, event],
    );
  }
  const headers = { Authorization: `Bearer ${f.session.accessToken}` };
  const endpoint = `${url.split('/me/')[0]}/sites/${f.sites[0]}/safety-episodes/${episode}`;
  const response = await fetch(endpoint, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const detail = await response.json();
  assert.equal(detail.id, episode);
  assert.equal(detail.findingCount, 2);
  assert.deepEqual(
    detail.findings.map((item: { alertId: string }) => item.alertId).sort(),
    alerts.sort(),
  );
  assert.deepEqual(detail.findings.map((item: { status: string }) => item.status).sort(), [
    'DISMISSED',
    'PENDING_REVIEW',
  ]);
  assert.equal(detail.identityDecision, null);
  assert.deepEqual(detail.workflowLinks, []);
  for (const finding of detail.findings)
    assert.deepEqual(finding.evidenceRefs, [
      { eventId: event, personObservationIndex: 0, evidenceIndex: 0, sha256, available: true },
    ]);
  assert.ok(!JSON.stringify(detail).includes('local://'));
  const incident = randomUUID(),
    action = randomUUID(),
    resolution = randomUUID(),
    decision = randomUUID();
  await db.query(
    `INSERT INTO incident(id,site_id,title,description,severity,status,occurred_at,reported_by) VALUES($1,$2,'Synthetic incident','Synthetic detail test','LOW','OPEN',now(),$3)`,
    [incident, f.sites[0], f.user],
  );
  await db.query(
    `INSERT INTO corrective_action(id,incident_id,assigned_to,assigned_by,description,status) VALUES($1,$2,$3,$3,'Synthetic correction','ASSIGNED')`,
    [action, incident, f.user],
  );
  await db.query('UPDATE safety_alert SET incident_id=$1 WHERE episode_id=$2', [incident, episode]);
  const subjectRef = {
    eventId: event,
    personObservationIndex: 0,
    payloadHash: hash,
    cameraId: camera.camera_id,
    cameraExternalId: camera.camera_id,
    streamSessionId: session,
    capturedAt: payload.capturedAt,
    trackId: 7,
    personBoundingBox: payload.observations[0]!.boundingBox,
  };
  // Stored CLEAR fixture tests faithful projection only; it does not claim an actual manual decision journey.
  await db.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO observation_identity_resolution(id,event_id,person_observation_index,site_id,payload_hash,subject_ref) VALUES($1,$2,0,$3,$4,$5::jsonb)`,
      [resolution, event, f.sites[0], hash, JSON.stringify(subjectRef)],
    );
    await manager.query(
      `INSERT INTO observation_identity_decision(id,resolution_id,site_id,actor_user_id,revision,expected_revision,command_hash,action,reason) VALUES($1,$2,$3,$4,1,0,$5,'CLEAR','Synthetic review cleared')`,
      [decision, resolution, f.sites[0], f.user, 'b'.repeat(64)],
    );
    await manager.query(
      'UPDATE observation_identity_resolution SET revision=1,current_decision_id=$1 WHERE id=$2',
      [decision, resolution],
    );
  });
  const linked = await (await fetch(endpoint, { headers })).json();
  assert.equal(linked.identityDecision.id, decision);
  assert.equal(linked.identityDecision.action, 'CLEAR');
  assert.equal(linked.identityDecision.workerId, null);
  assert.deepEqual(linked.workflowLinks, [
    { incidentId: incident, status: 'OPEN', actions: [{ actionId: action, status: 'ASSIGNED' }] },
  ]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,NULL,'ADMIN')",
    [randomUUID(), f.user],
  );
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2', [
    f.user,
    f.sites[0],
  ]);
  assert.equal((await (await fetch(endpoint, { headers })).json()).identityDecision, null);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
    [randomUUID(), f.user, f.sites[0]],
  );
  await db.query("DELETE FROM user_role_assignment WHERE user_id=$1 AND role='ADMIN'", [f.user]);
  await writeFile(
    join(evidenceRoot, `${session}_1_${event}.jpg`),
    Buffer.from([255, 216, 0, 255, 217]),
  );
  const stale = await (await fetch(endpoint, { headers })).json();
  assert.equal(stale.findings[0].evidenceRefs[0].available, false);
  assert.equal((await fetch(endpoint + '?includeSecrets=true', { headers })).status, 400);
  assert.equal((await fetch(endpoint.replace(episode, randomUUID()), { headers })).status, 404);
  assert.equal((await fetch(endpoint.replace(f.sites[0]!, f.sites[1]!), { headers })).status, 404);
  await db.query(
    'UPDATE alert_detection_mapping SET person_observation_index=1 WHERE alert_id=$1',
    [alerts[0]],
  );
  assert.equal((await fetch(endpoint, { headers })).status, 409);
  await db.query(
    'UPDATE alert_detection_mapping SET person_observation_index=0 WHERE alert_id=$1',
    [alerts[0]],
  );
  const media = app.get(SafetyAlertEvidenceService);
  const originalRead = media.read;
  // A role revocation commits during file IO, after the first snapshot transaction is closed.
  media.read = async function (...args) {
    media.read = originalRead;
    await db.query('DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2', [
      f.user,
      f.sites[0],
    ]);
    return originalRead.apply(this, args);
  };
  try {
    assert.equal((await fetch(endpoint, { headers })).status, 403);
  } finally {
    media.read = originalRead;
  }
});
after(async () => {
  if (app) await app.close();
  await owned.dispose();
});

// Synthetic persisted projections test query/auth behavior, not detector or notification delivery.
async function fixture() {
  const user = randomUUID(),
    stranger = randomUUID();
  const username = `inbox-${user}`;
  await db.query(
    `INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$2,'Synthetic Officer',$3),($4::uuid,$4::text,'Synthetic other',$3)`,
    [user, username, hashedPassword, stranger],
  );
  const sites = [randomUUID(), randomUUID(), randomUUID()];
  const episodes: string[] = [],
    recipients: string[] = [];
  for (const [index, site] of sites.entries()) {
    const camera = randomUUID(),
      event = randomUUID(),
      episode = randomUUID(),
      recipient = randomUUID();
    await db.query('INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text)', [site]);
    await db.query(
      'INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1::uuid,$2,$1::text,$1::text,$1::text)',
      [camera, site],
    );
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,$3::text,$3::uuid,$4,'2026-10-29T00:00:00Z',$5::jsonb,'PROCESSED')`,
      [
        event,
        'a'.repeat(64),
        camera,
        randomUUID(),
        JSON.stringify({ observations: [{ type: 'PERSON', trackId: 7 }] }),
      ],
    );
    await db.query(
      `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
      VALUES($1,$2,$3,$4,0,$5,'2026-10-29T00:00:00Z','2026-10-29T00:00:00Z')`,
      [episode, site, camera, event, 'a'.repeat(64)],
    );
    await db.query(
      `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,first_detected_at,last_detected_at)
      VALUES($1::uuid,$2,$3,'PPE_VIOLATION','PPE_HARD_HAT_MISSING',$1::text,now(),now())`,
      [randomUUID(), site, episode],
    );
    await db.query(
      `INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id) VALUES($1,$2,$3,$4)`,
      [recipient, episode, site, user],
    );
    if (index < 2)
      await db.query(
        `INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')`,
        [randomUUID(), user, site],
      );
    episodes.push(episode);
    recipients.push(recipient);
  }
  const strangerRecipient = randomUUID();
  await db.query(
    `INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id) VALUES($1,$2,$3,$4)`,
    [strangerRecipient, episodes[0], sites[0], stranger],
  );
  const session = await auth.login(username, password, AuthClientType.WEB);
  const request = (): AuthenticatedRequest => ({
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  return { user, sites, episodes, recipients, strangerRecipient, session, request };
}
const status =
  (expected: number) =>
  (error: unknown): boolean =>
    typeof (error as { getStatus?: () => number })?.getStatus === 'function' &&
    (error as { getStatus(): number }).getStatus() === expected;

test('list/count/filter/read remain scoped to the current recipient and current Site roles', async () => {
  const f = await fixture();
  const first = await inbox.list(f.request(), { limit: '1' });
  assert.equal(first.items.length, 1);
  assert.equal(first.total, 2);
  assert.equal(first.unreadCount, 2);
  assert.ok(!first.items.some((item) => item.episode.siteId === f.sites[2]));
  await inbox.read(f.request(), f.recipients[0]!, { seenRevision: 1 });
  const unread = await inbox.list(f.request(), { readStatus: 'UNREAD' });
  assert.equal(unread.total, 1);
  assert.equal(unread.unreadCount, 1);
  const all = await inbox.list(f.request());
  assert.equal(all.total, 2);
  assert.equal(all.unreadCount, 1);
  await assert.rejects(
    inbox.read(f.request(), f.strangerRecipient, { seenRevision: 1 }),
    status(404),
  );
  await assert.rejects(inbox.list(f.request(), { siteId: f.sites[2] }), status(403));
  await db.query(
    "DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SAFETY_OFFICER'",
    [f.user, f.sites[0]],
  );
  await assert.rejects(inbox.list(f.request(), { siteId: f.sites[0] }), status(403));
  await assert.rejects(inbox.read(f.request(), f.recipients[0]!, { seenRevision: 1 }), status(404));
  assert.equal((await inbox.list(f.request())).total, 1);
});

test('read preserves a newer unread revision, cannot move backwards and rejects future revisions', async () => {
  const f = await fixture(),
    id = f.recipients[0]!;
  await db.query('UPDATE safety_episode SET content_revision=3 WHERE id=$1', [f.episodes[0]]);
  assert.deepEqual(await inbox.read(f.request(), id, { seenRevision: 1 }), {
    id,
    contentRevision: 3,
    seenRevision: 1,
    unread: true,
  });
  await inbox.read(f.request(), id, { seenRevision: 2 });
  assert.equal((await inbox.read(f.request(), id, { seenRevision: 1 })).seenRevision, 2);
  await assert.rejects(inbox.read(f.request(), id, { seenRevision: 4 }), status(409));
  assert.equal((await inbox.read(f.request(), id, { seenRevision: 3 })).unread, false);
  await auth.logout(f.session.refreshToken, AuthClientType.WEB);
  await assert.rejects(inbox.read(f.request(), id, { seenRevision: 3 }), status(401));
});

test('registered HTTP routes require authentication, reject unscoped input and return no-store responses', async () => {
  const f = await fixture(),
    headers = { Authorization: `Bearer ${f.session.accessToken}` };
  assert.equal((await fetch(url)).status, 401);
  const list = await fetch(url, { headers });
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.equal((await list.json()).total, 2);
  for (const query of ['?siteId=', '?recipientId=other', '?readStatus=INVALID', '?limit=101'])
    assert.equal((await fetch(url + query, { headers })).status, 400);
  const response = await fetch(`${url}/${f.recipients[0]}/read`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seenRevision: 1 }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const invalid = await fetch(`${url}/${f.recipients[0]}/read`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seenRevision: 1, recipientId: f.user }),
  });
  assert.equal(invalid.status, 400);
});

test('explicit null filters cannot expand scope', async () => {
  const f = await fixture();
  for (const query of [{ siteId: null }, { readStatus: null }])
    await assert.rejects(inbox.list(f.request(), query), status(400));
});

test('password-required accounts retain the standard error code', async () => {
  const f = await fixture();
  await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.user]);
  await assert.rejects(inbox.list(f.request()), (error: unknown) => {
    const failure = error as { getStatus(): number; getResponse(): { code: string } };
    return failure.getStatus() === 403 && failure.getResponse().code === 'PASSWORD_CHANGE_REQUIRED';
  });
});

test('Site episode list scopes camera/Zone filters, pagination and live grants over HTTP', async () => {
  const f = await fixture();
  const headers = { Authorization: `Bearer ${f.session.accessToken}` };
  const endpoint = `${url.split('/me/')[0]}/sites/${f.sites[0]}/safety-episodes`;
  const response = await fetch(endpoint, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await response.json();
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, f.episodes[0]);
  assert.equal(page.items[0].subject.kind, 'EVENT_LOCAL');
  assert.equal(page.items[0].findingCount, 1);
  assert.equal((await (await fetch(endpoint + '?offset=1&limit=1', { headers })).json()).total, 1);
  assert.equal(
    (await (await fetch(endpoint + '?offset=1&limit=1', { headers })).json()).items.length,
    0,
  );
  const [camera] = await db.query('SELECT camera_id FROM safety_episode WHERE id=$1', [
    f.episodes[0],
  ]);
  const [otherCamera] = await db.query('SELECT camera_id FROM safety_episode WHERE id=$1', [
    f.episodes[1],
  ]);
  assert.equal(
    (await (await fetch(endpoint + `?cameraId=${camera.camera_id}`, { headers })).json()).total,
    1,
  );
  assert.equal(
    (await (await fetch(endpoint + `?cameraId=${otherCamera.camera_id}`, { headers })).json())
      .total,
    0,
  );
  const zone = randomUUID();
  await db.query(
    `INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,'EPISODE','Synthetic','STANDARD','NONE')`,
    [zone, f.sites[0]],
  );
  await db.query('UPDATE safety_alert SET zone_id=$1 WHERE episode_id=$2', [zone, f.episodes[0]]);
  assert.equal((await (await fetch(endpoint + `?zoneId=${zone}`, { headers })).json()).total, 1);
  assert.equal(
    (await (await fetch(endpoint + `?zoneId=${randomUUID()}`, { headers })).json()).total,
    0,
  );
  for (const query of ['?cameraId=', '?zoneId=bad', '?recipientId=other', '?limit=101'])
    assert.equal((await fetch(endpoint + query, { headers })).status, 400);
  assert.equal((await fetch(endpoint)).status, 401);
  const newerEvent = randomUUID(),
    newerEpisode = randomUUID();
  await db.query(
    `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status)
    SELECT $1,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at+interval '1 hour',raw_payload,processing_status
    FROM ai_observation_event WHERE event_id=(SELECT event_id FROM safety_episode WHERE id=$2)`,
    [newerEvent, f.episodes[0]],
  );
  await db.query(
    `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
    SELECT $1,site_id,camera_id,$2,0,payload_hash,first_observed_at+interval '1 hour',first_observed_at+interval '1 hour' FROM safety_episode WHERE id=$3`,
    [newerEpisode, newerEvent, f.episodes[0]],
  );
  await db.query(
    `INSERT INTO safety_alert(id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,first_detected_at,last_detected_at)
    VALUES($1::uuid,$2,$3,'PPE_VIOLATION','PPE_HARD_HAT_MISSING',$1::text,now(),now())`,
    [randomUUID(), f.sites[0], newerEpisode],
  );
  await db.query(
    "UPDATE safety_episode SET last_observed_at=first_observed_at+interval '1 day' WHERE id=$1",
    [f.episodes[0]],
  );
  assert.equal((await (await fetch(endpoint, { headers })).json()).items[0].id, newerEpisode);
  await db.query(
    "DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SAFETY_OFFICER'",
    [f.user, f.sites[0]],
  );
  assert.equal((await fetch(endpoint, { headers })).status, 403);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
    [randomUUID(), f.user, f.sites[0]],
  );
  assert.equal((await fetch(endpoint, { headers })).status, 403);
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.user]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,NULL,'ADMIN')",
    [randomUUID(), f.user],
  );
  assert.equal((await fetch(endpoint, { headers })).status, 200);
  const otherSiteEndpoint = endpoint.replace(f.sites[0]!, f.sites[2]!);
  assert.equal(
    (await (await fetch(otherSiteEndpoint, { headers })).json()).items[0].id,
    f.episodes[2],
  );
  await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.user]);
  const blocked = await fetch(endpoint, { headers });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'PASSWORD_CHANGE_REQUIRED');
  await db.query('UPDATE app_user SET must_change_password=false WHERE id=$1', [f.user]);
  await auth.logout(f.session.refreshToken, AuthClientType.WEB);
  assert.equal((await fetch(endpoint, { headers })).status, 401);
});
