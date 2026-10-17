import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  computeCanonicalPayloadHash,
  type AccountResponse,
  type CameraResponse,
  type LoginResponse,
  type ObservationIdentityContextResponse,
  type ObservationIdentityDecisionCommand,
  type ObservationIdentityDecisionResponse,
  type ObservationIdentityMutationResponse,
  type ObservationIdentityWorkerResponse,
  type Page,
  type RegionMutationResponse,
  type SafetyAlertResponse,
  type SafetyAlertReviewMutationResponse,
  type SiteResponse,
  type WorkerResponse,
  type ZoneResponse,
} from '@smartsite/contracts';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { AiObservationEventEntity } from '../../src/database/entities/ai-observation-event.entity.js';
import { ZoneEntryDecisionEntity } from '../../src/database/entities/zone-entry-decision.entity.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { syntheticJpeg } from '../support/synthetic-jpeg.js';

interface IngestionResult {
  eventId: string;
  status: string;
  alertIds: string[];
}

test(
  'real HTTP ingestion, Workforce identity review and evidence remain scoped after restart',
  { timeout: 60_000 },
  async (t) => {
    const isolated = createIsolatedTestDatabase({ canonical: true });
    const db = isolated.dataSource;
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'smartsite-business-http-'));
    let app: NestExpressApplication | undefined;
    t.after(async () => {
      try {
        if (app) await app.close();
      } finally {
        try {
          await isolated.dispose();
        } finally {
          const owned = resolve(evidenceRoot);
          assert.equal(dirname(owned).toLowerCase(), resolve(tmpdir()).toLowerCase());
          assert.ok(basename(owned).startsWith('smartsite-business-http-'));
          await rm(owned, { recursive: true, force: true });
        }
      }
    });
    await isolated.initialize();
    const origin = 'http://127.0.0.1:5173';
    const serviceToken = 'synthetic-business-http-service-token';
    const config = createTestConfig({
      CORS_ORIGINS: origin,
      EVIDENCE_LOCAL_ROOT: evidenceRoot,
      SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
    });
    async function startApp() {
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
        logger: false,
        bodyParser: false,
      });
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      return `${await app.getUrl()}/api/v1`;
    }
    // Seed the Admin, then assign the real scoped Manager role for Zone writes.
    // Business records below still use guarded HTTP, never an Admin bypass.
    await new UsersService(db, new SiteConfigurationService(db)).bootstrap(
      'business-admin',
      'Synthetic Admin',
      'InitialAdmin123!',
    );
    let base = await startApp();
    async function request<T = undefined>(
      route: string,
      options: {
        method?: string;
        body?: unknown;
        token?: string;
        expected?: number;
      } = {},
    ): Promise<T> {
      const headers: Record<string, string> = { Origin: origin };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${base}${route}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(8_000),
      });
      assert.equal(response.status, options.expected ?? 200, `${options.method ?? 'GET'} ${route}`);
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const login = async (username: string, password: string) => {
      const result = await request<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username, password, clientType: 'WEB' },
      });
      assert.equal(result.refreshToken, undefined);
      return result.accessToken;
    };
    let admin = await login('business-admin', 'InitialAdmin123!');
    await request('/sites', { token: admin, expected: 200 });
    await request('/auth/change-password', {
      method: 'POST',
      token: admin,
      expected: 204,
      body: { currentPassword: 'InitialAdmin123!', newPassword: 'ChangedAdmin123!' },
    });
    admin = await login('business-admin', 'ChangedAdmin123!');
    const create = <T>(route: string, body: unknown, token = admin) =>
      request<T>(route, { method: 'POST', token, body, expected: 201 });
    const site = await create<SiteResponse>('/sites', { code: 'BIZ-A', name: 'Synthetic Site A' });
    const other = await create<SiteResponse>('/sites', { code: 'BIZ-B', name: 'Synthetic Site B' });
    await create<AccountResponse>('/users', {
      username: 'business-manager',
      displayName: 'Synthetic Site Manager',
      temporaryPassword: 'InitialManager123!',
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
    });
    const manager = await login('business-manager', 'InitialManager123!');
    const reviewer = await create<AccountResponse>('/users', {
      username: 'business-safety',
      displayName: 'Synthetic Safety',
      temporaryPassword: 'InitialSafety123!',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }],
    });
    let safety = await login('business-safety', 'InitialSafety123!');
    await request('/auth/change-password', {
      method: 'POST',
      token: safety,
      expected: 204,
      body: { currentPassword: 'InitialSafety123!', newPassword: 'ChangedSafety123!' },
    });
    safety = await login('business-safety', 'ChangedSafety123!');
    // Separate account bootstrap from the business journey without weakening the fixed login throttle.
    await app!.close();
    app = undefined;
    if (!db.isInitialized) await db.initialize();
    base = await startApp();
    const contractor = await create<{ id: string }>(`/sites/${site.id}/contractors`, {
      code: 'SYNTHETIC-BIZ-CTR',
      name: 'Synthetic business Contractor',
    });
    const createProfile = async (target: SiteResponse, label: string) => {
      await create(`/contractors/${contractor.id}/participations`, {
        siteId: target.id,
        validFrom: '2020-01-01T00:00:00Z',
        validUntil: null,
      });
      const username = `business-rep-${label}`;
      await create(`/sites/${target.id}/contractors/${contractor.id}/representative-accounts`, {
        username,
        displayName: 'Synthetic business Representative',
        temporaryPassword: 'SyntheticRep123!',
      });
      const representative = await login(username, 'SyntheticRep123!');
      return create<WorkerResponse>(
        `/sites/${target.id}/workers`,
        {
          contractorId: contractor.id,
          externalId: `SYNTHETIC-${label}`,
          displayName: `Synthetic Worker ${label}`,
        },
        representative,
      );
    };
    const worker = await createProfile(site, 'A');
    const foreignWorker = await createProfile(other, 'B');
    const camera = await create<CameraResponse>(`/sites/${site.id}/cameras`, {
      code: 'BIZ-CAM',
      externalId: 'SYNTHETIC-CAM',
      name: 'Synthetic Camera',
    });
    const zone = await request<ZoneResponse>(`/sites/${site.id}/zones`, {
      method: 'POST',
      token: manager,
      expected: 201,
      body: {
        code: 'BIZ-ZONE',
        name: 'Synthetic Zone',
        type: 'RESTRICTED',
        restrictionPolicy: 'AUTHORIZATION_REQUIRED',
        requiredPpe: ['HARD_HAT'],
      },
    });
    const { region } = await create<RegionMutationResponse>(
      `/sites/${site.id}/cameras/${camera.id}/regions`,
      {
        zoneId: zone.id,
        expectedConfigurationVersion: 1,
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        },
      },
    );
    const eventId = randomUUID(),
      streamSessionId = randomUUID();
    const frameFile = join(evidenceRoot, `${streamSessionId}_1_${eventId}.jpg`);
    await writeFile(frameFile, syntheticJpeg);
    const event = {
      eventId,
      schemaVersion: '1.0.0',
      cameraExternalId: camera.externalId,
      streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 64, height: 64 },
      observations: [
        ...[7, 8].map((trackId, i) => ({
          type: 'PERSON',
          trackId,
          confidence: 0.95,
          boundingBox: {
            x1: i ? 0.55 : 0.05,
            y1: 0.1,
            x2: i ? 0.95 : 0.45,
            y2: 0.9,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        })),
        {
          type: 'PPE',
          trackId: 7,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId: region.id,
          geometryVersion: region.version,
          confidence: 0.9,
        },
        {
          type: 'ZONE_ENTRY',
          trackId: 7,
          regionId: region.id,
          geometryVersion: region.version,
          confidence: 0.9,
        },
      ],
      evidence: [{ kind: 'FRAME', uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg` }],
    };
    await request('/integrations/ai/events', {
      method: 'POST',
      body: event,
      token: admin,
      expected: 401,
    });
    const ingest = (body: unknown) =>
      request<IngestionResult>('/integrations/ai/events', {
        method: 'POST',
        body,
        token: serviceToken,
        expected: 202,
      });
    const ingested = await ingest(event);
    assert.equal(ingested.status, 'PROCESSED');
    assert.equal(ingested.alertIds.length, 2);
    const replay = await ingest(event);
    assert.equal(replay.status, 'DUPLICATE_ACCEPTED');
    assert.deepEqual(replay.alertIds, []);
    const events = db.getRepository(AiObservationEventEntity);
    const decisions = db.getRepository(ZoneEntryDecisionEntity);
    const original = await events.findOneByOrFail({ eventId });
    const zoneDecisions = await decisions.findBy({ eventId });
    assert.equal(original.payloadHash, computeCanonicalPayloadHash(event));
    assert.deepEqual(original.rawPayload, event);
    assert.equal(zoneDecisions[0]!.status, 'UNAVAILABLE');
    assert.equal(zoneDecisions[0]!.workerId, null);
    const alerts = await request<Page<SafetyAlertResponse>>(`/sites/${site.id}/safety-alerts`, {
      token: safety,
    });
    const alert = alerts.items.find((a) => a.alertType === 'PPE_VIOLATION');
    assert.ok(alert);
    const alertPath = `/sites/${site.id}/safety-alerts/${alert.id}`;
    const subjectPath = `${alertPath}/detections/${eventId}/identity-subjects`;
    const evidencePath = `${alertPath}/detections/${eventId}/evidence/0`;
    async function readEvidence() {
      const response = await fetch(`${base}${evidencePath}`, {
        headers: { Authorization: `Bearer ${safety}` },
        signal: AbortSignal.timeout(8_000),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-type')!, /image\/jpeg/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), syntheticJpeg);
    }
    await readEvidence();
    await request(subjectPath, { token: admin, expected: 403 });
    await request(evidencePath, { expected: 401 });
    await request(evidencePath.replace(site.id, other.id), { token: safety, expected: 403 });
    await request(evidencePath.replace(site.id, other.id), { token: admin, expected: 404 });
    const context = () =>
      request<ObservationIdentityContextResponse>(subjectPath, { token: safety });
    const initial = await context();
    assert.equal(initial.subjects.length, 2);
    const workers = await request<Page<ObservationIdentityWorkerResponse>>(
      `${subjectPath}/workers?limit=10`,
      { token: safety },
    );
    assert.equal(workers.total, 1);
    assert.equal(workers.items[0]!.id, worker.id);
    const command: ObservationIdentityDecisionCommand = {
      commandId: randomUUID(),
      expectedRevision: 0,
      expectedEventHash: original.payloadHash,
      action: 'RESOLVE',
      reason: 'Synthetic exact observation review.',
      workerId: worker.id,
      evidenceIndex: 0,
      expectedEvidenceSha256: createHash('sha256').update(syntheticJpeg).digest('hex'),
    };
    const decide = (body: unknown, expected = 201) =>
      request<ObservationIdentityMutationResponse>(`${subjectPath}/0/decisions`, {
        method: 'POST',
        body,
        token: safety,
        expected,
      });
    await decide({ ...command, workerId: foreignWorker.id }, 404);
    await decide({ ...command, expectedEvidenceSha256: '0'.repeat(64) }, 409);
    const resolved = await decide(command);
    assert.equal(resolved.recordedDecision.actorUserId, reviewer.id);
    assert.equal(resolved.recordedDecision.workerId, worker.id);
    assert.equal(resolved.recordedDecision.scope, 'EXACT_OBSERVATION');
    assert.equal(resolved.recordedDecision.verificationMethod, 'MANUAL');
    assert.equal(resolved.recordedDecision.evidenceSha256, command.expectedEvidenceSha256);
    assert.equal(resolved.latestRevision, 1);
    const after = await context();
    assert.equal(after.subjects[0]!.latestManualDecision!.workerId, worker.id);
    assert.equal(after.subjects[1]!.latestManualDecision, null);
    assert.equal(after.subjects[1]!.revision, 0);
    assert.deepEqual(
      after.subjects[0]!.originalZoneDecisions,
      initial.subjects[0]!.originalZoneDecisions,
    );
    assert.equal((await decide(command)).replayed, true);
    await decide({ ...command, commandId: randomUUID() }, 409);
    const reviewed = await request<SafetyAlertReviewMutationResponse>(`${alertPath}/reviews`, {
      method: 'POST',
      token: safety,
      expected: 201,
      body: {
        commandId: randomUUID(),
        expectedRevision: alert.revision,
        targetStatus: 'NEEDS_MORE_EVIDENCE',
        reason: 'Synthetic evidence reviewed.',
      },
    });
    assert.equal(reviewed.alert.revision, alert.revision + 1);
    await rename(frameFile, `${frameFile}.held`);
    await request(evidencePath, { token: safety, expected: 404 });
    assert.equal((await decide(command)).replayed, true);
    const cleared = await decide({
      commandId: randomUUID(),
      expectedRevision: 1,
      expectedEventHash: original.payloadHash,
      action: 'CLEAR',
      reason: 'Synthetic review cleared after expiry.',
    });
    assert.equal(cleared.latestRevision, 2);
    await rename(`${frameFile}.held`, frameFile);
    const nextEvent = {
      ...event,
      eventId: randomUUID(),
      capturedAt: new Date(Date.parse(event.capturedAt) + 2_000).toISOString(),
      evidence: [],
    };
    const next = await ingest(nextEvent);
    const nextContext = await request<ObservationIdentityContextResponse>(
      `/sites/${site.id}/safety-alerts/${next.alertIds[0]!}/detections/${nextEvent.eventId}/identity-subjects`,
      { token: safety },
    );
    for (const subject of nextContext.subjects) {
      assert.equal(subject.latestManualDecision, null);
      assert.equal(subject.revision, 0);
    }
    const historyPath = `${subjectPath}/0/decisions`;
    const history = await request<Page<ObservationIdentityDecisionResponse>>(historyPath, {
      token: safety,
    });
    assert.equal(history.total, 2);
    await app!.close();
    app = undefined;
    if (!db.isInitialized) await db.initialize();
    base = await startApp();
    assert.deepEqual(await request(historyPath, { token: safety }), history);
    const persisted = await context();
    assert.equal(persisted.subjects[0]!.revision, 2);
    assert.equal(persisted.subjects[0]!.latestManualDecision!.action, 'CLEAR');
    assert.equal(persisted.subjects[1]!.latestManualDecision, null);
    await readEvidence();
    const finalEvent = await events.findOneByOrFail({ eventId });
    assert.equal(finalEvent.payloadHash, original.payloadHash);
    assert.deepEqual(finalEvent.rawPayload, original.rawPayload);
    assert.deepEqual(await decisions.findBy({ eventId }), zoneDecisions);
  },
);
