import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { createLoggerParams } from '../src/observability/logger.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { createTestConfig } from './support/config.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { ObservationIdentityDecisionEntity } from '../src/database/entities/observation-identity-decision.entity.js';
import { ObservationIdentityResolutionEntity } from '../src/database/entities/observation-identity-resolution.entity.js';
import { ObservationIdentityResolutionService } from '../src/modules/safety/identity/observation-identity-resolution.service.js';
import type { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';

function fixture() {
  const siteId = randomUUID(),
    alertId = randomUUID(),
    eventId = randomUUID(),
    actorId = randomUUID();
  const cameraId = randomUUID(),
    sessionId = randomUUID(),
    workerId = randomUUID();
  const raw = {
    eventId,
    schemaVersion: '1.0.0',
    cameraExternalId: `CAM-${cameraId}`,
    streamSessionId: sessionId,
    capturedAt: '2026-10-01T00:00:00Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/1/${eventId}.jpg` }],
  };
  const hash = computeCanonicalPayloadHash(raw);
  const event = {
    eventId,
    payloadHash: hash,
    cameraExternalId: raw.cameraExternalId,
    streamSessionId: sessionId,
    resolvedCameraId: cameraId,
    capturedAt: new Date(raw.capturedAt),
    rawPayload: raw,
  };
  let head: Record<string, unknown> | null = null;
  const decisions: Record<string, unknown>[] = [];
  const manager = {
    queryRunner: { isTransactionActive: true },
    query: async () => [{ conflicting: false }],
    getRepository: (entity: unknown) => {
      if (entity === SafetyAlertEntity) return { findOneBy: async () => ({ id: alertId, siteId }) };
      if (entity === AlertDetectionMappingEntity)
        return { findOneBy: async () => ({ alertId, eventId }) };
      if (entity === AiObservationEventEntity) return { findOneBy: async () => event };
      if (entity === ObservationIdentityResolutionEntity)
        return {
          findOneBy: async () => head,
          create: (value: Record<string, unknown>) => value,
          save: async (value: Record<string, unknown>) => {
            head = value;
            return value;
          },
        };
      if (entity === ObservationIdentityDecisionEntity)
        return {
          findOneBy: async ({ id }: { id: string }) => decisions.find((d) => d.id === id) ?? null,
          create: (value: Record<string, unknown>) => value,
          save: async (value: Record<string, unknown>) => {
            value.recordedAt = new Date();
            decisions.push(value);
            return value;
          },
        };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const db = {
    manager,
    transaction: async (operation: (m: EntityManager) => unknown) => operation(manager),
  } as DataSource;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let reads = 0;
  const evidence = {
    readFrameForIdentityReview: async () => {
      reads++;
      entered();
      await gate;
      return { sha256: 'b'.repeat(64) };
    },
  } as unknown as SafetyAlertEvidenceService;
  const service = new ObservationIdentityResolutionService(db, evidence, {
    findForReview: async () => ({
      id: workerId,
      siteId,
      externalId: 'synthetic',
      isActive: true,
      displayName: 'Synthetic',
    }),
    listForReview: async () => ({ items: [], total: 0 }),
  });
  const input = {
    commandId: randomUUID(),
    expectedRevision: 0,
    expectedEventHash: hash,
    action: 'RESOLVE',
    reason: 'Synthetic exact subject review.',
    workerId,
    evidenceIndex: 0,
    expectedEvidenceSha256: 'b'.repeat(64),
  };
  const decide = (authorize: (m: EntityManager, actor: string, site: string) => Promise<void>) =>
    service.decide(siteId, alertId, eventId, 0, actorId, input, authorize);
  return {
    decide,
    service,
    input,
    alertId,
    eventId,
    reached,
    release,
    decisions,
    manager,
    actorId,
    siteId,
    get reads() {
      return reads;
    },
  };
}

test('identity mutation refuses revocation during evidence I/O before any decision write', async () => {
  const f = fixture();
  let allowed = true;
  const pending = f.decide(async (manager, actor, site) => {
    assert.equal(manager, f.manager);
    assert.equal(actor, f.actorId);
    assert.equal(site, f.siteId);
    if (!allowed) throw new UnauthorizedException();
  });
  await f.reached;
  allowed = false;
  f.release();
  await assert.rejects(pending, UnauthorizedException);
  assert.equal(f.decisions.length, 0);
});

for (const change of ['logout', 'deactivated', 'role-moved', 'none'] as const)
  test(`actual identity HTTP mutation during held evidence: ${change}`, async (t) => {
    const f = fixture();
    let access: typeof change | 'none' = 'none';
    let transactionChecks = 0;
    const config = createTestConfig({ HTTP_RATE_LIMIT_LIMIT: '1000', LOG_FORMAT: 'json' });
    const db = {
      isInitialized: true,
      query: async () => [{ ok: 1 }],
      destroy: async () => undefined,
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(db)
      .overrideProvider(DataSource)
      .useValue(db)
      .overrideProvider(ObservationIdentityResolutionService)
      .useValue(f.service)
      .overrideProvider(AuthService)
      .useValue({
        authenticate: async (_token: string, manager?: EntityManager) => {
          if (manager) {
            assert.equal(manager, f.manager);
            transactionChecks++;
          }
          if (access === 'logout' || access === 'deactivated') throw new UnauthorizedException();
          return {
            user: {
              id: f.actorId,
              username: 'synthetic',
              displayName: 'Synthetic',
              isActive: true,
              mustChangePassword: false,
              roleAssignments: [
                {
                  role: UserRole.SAFETY_OFFICER,
                  siteId: access === 'role-moved' ? randomUUID() : f.siteId,
                },
              ],
            },
            sessionId: randomUUID(),
            clientType: 'WEB',
          };
        },
      })
      .compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    t.after(() => app.close());
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const request = fetch(
      `${await app.getUrl()}/api/v1/sites/${f.siteId}/safety-alerts/${f.alertId}/detections/${f.eventId}/identity-subjects/0/decisions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${'a'.repeat(16)}.${'b'.repeat(16)}.${'c'.repeat(16)}`,
        },
        body: JSON.stringify(f.input),
        signal: AbortSignal.timeout(5000),
      },
    );
    await f.reached;
    access = change;
    f.release();
    const response = await request;
    assert.equal(response.status, change === 'none' ? 201 : change === 'role-moved' ? 403 : 401);
    assert.equal(f.decisions.length, change === 'none' ? 1 : 0);
    assert.equal(transactionChecks, 2);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal('recordedDecision' in body, change === 'none');
  });

test('identity mutation rejects already revoked authority before evidence I/O', async () => {
  const f = fixture();
  f.release();
  await assert.rejects(
    f.decide(async () => {
      throw new UnauthorizedException();
    }),
    UnauthorizedException,
  );
  assert.equal(f.reads, 0);
  assert.equal(f.decisions.length, 0);
});

test('authorized mutation and idempotent replay each require transactional authority', async () => {
  const f = fixture();
  f.release();
  let claims = 0;
  const authorize = async () => {
    claims++;
  };
  await f.decide(authorize);
  assert.equal(f.decisions.length, 1);
  assert.equal(claims, 2);
  await assert.rejects(
    f.decide(async () => {
      throw new UnauthorizedException();
    }),
    UnauthorizedException,
  );
  assert.equal(f.decisions.length, 1);
  await f.decide(authorize);
  assert.equal(f.decisions.length, 1);
  assert.equal(claims, 3);
  assert.equal(f.reads, 1);
});
