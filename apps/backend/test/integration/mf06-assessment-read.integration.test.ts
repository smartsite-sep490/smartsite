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
import { Mf06AssessmentQueryService } from '../../src/modules/safety/assessments/mf06-assessment-query.service.js';
import { parseMf06AssessmentResponse, parseMf06AssessmentPage } from '@smartsite/contracts';

test('actual AppModule assessment reads enforce scope/auth/default OFF/query boundaries and safe empty pages', async (t) => {
  const isolated = createIsolatedTestDatabase({ canonical: true }),
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
  const documented = document.paths['/api/v1/sites/{siteId}/mf06-assessments/{assessmentId}']?.get
    ?.responses?.['200'] as {
    content?: Record<string, { schema?: { properties?: Record<string, unknown> } }>;
  };
  const documentedSchema = documented?.content?.['application/json']?.schema as {
    required?: string[];
    properties?: Record<
      string,
      { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> }
    >;
  };
  assert.equal(
    Object.keys(documentedSchema?.properties ?? {}).length,
    14,
    'OpenAPI must retain safe13 legacy fields and declare optional frame delivery',
  );
  assert.equal(documentedSchema.required?.length, 13);
  assert.equal(documentedSchema.required?.includes('frameDelivery'), false);
  assert.equal(documentedSchema.properties?.frameDelivery?.additionalProperties, false);
  assert.deepEqual(
    documentedSchema.properties?.frameDelivery?.required?.slice().sort(),
    ['frameId', 'sequenceNumber', 'partCount', 'receivedParts', 'status'].sort(),
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
  assert.equal((await read(`/sites/${site}/mf06-assessments`, '')).status, 401);
  assert.equal((await read(`/sites/${otherSite}/mf06-assessments`)).status, 403);
  const first = await read(`/sites/${site}/mf06-assessments`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await first.json(), { items: [], total: 0, offset: 0, limit: 20 });
  assert.equal((await read(`/sites/${site}/mf06-assessments?limit=101`)).status, 400);
  assert.equal((await read(`/sites/${site}/mf06-assessments?unknown=1`)).status, 400);
  assert.equal((await read(`/sites/${site}/mf06-assessments/${randomUUID()}`)).status, 404);
  const partition = {
    frameId: randomUUID(),
    sequenceNumber: '18446744073709551615',
    partIndex: 1,
    partCount: 2,
  };
  const partial = await seedAssessment(db, 'UNAVAILABLE', site, partition);
  const detail = await read(`/sites/${site}/mf06-assessments/${partial.assessmentId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('cache-control'), 'private, no-store');
  const projected = parseMf06AssessmentResponse(await detail.json());
  assert.deepEqual(projected.frameDelivery, {
    frameId: partition.frameId,
    sequenceNumber: partition.sequenceNumber,
    partCount: 2,
    receivedParts: 1,
    status: 'PARTIAL',
  });
  assert.equal(projected.outcome, 'UNAVAILABLE');
  const populated = await read(`/sites/${site}/mf06-assessments`);
  assert.equal(populated.status, 200);
  assert.deepEqual(parseMf06AssessmentPage(await populated.json()).items[0], projected);
  assert.equal(
    (await read(`/sites/${otherSite}/mf06-assessments/${partial.assessmentId}`)).status,
    403,
  );
  assert.equal(
    (await read(`/sites/${site}/mf06-assessments/${partial.assessmentId}`, '')).status,
    401,
  );
  (config as unknown as ConfigService<Record<string, unknown>>).set(
    'MF06_ASSESSMENT_READ_ENABLED',
    false,
  );
  assert.equal((await read(`/sites/${site}/mf06-assessments`)).status, 503);
  (config as unknown as ConfigService<Record<string, unknown>>).set(
    'MF06_ASSESSMENT_READ_ENABLED',
    true,
  );
  const query = module.get(Mf06AssessmentQueryService),
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
  const pending = read(`/sites/${site}/mf06-assessments`);
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

test('populated reads retain original scope, exclude synthetic records and return exactly the public whitelist', async (t) => {
  const isolated = createIsolatedTestDatabase({ canonical: true }),
    db = isolated.dataSource;
  await isolated.initialize();
  t.after(() => isolated.dispose());
  const first = await seedAssessment(db, 'UNAVAILABLE');
  const synthetic = await seedAssessment(db, 'SYNTHETIC_TEST', first.siteId);
  const other = await seedAssessment(db, 'UNAVAILABLE');
  const query = new Mf06AssessmentQueryService(
    db,
    createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' }),
  );
  const page = await query.list(first.siteId);
  assert.equal(page.total, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.assessmentId, first.assessmentId);
  assert.deepEqual(
    Object.keys(page.items[0]!).sort(),
    [
      'assessmentId',
      'requestId',
      'siteId',
      'eventId',
      'cameraId',
      'zoneId',
      'capturedAt',
      'assessedAt',
      'purpose',
      'outcome',
      'reasonCode',
      'evaluatorVersion',
      'provenance',
    ].sort(),
  );
  assert.equal((await query.get(first.siteId, first.assessmentId)).outcome, 'UNAVAILABLE');
  await assert.rejects(
    () => query.get(first.siteId, other.assessmentId),
    (error: unknown) =>
      !!error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      (error as { getStatus(): number }).getStatus() === 404,
  );
  await assert.rejects(
    () => query.get(first.siteId, synthetic.assessmentId),
    (error: unknown) =>
      !!error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      (error as { getStatus(): number }).getStatus() === 404,
  );
  await db.getRepository(CameraEntity).update(first.cameraId, { siteId: other.siteId });
  assert.equal((await query.get(first.siteId, first.assessmentId)).siteId, first.siteId);
  const offset = await query.list(first.siteId, 1, 1);
  assert.deepEqual(offset, { items: [], total: 1, offset: 1, limit: 1 });
  const off = new Mf06AssessmentQueryService(db, createTestConfig());
  await db.query('ALTER TABLE zone_entry_assessment RENAME TO fixture_hidden_assessment');
  try {
    await assert.rejects(
      () => off.list(first.siteId),
      (error: unknown) =>
        !!error &&
        typeof error === 'object' &&
        'getStatus' in error &&
        (error as { getStatus(): number }).getStatus() === 503,
    );
    await assert.rejects(
      () => query.list(first.siteId),
      (error: unknown) =>
        !!error &&
        typeof error === 'object' &&
        'getStatus' in error &&
        (error as { getStatus(): number }).getStatus() === 503,
    );
  } finally {
    await db.query('ALTER TABLE fixture_hidden_assessment RENAME TO zone_entry_assessment');
  }
});

async function seedAssessment(
  db: DataSource,
  provenance: 'UNAVAILABLE' | 'SYNTHETIC_TEST',
  existingSite?: string,
  framePartition?: {
    frameId: string;
    sequenceNumber: string;
    partIndex: number;
    partCount: number;
  },
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
    AI_PARTITIONED_FRAME_ENABLED: framePartition ? 'true' : 'false',
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
    schemaVersion: framePartition ? '1.4.0' : '1.0.0',
    ...(framePartition ? { framePartition } : {}),
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
  return { siteId, cameraId, assessmentId: result.assessment.assessmentId };
}
