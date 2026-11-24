import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash, type WorkerEventDeliveryContext } from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { CameraConfigurationBundleEntity } from '../src/database/entities/camera-configuration-bundle.entity.js';
import { CameraViewRevisionEntity } from '../src/database/entities/camera-configuration-reference.entity.js';
import {
  CameraConfigurationApplicationReceiptEntity,
  CameraWorkerGenerationEntity,
} from '../src/database/entities/camera-worker-generation.entity.js';
import { CameraStatus } from '../src/database/entities/enums.js';
import { CameraEventAdmissionService } from '../src/modules/cameras/camera-event-admission.service.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const GEN_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ROUTE_EPOCH = '66666666-6666-4666-8666-666666666666';
const ORIGINAL_RECEIPT_ID = '77777777-7777-4777-8777-777777777777';
const NEWER_RECEIPT_ID = '88888888-8888-4888-8888-888888888888';
const SECRET = 'A'.repeat(43);
const CREDENTIAL_SHA256 = createHash('sha256').update(SECRET).digest('hex');
const CAMERA_EXTERNAL_ID = 'cam-demo-01';
const BASE_TIME = Date.parse('2026-11-23T05:02:00.000Z');
const ISSUED_AT = new Date(BASE_TIME - 5_000);

const BUNDLE_SHA256 = computeCanonicalPayloadHash({
  schemaVersion: '1.0.0',
  cameraId: CAMERA_ID,
  cameraExternalId: CAMERA_EXTERNAL_ID,
  configurationVersion: 3,
  viewRevision: 1,
  issuedAt: ISSUED_AT.toISOString(),
  regions: [],
});

interface FixtureState {
  now: Date;
  storedRowFound: boolean;
  storedClassification: 'LIVE' | 'REVIEW_ONLY' | null;
  camera: Partial<CameraEntity>;
  generation: Partial<CameraWorkerGenerationEntity>;
  view: Partial<CameraViewRevisionEntity>;
  originalReceipt: Partial<CameraConfigurationApplicationReceiptEntity> | null;
  latestReceipt: Partial<CameraConfigurationApplicationReceiptEntity> | null;
}

function createFixture(overrides?: Partial<FixtureState>) {
  const state: FixtureState = {
    now: new Date(BASE_TIME + 65_000), // 65s after original receipt (original aged > 60s)
    storedRowFound: true,
    storedClassification: 'LIVE',
    camera: {
      id: CAMERA_ID,
      siteId: SITE_ID,
      externalId: CAMERA_EXTERNAL_ID,
      type: 'ZONE',
      status: CameraStatus.ACTIVE,
      configurationVersion: 3,
    },
    generation: {
      id: GEN_ID,
      cameraId: CAMERA_ID,
      siteId: SITE_ID,
      streamSessionId: SESSION_ID,
      credentialSha256: CREDENTIAL_SHA256,
      isCurrent: true,
      issuedAt: ISSUED_AT,
      expiresAt: new Date(BASE_TIME + 3_600_000),
      supersededAt: null,
      revokedAt: null,
    },
    view: {
      cameraId: CAMERA_ID,
      siteId: SITE_ID,
      revision: '1',
      sourceKind: 'LIVE',
      isCurrent: true,
    },
    originalReceipt: {
      commandId: ORIGINAL_RECEIPT_ID,
      cameraId: CAMERA_ID,
      siteId: SITE_ID,
      workerGenerationId: GEN_ID,
      streamSessionId: SESSION_ID,
      configurationVersion: '3',
      viewRevision: '1',
      bundleSha256: BUNDLE_SHA256,
      outcome: 'LOADED',
      receivedAt: new Date(BASE_TIME),
      receiptOrder: '10',
    },
    latestReceipt: {
      commandId: NEWER_RECEIPT_ID,
      cameraId: CAMERA_ID,
      siteId: SITE_ID,
      workerGenerationId: GEN_ID,
      streamSessionId: SESSION_ID,
      configurationVersion: '3',
      viewRevision: '1',
      bundleSha256: BUNDLE_SHA256,
      outcome: 'LOADED',
      receivedAt: new Date(BASE_TIME + 35_000), // 30s old at now (<= 60s)
      receiptOrder: '11',
    },
    ...overrides,
  };

  const context: WorkerEventDeliveryContext = {
    schemaVersion: '1.0.0',
    cameraId: CAMERA_ID,
    workerGenerationId: GEN_ID,
    streamSessionId: SESSION_ID,
    configurationVersion: 3,
    bundleSha256: BUNDLE_SHA256,
    viewRevision: 1,
    receiptCommandId: ORIGINAL_RECEIPT_ID,
    sourceKind: 'LIVE',
  };

  const witness = {
    eventId: EVENT_ID,
    payloadHash: 'b'.repeat(64),
    bindingHash: 'c'.repeat(64),
    routeEpoch: ROUTE_EPOCH,
  };

  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository(entity: unknown) {
      if (entity === CameraEntity) {
        return {
          async findOne() {
            return state.camera;
          },
        };
      }
      if (entity === CameraWorkerGenerationEntity) {
        return {
          createQueryBuilder() {
            return {
              addSelect() {
                return this;
              },
              where() {
                return this;
              },
              async getOne() {
                return state.generation;
              },
            };
          },
        };
      }
      if (entity === CameraConfigurationApplicationReceiptEntity) {
        return {
          async findOneBy() {
            return state.originalReceipt;
          },
          async findOne() {
            return state.latestReceipt;
          },
        };
      }
      if (entity === CameraConfigurationBundleEntity) {
        return {
          async findOneBy() {
            return {
              cameraId: CAMERA_ID,
              siteId: SITE_ID,
              cameraExternalId: CAMERA_EXTERNAL_ID,
              configurationVersion: '3',
              viewRevision: '1',
              bundleSha256: BUNDLE_SHA256,
              issuedAt: ISSUED_AT,
            };
          },
        };
      }
      if (entity === CameraViewRevisionEntity) {
        return {
          async findOneBy() {
            return state.view;
          },
        };
      }
      throw new Error(`Unexpected repository lookup: ${String(entity)}`);
    },
    async query(sql: string) {
      if (sql.includes('SELECT clock_timestamp() AS now')) {
        return [{ now: state.now }];
      }
      if (sql.includes('FROM ai_observation_event')) {
        return state.storedRowFound ? [{ classification: state.storedClassification }] : [];
      }
      if (sql.includes('FROM camera_configuration_bundle h')) {
        return [{ version: '1.0.0' }];
      }
      if (sql.includes('FROM camera_configuration_bundle_region')) {
        return [];
      }
      throw new Error(`Unexpected SQL query: ${sql}`);
    },
  } as unknown as EntityManager;

  return {
    state,
    context,
    witness,
    manager,
    capturedAt: new Date(BASE_TIME + 15_000),
    service: new CameraEventAdmissionService(),
  };
}

test('recheckStoredTracked preserves LIVE when original receipt aged past 60s but newer same-binding LOADED ACK is fresh, while ordinary ingress remains unchanged', async () => {
  const f = createFixture();
  const rechecked = await f.service.recheckStoredTracked(
    f.manager,
    f.context,
    f.witness,
    CAMERA_EXTERNAL_ID,
    [CAMERA_ID],
    f.capturedAt,
    1000,
  );
  assert.equal(rechecked.classification, 'LIVE');

  // Ordinary ingress with the aged receiptCommandId must remain REVIEW_ONLY even when a newer ACK exists.
  const ingress = await f.service.admit(
    f.manager,
    f.context,
    SECRET,
    CAMERA_EXTERNAL_ID,
    [CAMERA_ID],
    f.capturedAt,
    1000,
  );
  assert.equal(ingress.classification, 'REVIEW_ONLY');
});

test('recheckStoredTracked refuses promotion of originally REVIEW_ONLY stored rows and enforces 60s freshness without TTL expansion', async () => {
  const originallyReview = createFixture({ storedClassification: 'REVIEW_ONLY' });
  const r1 = await originallyReview.service.recheckStoredTracked(
    originallyReview.manager,
    originallyReview.context,
    originallyReview.witness,
    CAMERA_EXTERNAL_ID,
    [CAMERA_ID],
    originallyReview.capturedAt,
    1000,
  );
  assert.equal(r1.classification, 'REVIEW_ONLY');

  // Stale latest receipt (60,001ms old): must stay REVIEW_ONLY (no TTL expansion).
  const staleLatest = createFixture({
    now: new Date(BASE_TIME + 95_001),
  });
  const r2 = await staleLatest.service.recheckStoredTracked(
    staleLatest.manager,
    staleLatest.context,
    staleLatest.witness,
    CAMERA_EXTERNAL_ID,
    [CAMERA_ID],
    staleLatest.capturedAt,
    1000,
  );
  assert.equal(r2.classification, 'REVIEW_ONLY');

  // Future latest receipt (receivedAt > now): must not satisfy freshness.
  const futureLatest = createFixture();
  futureLatest.state.latestReceipt!.receivedAt = new Date(BASE_TIME + 66_000);
  const r3 = await futureLatest.service.recheckStoredTracked(
    futureLatest.manager,
    futureLatest.context,
    futureLatest.witness,
    CAMERA_EXTERNAL_ID,
    [CAMERA_ID],
    futureLatest.capturedAt,
    1000,
  );
  assert.equal(r3.classification, 'REVIEW_ONLY');

  // Missing stored tracked receipt row: must fail closed with 401.
  const missingStored = createFixture({ storedRowFound: false });
  await assert.rejects(
    missingStored.service.recheckStoredTracked(
      missingStored.manager,
      missingStored.context,
      missingStored.witness,
      CAMERA_EXTERNAL_ID,
      [CAMERA_ID],
      missingStored.capturedAt,
      1000,
    ),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 401,
  );
});

test('recheckStoredTracked denies revoked generation and classifies mismatched config/hash/view/session/outcome or inactive scope as REVIEW_ONLY', async () => {
  const revoked = createFixture();
  revoked.state.generation.revokedAt = new Date(BASE_TIME + 40_000);
  revoked.state.generation.isCurrent = false;
  await assert.rejects(
    revoked.service.recheckStoredTracked(
      revoked.manager,
      revoked.context,
      revoked.witness,
      CAMERA_EXTERNAL_ID,
      [CAMERA_ID],
      revoked.capturedAt,
      1000,
    ),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 401,
  );

  const reviewCases: Array<[string, (s: FixtureState) => void]> = [
    [
      'superseded generation',
      (s) => (
        (s.generation.isCurrent = false),
        (s.generation.supersededAt = new Date(BASE_TIME + 40_000))
      ),
    ],
    ['expired generation', (s) => (s.generation.expiresAt = new Date(BASE_TIME + 65_000))],
    ['inactive camera', (s) => (s.camera.status = CameraStatus.INACTIVE)],
    ['camera configuration advanced', (s) => (s.camera.configurationVersion = 4)],
    ['retired view', (s) => (s.view.isCurrent = false)],
    ['latest receipt REJECTED', (s) => (s.latestReceipt!.outcome = 'REJECTED')],
    [
      'latest receipt different configVersion',
      (s) => (s.latestReceipt!.configurationVersion = '4'),
    ],
    [
      'latest receipt different bundleSha256',
      (s) => (s.latestReceipt!.bundleSha256 = 'f'.repeat(64)),
    ],
    ['latest receipt different viewRevision', (s) => (s.latestReceipt!.viewRevision = '2')],
    ['latest receipt different siteId', (s) => (s.latestReceipt!.siteId = randomUUID())],
    [
      'latest receipt different streamSessionId',
      (s) => (s.latestReceipt!.streamSessionId = randomUUID()),
    ],
  ];

  for (const [label, mutate] of reviewCases) {
    const f = createFixture();
    mutate(f.state);
    const result = await f.service.recheckStoredTracked(
      f.manager,
      f.context,
      f.witness,
      CAMERA_EXTERNAL_ID,
      [CAMERA_ID],
      f.capturedAt,
      1000,
    );
    assert.equal(result.classification, 'REVIEW_ONLY', `expected REVIEW_ONLY for ${label}`);
  }
});
