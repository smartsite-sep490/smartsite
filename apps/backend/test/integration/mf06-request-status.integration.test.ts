import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  UserEntity,
  UserRole,
  SiteEntity,
  UserRoleAssignmentEntity,
  CameraEntity,
  CameraObservationRegionEntity,
  ZoneEntity,
  CameraStatus,
  ZoneType,
  ZoneRestrictionPolicy,
} from '../../src/database/entities/index.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { Mf06IngestionEnqueueService } from '../../src/modules/safety/assessments/mf06-ingestion-enqueue.service.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { Mf06RequestStatusQueryService } from '../../src/modules/safety/assessments/mf06-request-status-query.service.js';

test('canonical39 actual AppModule request-status reads enforce scope/auth/default OFF/query boundaries and safe empty pages', async (t) => {
  const isolated = createIsolatedTestDatabase(),
    db = isolated.dataSource;
  await isolated.initialize();
  const site = randomUUID(),
    otherSite = randomUUID(),
    user = randomUUID();
  await db.getRepository(SiteEntity).insert([
    { id: site, code: site, name: 'Synthetic history scope' },
    { id: otherSite, code: otherSite, name: 'Other synthetic scope' },
  ]);
  await db.getRepository(UserEntity).insert({
    id: user,
    username: `history-${user}`,
    displayName: 'Synthetic Safety Officer',
    passwordHash: await hashPassword('SyntheticRead123!'),
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId: user, role: UserRole.SAFETY_OFFICER, siteId: site });
  const config = createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' });
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
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  t.after(async () => {
    await app.close();
    await isolated.dispose();
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().addBearerAuth(undefined, 'user-token').build(),
  );
  const documented = document.paths['/api/v1/sites/{siteId}/mf06-assessment-requests/{requestId}']
    ?.get?.responses?.['200'] as {
    content?: Record<string, { schema?: { properties?: Record<string, unknown> } }>;
  };
  assert.equal(
    Object.keys(documented?.content?.['application/json']?.schema?.properties ?? {}).length,
    13,
    'OpenAPI must declare the safe13-field response',
  );
  const base = `${await app.getUrl()}/api/v1`;
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `history-${user}`,
      password: 'SyntheticRead123!',
      clientType: 'MOBILE',
    }),
  });
  assert.equal(login.status, 200);
  const auth = (await login.json()) as { accessToken: string; refreshToken: string };
  assert.ok(auth.accessToken);
  const read = (path: string, token = auth.accessToken) =>
    fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await read(`/sites/${site}/mf06-assessment-requests`, '')).status, 401);
  assert.equal((await read(`/sites/${otherSite}/mf06-assessment-requests`)).status, 403);
  const first = await read(`/sites/${site}/mf06-assessment-requests`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await first.json(), { items: [], total: 0, offset: 0, limit: 20 });
  assert.equal((await read(`/sites/${site}/mf06-assessment-requests?limit=101`)).status, 400);
  assert.equal((await read(`/sites/${site}/mf06-assessment-requests?unknown=1`)).status, 400);
  assert.equal((await read(`/sites/${site}/mf06-assessment-requests/${randomUUID()}`)).status, 404);
  (config as unknown as ConfigService<Record<string, unknown>>).set(
    'MF06_ASSESSMENT_READ_ENABLED',
    false,
  );
  assert.equal((await read(`/sites/${site}/mf06-assessment-requests`)).status, 503);
  (config as unknown as ConfigService<Record<string, unknown>>).set(
    'MF06_ASSESSMENT_READ_ENABLED',
    true,
  );
  const query = module.get(Mf06RequestStatusQueryService),
    original = query.list.bind(query);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    resume = new Promise<void>((resolve) => {
      release = resolve;
    });
  query.list = async (...args) => {
    const value = await original(...args);
    entered();
    await resume;
    return value;
  };
  const pending = read(`/sites/${site}/mf06-assessment-requests`);
  await started;
  try {
    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientType: 'MOBILE', refreshToken: auth.refreshToken }),
    });
    assert.equal(logout.status, 204);
  } finally {
    release();
  }
  const refused = await pending;
  assert.equal(refused.status, 401);
  assert.equal(JSON.stringify(await refused.json()).includes('items'), false);
});

test('canonical39 persisted request states remain scoped, validated and read-only', async (t) => {
  const isolated = createIsolatedTestDatabase(),
    db = isolated.dataSource;
  const cleanup = { app: undefined as NestExpressApplication | undefined };
  t.after(async () => {
    await cleanup.app?.close();
    await isolated.dispose();
  });
  await isolated.initialize();
  const first = await seedAssessment(db, 'UNAVAILABLE');
  const synthetic = await seedAssessment(db, 'SYNTHETIC_TEST', first.siteId);
  const pending = await seedAssessment(db, 'UNAVAILABLE', first.siteId, false);
  const claimed = await seedAssessment(db, 'UNAVAILABLE', first.siteId, false);
  const failed = await seedAssessment(db, 'UNAVAILABLE', first.siteId, false);
  const cancelled = await seedAssessment(db, 'UNAVAILABLE', first.siteId, false);
  const unqueued = await seedAssessment(db, 'UNAVAILABLE', first.siteId, false);
  const other = await seedAssessment(db, 'UNAVAILABLE', undefined, false);
  await db.query(
    "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='CLAIMED',attempt_count=1,lease_token=$2,lease_expires_at=deadline_at WHERE request_id=$1",
    [claimed.requestId, randomUUID()],
  );
  await db.query(
    "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='FAILED',last_error_code='PRIVATE_FAILURE' WHERE request_id=$1",
    [failed.requestId],
  );
  await db.query(
    "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='CANCELLED' WHERE request_id=$1",
    [cancelled.requestId],
  );
  // File-owned absent-job fixture: production job heads are intentionally not deletable.
  await db.query('ALTER TABLE zone_entry_assessment_job DISABLE TRIGGER trg_mf06_job_head_update');
  await db.query('ALTER TABLE zone_entry_assessment_job DISABLE TRIGGER trg_mf06_b2_job_complete');
  try {
    const removed = await db.query(
      'DELETE FROM zone_entry_assessment_job WHERE request_id=$1 RETURNING request_id',
      [unqueued.requestId],
    );
    assert.ok(removed);
    const [remaining] = await db.query(
      'SELECT count(*)::int AS total FROM zone_entry_assessment_job WHERE request_id=$1',
      [unqueued.requestId],
    );
    assert.equal(remaining.total, 0);
  } finally {
    await db.query('ALTER TABLE zone_entry_assessment_job ENABLE TRIGGER trg_mf06_job_head_update');
    await db.query('ALTER TABLE zone_entry_assessment_job ENABLE TRIGGER trg_mf06_b2_job_complete');
  }
  const query = new Mf06RequestStatusQueryService(
    db,
    createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' }),
  );
  const userId = randomUUID(),
    username = `status-${userId}`;
  await db.getRepository(UserEntity).insert({
    id: userId,
    username,
    displayName: 'Synthetic request reader',
    passwordHash: await hashPassword('SyntheticRead123!'),
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId, role: UserRole.SAFETY_OFFICER, siteId: first.siteId });
  const config = createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' });
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
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  cleanup.app = app;
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'SyntheticRead123!', clientType: 'MOBILE' }),
    });
    assert.equal(login.status, 200);
    const auth = (await login.json()) as { accessToken: string };
    const read = (path: string) =>
      fetch(`${base}/sites/${first.siteId}/mf06-assessment-requests${path}`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
    await t.test(
      'populated public HTTP list/detail expose all six stored states with safe headers',
      async () => {
        const list = await read('');
        assert.equal(list.status, 200);
        assert.equal(list.headers.get('cache-control'), 'private, no-store');
        const body = (await list.json()) as { items: { jobStatus: string }[]; total: number };
        assert.equal(body.total, 6);
        assert.deepEqual(
          body.items.map((item) => item.jobStatus).sort(),
          ['SUCCEEDED', 'PENDING', 'CLAIMED', 'FAILED', 'CANCELLED', 'NOT_QUEUED'].sort(),
        );
        for (const fixture of [first, pending, claimed, failed, cancelled, unqueued]) {
          const detail = await read(`/${fixture.requestId}`);
          assert.equal(detail.status, 200);
          assert.deepEqual(await detail.json(), await query.get(first.siteId, fixture.requestId));
        }
        assert.equal((await read(`/${synthetic.requestId}`)).status, 404);
        assert.equal((await read(`/${other.requestId}`)).status, 404);
        for (const suffix of [
          '?limit=0',
          '?offset=-1',
          '?limit=1&limit=2',
          '?face=private',
          `/${pending.requestId}?limit=1`,
        ])
          assert.equal((await read(suffix)).status, 400);
      },
    );
    await t.test('role revocation during held detail response removes the result', async () => {
      const bound = module.get(Mf06RequestStatusQueryService),
        original = bound.get.bind(bound);
      let entered!: () => void, release!: () => void;
      const held = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        resume = new Promise<void>((resolve) => {
          release = resolve;
        });
      bound.get = async (...args) => {
        const result = await original(...args);
        entered();
        await resume;
        return result;
      };
      const request = read(`/${pending.requestId}`);
      await held;
      try {
        await db.getRepository(UserRoleAssignmentEntity).delete({ userId });
      } finally {
        release();
      }
      const refused = await request;
      assert.equal(refused.status, 401);
      assert.equal(JSON.stringify(await refused.json()).includes('jobStatus'), false);
      bound.get = original;
    });
  }
  const states = [
    [first, 'SUCCEEDED'],
    [pending, 'PENDING'],
    [claimed, 'CLAIMED'],
    [failed, 'FAILED'],
    [cancelled, 'CANCELLED'],
    [unqueued, 'NOT_QUEUED'],
  ] as const;
  const before = (
    await db.query(
      'SELECT to_jsonb(j) AS value FROM zone_entry_assessment_job j ORDER BY request_id',
    )
  ).map((row: { value: unknown }) => row.value);
  for (const [fixture, status] of states)
    await t.test(`public ${status} exposes exactly safe13 fields`, async () => {
      const result = await query.get(first.siteId, fixture.requestId);
      assert.equal(result.jobStatus, status);
      assert.equal(result.siteId, first.siteId);
      assert.equal(result.cameraId, fixture.cameraId);
      assert.equal(Object.keys(result).length, 13);
      for (const key of [
        'workerId',
        'leaseToken',
        'lastErrorCode',
        'bindingHash',
        'payloadHash',
        'trackId',
      ])
        assert.equal(Object.hasOwn(result, key), false);
      if (status === 'NOT_QUEUED')
        assert.deepEqual(
          [result.attemptCount, result.deadlineAt, result.deadlinePassed, result.assessmentId],
          [null, null, false, null],
        );
      if (status === 'SUCCEEDED') assert.equal(result.assessmentId, first.assessmentId);
      else assert.equal(result.assessmentId, null);
    });
  await t.test(
    'stable original-scope pagination excludes synthetic and cross-Site requests',
    async () => {
      const page = await query.list(first.siteId, 0, 2);
      const expected = await db.query(
        "SELECT r.request_id FROM zone_entry_assessment_request r LEFT JOIN zone_entry_assessment a ON a.request_id=r.request_id WHERE r.site_id=$1 AND (a.assessment_id IS NULL OR a.provenance<>'SYNTHETIC_TEST') ORDER BY r.captured_at DESC,r.request_id DESC",
        [first.siteId],
      );
      assert.equal(page.total, 6);
      assert.deepEqual(
        page.items.map((row) => row.requestId),
        expected.slice(0, 2).map((row: { request_id: string }) => row.request_id),
      );
      assert.deepEqual(
        (await query.list(first.siteId, 2, 2)).items.map((row) => row.requestId),
        expected.slice(2, 4).map((row: { request_id: string }) => row.request_id),
      );
      assert.deepEqual(await query.list(first.siteId, 6, 2), {
        items: [],
        total: 6,
        offset: 6,
        limit: 2,
      });
      await assert.rejects(() => query.get(first.siteId, synthetic.requestId), hasStatus(404));
      await assert.rejects(() => query.get(first.siteId, other.requestId), hasStatus(404));
      await db.getRepository(CameraEntity).update(first.cameraId, { siteId: other.siteId });
      assert.equal((await query.get(first.siteId, first.requestId)).siteId, first.siteId);
    },
  );
  await t.test('reads preserve every persisted job head', async () => {
    const after = (
      await db.query(
        'SELECT to_jsonb(j) AS value FROM zone_entry_assessment_job j ORDER BY request_id',
      )
    ).map((row: { value: unknown }) => row.value);
    assert.deepEqual(after, before);
  });
  await t.test(
    'expired deadline annotates PENDING and CLAIMED without changing status',
    async () => {
      // File-owned expired-clock fixture; production created_at remains immutable.
      await db.query(
        'ALTER TABLE zone_entry_assessment_job DISABLE TRIGGER trg_mf06_job_head_update',
      );
      try {
        for (const fixture of [pending, claimed]) {
          await db.query(
            "UPDATE zone_entry_assessment_job SET created_at=transaction_timestamp()-interval '3 hours',deadline_at=transaction_timestamp()-interval '1 hour',lease_expires_at=CASE WHEN status='CLAIMED' THEN transaction_timestamp()-interval '2 hours' ELSE NULL END WHERE request_id=$1",
            [fixture.requestId],
          );
          const result = await query.get(first.siteId, fixture.requestId);
          assert.equal(result.deadlinePassed, true);
          assert.equal(result.jobStatus, fixture === pending ? 'PENDING' : 'CLAIMED');
        }
      } finally {
        await db.query(
          'ALTER TABLE zone_entry_assessment_job ENABLE TRIGGER trg_mf06_job_head_update',
        );
      }
    },
  );
  await t.test('job success without validated assessment fails closed', async () => {
    await db.query(
      "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='SUCCEEDED' WHERE request_id=$1",
      [pending.requestId],
    );
    await assert.rejects(() => query.get(first.siteId, pending.requestId), hasStatus(503));
    await assert.rejects(() => query.list(first.siteId), hasStatus(503));
    await db.query(
      "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='PENDING' WHERE request_id=$1",
      [pending.requestId],
    );
  });
  await t.test('a completed record with mismatched operational status fails closed', async () => {
    await db.query(
      'ALTER TABLE zone_entry_assessment_job DISABLE TRIGGER trg_mf06_b2_job_complete',
    );
    try {
      await db.query(
        "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='FAILED' WHERE request_id=$1",
        [first.requestId],
      );
      await assert.rejects(() => query.get(first.siteId, first.requestId), hasStatus(503));
      await db.query(
        "UPDATE zone_entry_assessment_job SET head_revision=head_revision+1,status='SUCCEEDED' WHERE request_id=$1",
        [first.requestId],
      );
    } finally {
      await db.query(
        'ALTER TABLE zone_entry_assessment_job ENABLE TRIGGER trg_mf06_b2_job_complete',
      );
    }
  });
  await t.test(
    'stored assessment command corruption cannot produce a success response',
    async () => {
      await db.query(
        'ALTER TABLE zone_entry_assessment DISABLE TRIGGER trg_mf06_b2_assessment_immutable',
      );
      const [original] = await db.query(
        'SELECT command_hash FROM zone_entry_assessment WHERE assessment_id=$1',
        [first.assessmentId],
      );
      try {
        await db.query('UPDATE zone_entry_assessment SET command_hash=$2 WHERE assessment_id=$1', [
          first.assessmentId,
          '0'.repeat(64),
        ]);
        await assert.rejects(() => query.get(first.siteId, first.requestId), hasStatus(503));
        await db.query('UPDATE zone_entry_assessment SET command_hash=$2 WHERE assessment_id=$1', [
          first.assessmentId,
          original.command_hash,
        ]);
      } finally {
        await db.query(
          'ALTER TABLE zone_entry_assessment ENABLE TRIGGER trg_mf06_b2_assessment_immutable',
        );
      }
    },
  );
  await t.test(
    'missing selected-namespace job relation never falls back through search_path',
    async () => {
      await db.query('ALTER TABLE zone_entry_assessment_job RENAME TO fixture_hidden_job');
      try {
        await assert.rejects(() => query.list(first.siteId), hasStatus(503));
      } finally {
        await db.query('ALTER TABLE fixture_hidden_job RENAME TO zone_entry_assessment_job');
      }
    },
  );
});

function hasStatus(status: number) {
  return (error: unknown) =>
    !!error &&
    typeof error === 'object' &&
    'getStatus' in error &&
    (error as { getStatus(): number }).getStatus() === status;
}

async function seedAssessment(
  db: DataSource,
  provenance: 'UNAVAILABLE' | 'SYNTHETIC_TEST',
  existingSite?: string,
  finish = true,
) {
  const siteId = existingSite ?? randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    regionId = randomUUID(),
    eventId = randomUUID();
  if (!existingSite)
    await db
      .getRepository(SiteEntity)
      .insert({ id: siteId, code: siteId, name: 'Synthetic read Site' });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Synthetic metadata camera',
    status: CameraStatus.ACTIVE,
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic read Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [],
  });
  await db.getRepository(CameraObservationRegionEntity).insert({
    id: regionId,
    cameraId,
    zoneId,
    version: 1,
    isActive: true,
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: { type: 'Polygon', coordinates: [] },
  });
  const config = createTestConfig({
    MF06_ENQUEUE_ENABLED: 'true',
    MF06_ENQUEUE_MAX_OUTSTANDING: '100',
  });
  const ingest = new AiIngestionService(
    db,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    new DurableGroupingService(config, new SchedulingNotificationService(db)),
    config,
    undefined,
    undefined,
    new Mf06IngestionEnqueueService(db, config),
  );
  await ingest.ingestEvent({
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: cameraId,
    streamSessionId: randomUUID(),
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        confidence: 0.9,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 1 },
    ],
    evidence: [],
  });
  const [created] = await db.query(
    'SELECT request_id FROM zone_entry_assessment_request WHERE event_id=$1',
    [eventId],
  );
  assert.ok(created?.request_id);
  if (!finish)
    return { siteId, cameraId, requestId: String(created.request_id), assessmentId: null };
  const claim = await new Mf06JobLeaseService(db, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  }).claim();
  assert.ok(claim);
  const [request] = await db.query(
    'SELECT binding_hash FROM zone_entry_assessment_request WHERE request_id=$1',
    [claim.requestId],
  );
  const result = await new Mf06AssessmentStore(db).finalize({
    claim: {
      requestId: claim.requestId,
      leaseToken: claim.leaseToken,
      headRevision: claim.headRevision,
    },
    commandId: randomUUID(),
    siteId,
    bindingHash: request.binding_hash,
    evaluatorVersion: 'SYNTHETIC_READ_FIXTURE_V1',
    outcome: 'UNAVAILABLE',
    reasonCode: 'SERVICE_DISABLED',
    provenance,
    workerId: null,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: null,
  });
  if (result.state !== 'RECORDED') throw new Error('Fixture assessment not recorded');
  return {
    siteId,
    cameraId,
    requestId: claim.requestId,
    assessmentId: result.assessment.assessmentId,
  };
}
