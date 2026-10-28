import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';

const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const jpegSha256 = createHash('sha256').update(jpeg).digest('hex');

function config(root?: string) {
  return new ConfigService<BackendEnvironment, true>(
    validateEnvironment({ NODE_ENV: 'test', ...(root ? { EVIDENCE_LOCAL_ROOT: root } : {}) }),
  );
}

function dataSourceFor(input: {
  siteId: string;
  alertId: string;
  eventId: string;
  rawPayload: unknown;
  includeAlert?: boolean;
  includeMapping?: boolean;
  camera?: { id: string; siteId: string; externalId: string };
  eventMetadata?: Record<string, unknown>;
  conflictingSiteMapping?: boolean;
}) {
  return {
    getRepository(entity: unknown) {
      if (entity === SafetyAlertEntity) {
        return {
          findOneBy: async (where: { id: string; siteId: string }) =>
            input.includeAlert !== false &&
            where.id === input.alertId &&
            where.siteId === input.siteId
              ? { id: input.alertId, siteId: input.siteId }
              : null,
        };
      }
      if (entity === AlertDetectionMappingEntity) {
        const query = {
          innerJoin(joined: unknown, alias: string, condition: string) {
            assert.equal(joined, SafetyAlertEntity);
            assert.equal(alias, 'mappedAlert');
            assert.equal(condition, 'mappedAlert.id = mapping.alertId');
            return query;
          },
          where(condition: string, params: unknown) {
            assert.equal(condition, 'mapping.eventId = :eventId');
            assert.deepEqual(params, { eventId: input.eventId });
            return query;
          },
          andWhere(condition: string, params: unknown) {
            assert.equal(condition, 'mappedAlert.siteId <> :siteId');
            assert.deepEqual(params, { siteId: input.siteId });
            return query;
          },
          getExists: async () => input.conflictingSiteMapping === true,
        };
        return {
          createQueryBuilder: (alias: string) => {
            assert.equal(alias, 'mapping');
            return query;
          },
          findOneBy: async (where: { alertId: string; eventId: string }) =>
            input.includeMapping !== false &&
            where.alertId === input.alertId &&
            where.eventId === input.eventId
              ? where
              : null,
        };
      }
      if (entity === AiObservationEventEntity) {
        return {
          findOneBy: async (where: { eventId: string }) =>
            where.eventId === input.eventId
              ? { eventId: input.eventId, rawPayload: input.rawPayload, ...input.eventMetadata }
              : null,
        };
      }
      if (entity === CameraEntity) {
        return {
          findOneBy: async (where: { id: string; siteId: string }) =>
            input.camera?.id === where.id && input.camera.siteId === where.siteId
              ? input.camera
              : null,
        };
      }
      throw new Error(`unexpected repository ${String(entity)}`);
    },
  } as unknown as DataSource;
}

function isPublicError(code: string) {
  return (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === code;
}

function identityFrameFixture(
  root: string,
  overrides?: {
    kind?: string;
    uriSessionId?: string;
    storedSessionId?: string;
    storedHash?: string;
    cameraSiteId?: string;
    storedCameraExternalId?: string;
    conflictingSiteMapping?: boolean;
    schemaVersion?: '1.0.0' | '1.3.0';
    declaredSha?: string;
  },
) {
  const siteId = randomUUID();
  const alertId = randomUUID();
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const cameraId = randomUUID();
  const uriSessionId = overrides?.uriSessionId ?? sessionId;
  const schemaVersion = overrides?.schemaVersion ?? '1.0.0';
  const declaredSha =
    overrides?.declaredSha ?? (schemaVersion === '1.3.0' ? jpegSha256 : undefined);
  const rawPayload = {
    eventId,
    schemaVersion,
    cameraExternalId: 'CAM-01',
    streamSessionId: sessionId,
    capturedAt: '2026-10-01T00:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: {
          x1: 0.1,
          y1: 0.2,
          x2: 0.4,
          y2: 0.9,
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
    ],
    evidence: [
      {
        kind: overrides?.kind ?? 'FRAME',
        uri: `local://evidence/${uriSessionId}/9/${eventId}.jpg`,
        ...(declaredSha === undefined ? {} : { sha256: declaredSha }),
      },
    ],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const service = new SafetyAlertEvidenceService(
    dataSourceFor({
      siteId,
      alertId,
      eventId,
      rawPayload,
      camera: { id: cameraId, siteId: overrides?.cameraSiteId ?? siteId, externalId: 'CAM-01' },
      conflictingSiteMapping: overrides?.conflictingSiteMapping,
      eventMetadata: {
        payloadHash: overrides?.storedHash ?? payloadHash,
        capturedAt: new Date(rawPayload.capturedAt),
        streamSessionId: overrides?.storedSessionId ?? sessionId,
        cameraExternalId: overrides?.storedCameraExternalId ?? 'CAM-01',
        resolvedCameraId: cameraId,
      },
    }),
    config(root),
  );
  return {
    service,
    siteId,
    alertId,
    eventId,
    payloadHash,
    fileName: `${uriSessionId}_9_${eventId}.jpg`,
  };
}

test('identity review FRAME digest describes exactly the protected bytes served', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root);
  await writeFile(join(root, value.fileName), jpeg);
  const content = await value.service.readFrameForIdentityReview(
    value.siteId,
    value.alertId,
    value.eventId,
    '0',
    value.payloadHash,
  );
  assert.deepEqual(content.bytes, jpeg);
  assert.equal(content.sha256, createHash('sha256').update(jpeg).digest('hex'));
  const changed = Buffer.from([0xff, 0xd8, 0x03, 0x04, 0xff, 0xd9]);
  await writeFile(join(root, value.fileName), changed);
  const reread = await value.service.readFrameForIdentityReview(
    value.siteId,
    value.alertId,
    value.eventId,
    '0',
    value.payloadHash,
  );
  assert.notEqual(reread.sha256, content.sha256);
});

test('ordinary evidence download refuses an event mapped to conflicting historical Sites', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-conflicting-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root, { conflictingSiteMapping: true });
  await writeFile(join(root, value.fileName), jpeg);
  await assert.rejects(
    value.service.read(value.siteId, value.alertId, value.eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});

test('identity review refuses crops, snapshots and FRAME from a different session', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const overrides of [
    { kind: 'CROP' },
    { kind: 'SNAPSHOT' },
    { uriSessionId: randomUUID() },
  ]) {
    const value = identityFrameFixture(root, overrides);
    await writeFile(join(root, value.fileName), jpeg);
    await assert.rejects(
      value.service.readFrameForIdentityReview(
        value.siteId,
        value.alertId,
        value.eventId,
        '0',
        value.payloadHash,
      ),
      isPublicError('NOT_FOUND'),
    );
  }
});

test('identity review refuses raw hash and stored camera/session contradictions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const overrides of [
    { storedHash: 'a'.repeat(64) },
    { storedSessionId: randomUUID() },
    { conflictingSiteMapping: true },
    { storedCameraExternalId: 'OTHER-CAMERA' },
  ]) {
    const value = identityFrameFixture(root, overrides);
    await writeFile(join(root, value.fileName), jpeg);
    await assert.rejects(
      value.service.readFrameForIdentityReview(
        value.siteId,
        value.alertId,
        value.eventId,
        '0',
        value.payloadHash,
      ),
      isPublicError('CONFLICT'),
    );
  }
  const value = identityFrameFixture(root);
  await assert.rejects(
    value.service.readFrameForIdentityReview(
      value.siteId,
      value.alertId,
      value.eventId,
      '0',
      'b'.repeat(64),
    ),
    isPublicError('CONFLICT'),
  );
});

test('camera reassignment cannot replace historical alert/event Site ownership', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root, { cameraSiteId: randomUUID() });
  await writeFile(join(root, value.fileName), jpeg);
  const result = await value.service.readFrameForIdentityReview(
    value.siteId,
    value.alertId,
    value.eventId,
    '0',
    value.payloadHash,
  );
  assert.deepEqual(result.bytes, jpeg);
  await assert.rejects(
    value.service.readFrameForIdentityReview(
      randomUUID(),
      value.alertId,
      value.eventId,
      '0',
      value.payloadHash,
    ),
    isPublicError('NOT_FOUND'),
  );
});

test('identity review missing, oversized or invalid local media remains unavailable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root);
  for (const bytes of [undefined, Buffer.alloc(1_048_577), Buffer.from('not jpeg')]) {
    if (bytes) await writeFile(join(root, value.fileName), bytes);
    await assert.rejects(
      value.service.readFrameForIdentityReview(
        value.siteId,
        value.alertId,
        value.eventId,
        '0',
        value.payloadHash,
      ),
      isPublicError('NOT_FOUND'),
    );
  }
  await assert.rejects(
    value.service.readFrameForIdentityReview(
      randomUUID(),
      value.alertId,
      value.eventId,
      '0',
      value.payloadHash,
    ),
    isPublicError('NOT_FOUND'),
  );
  await assert.rejects(
    value.service.readFrameForIdentityReview(
      value.siteId,
      value.alertId,
      randomUUID(),
      '0',
      value.payloadHash,
    ),
    isPublicError('NOT_FOUND'),
  );
});

test('evidence summaries expose curated metadata and never expose storage URIs', () => {
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const service = new SafetyAlertEvidenceService(
    undefined as unknown as DataSource,
    config(join(tmpdir(), 'smartsite-evidence-configured')),
  );
  const rawPayload = {
    evidence: [
      {
        kind: 'FRAME',
        uri: `local://evidence/${sessionId}/7/${eventId}.jpg`,
        trackId: 12,
      },
      { kind: 'CROP', uri: 's3://private-bucket/not-yet-supported.jpg' },
      { kind: 'FRAME', uri: `local://evidence/${sessionId}/7/${randomUUID()}.jpg` },
      { kind: 'EXECUTABLE', uri: 'file:///malicious' },
    ],
  };

  const result = service.summarize(rawPayload, eventId);

  assert.deepEqual(result, [
    { index: 0, kind: 'FRAME', trackId: 12, available: true },
    { index: 1, kind: 'CROP', available: false },
    { index: 2, kind: 'FRAME', available: false },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /local:|s3:|private-bucket/);
});

test('evidence content is returned only through the matching Site, alert and event mapping', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteId = randomUUID();
  const alertId = randomUUID();
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const sequence = 9;
  const rawPayload = {
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/${sequence}/${eventId}.jpg` }],
  };
  const fileName = `${sessionId}_${sequence}_${eventId}.jpg`;
  await writeFile(join(root, fileName), jpeg);
  const service = new SafetyAlertEvidenceService(
    dataSourceFor({ siteId, alertId, eventId, rawPayload }),
    config(root),
  );

  const result = await service.read(siteId, alertId, eventId, '0');

  assert.equal(result.fileName, fileName);
  assert.deepEqual(result.bytes, jpeg);
  await assert.rejects(
    service.read(randomUUID(), alertId, eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});

test('evidence content fails closed for missing mappings and malformed references', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteId = randomUUID();
  const alertId = randomUUID();
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const validPayload = {
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/1/${eventId}.jpg` }],
  };
  const withoutMapping = new SafetyAlertEvidenceService(
    dataSourceFor({ siteId, alertId, eventId, rawPayload: validPayload, includeMapping: false }),
    config(root),
  );
  await assert.rejects(
    withoutMapping.read(siteId, alertId, eventId, '0'),
    isPublicError('NOT_FOUND'),
  );

  const malformed = new SafetyAlertEvidenceService(
    dataSourceFor({
      siteId,
      alertId,
      eventId,
      rawPayload: { evidence: [{ kind: 'FRAME', uri: 'local://evidence/../../secret.jpg' }] },
    }),
    config(root),
  );
  await assert.rejects(malformed.read(siteId, alertId, eventId, '0'), isPublicError('NOT_FOUND'));
  await assert.rejects(
    malformed.read(siteId, alertId, eventId, '../0'),
    isPublicError('VALIDATION_FAILED'),
  );
});

test('evidence content rejects non-JPEG bytes and disabled local storage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const siteId = randomUUID();
  const alertId = randomUUID();
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const rawPayload = {
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/2/${eventId}.jpg` }],
  };
  await writeFile(
    join(root, `${sessionId}_2_${eventId}.jpg`),
    Buffer.from('<script>alert(1)</script>'),
  );
  const repositories = dataSourceFor({ siteId, alertId, eventId, rawPayload });

  await assert.rejects(
    new SafetyAlertEvidenceService(repositories, config(root)).read(siteId, alertId, eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
  await assert.rejects(
    new SafetyAlertEvidenceService(repositories, config()).read(siteId, alertId, eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});

test('evidence content rejects a configured root reached through a symlink or junction', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'smartsite-evidence-link-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const realRoot = join(parent, 'real');
  const linkedRoot = join(parent, 'linked');
  await mkdir(realRoot);
  await symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  const siteId = randomUUID();
  const alertId = randomUUID();
  const eventId = randomUUID();
  const sessionId = randomUUID();
  const rawPayload = {
    evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/3/${eventId}.jpg` }],
  };
  await writeFile(join(realRoot, `${sessionId}_3_${eventId}.jpg`), jpeg);

  await assert.rejects(
    new SafetyAlertEvidenceService(
      dataSourceFor({ siteId, alertId, eventId, rawPayload }),
      config(linkedRoot),
    ).read(siteId, alertId, eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});

test('identity review v1.3 serves matching FRAME and rejects wrong declared or modified body SHA with 409 CONFLICT', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-v13-frame-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const validV13 = identityFrameFixture(root, { schemaVersion: '1.3.0' });
  await writeFile(join(root, validV13.fileName), jpeg);
  const content = await validV13.service.readFrameForIdentityReview(
    validV13.siteId,
    validV13.alertId,
    validV13.eventId,
    '0',
    validV13.payloadHash,
  );
  assert.deepEqual(content.bytes, jpeg);
  assert.equal(content.sha256, jpegSha256);

  const changedBytes = Buffer.from([0xff, 0xd8, 0x03, 0x04, 0xff, 0xd9]);
  await writeFile(join(root, validV13.fileName), changedBytes);
  await assert.rejects(
    validV13.service.readFrameForIdentityReview(
      validV13.siteId,
      validV13.alertId,
      validV13.eventId,
      '0',
      validV13.payloadHash,
    ),
    isPublicError('CONFLICT'),
  );

  const wrongDeclaredSha = identityFrameFixture(root, {
    schemaVersion: '1.3.0',
    declaredSha: 'a'.repeat(64),
  });
  await writeFile(join(root, wrongDeclaredSha.fileName), jpeg);
  await assert.rejects(
    wrongDeclaredSha.service.readFrameForIdentityReview(
      wrongDeclaredSha.siteId,
      wrongDeclaredSha.alertId,
      wrongDeclaredSha.eventId,
      '0',
      wrongDeclaredSha.payloadHash,
    ),
    isPublicError('CONFLICT'),
  );
});

test('identity review v1.3 rejects raw/persisted scope or header contradictions and non-FRAME or cross-session items', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-identity-v13-regressions-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const overrides of [
    { schemaVersion: '1.3.0' as const, storedHash: 'a'.repeat(64) },
    { schemaVersion: '1.3.0' as const, storedSessionId: randomUUID() },
    { schemaVersion: '1.3.0' as const, conflictingSiteMapping: true },
    { schemaVersion: '1.3.0' as const, storedCameraExternalId: 'OTHER-CAMERA' },
  ]) {
    const value = identityFrameFixture(root, overrides);
    await writeFile(join(root, value.fileName), jpeg);
    await assert.rejects(
      value.service.readFrameForIdentityReview(
        value.siteId,
        value.alertId,
        value.eventId,
        '0',
        value.payloadHash,
      ),
      isPublicError('CONFLICT'),
    );
  }

  const validV13 = identityFrameFixture(root, { schemaVersion: '1.3.0' });
  await writeFile(join(root, validV13.fileName), jpeg);
  await assert.rejects(
    validV13.service.readFrameForIdentityReview(
      validV13.siteId,
      validV13.alertId,
      validV13.eventId,
      '0',
      'b'.repeat(64),
    ),
    isPublicError('CONFLICT'),
  );

  for (const overrides of [
    { schemaVersion: '1.3.0' as const, kind: 'CROP' },
    { schemaVersion: '1.3.0' as const, kind: 'SNAPSHOT' },
    { schemaVersion: '1.3.0' as const, uriSessionId: randomUUID() },
  ]) {
    const value = identityFrameFixture(root, overrides);
    await writeFile(join(root, value.fileName), jpeg);
    await assert.rejects(
      value.service.readFrameForIdentityReview(
        value.siteId,
        value.alertId,
        value.eventId,
        '0',
        value.payloadHash,
      ),
      isPublicError('NOT_FOUND'),
    );
  }
});

test('ordinary evidence reads reject conflicting historical Site mappings before serving JPEG', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-evidence-site-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root, { conflictingSiteMapping: true });
  await writeFile(join(root, value.fileName), jpeg);
  await assert.rejects(
    value.service.read(value.siteId, value.alertId, value.eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});

for (const mismatch of ['declaredSha', 'storedHash', 'storedSessionId'] as const) {
  test(`ordinary v1.3 evidence rejects ${mismatch} mismatch`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'smartsite-v13-read-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const value = identityFrameFixture(root, {
      schemaVersion: '1.3.0',
      [mismatch]: mismatch === 'storedSessionId' ? randomUUID() : 'a'.repeat(64),
    });
    await writeFile(join(root, value.fileName), jpeg);
    await assert.rejects(
      value.service.read(value.siteId, value.alertId, value.eventId, '0'),
      isPublicError('CONFLICT'),
    );
  });
}

test('ordinary v1.3 evidence accepts bound bytes then rejects a changed JPEG', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-v13-read-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root, { schemaVersion: '1.3.0' });
  await writeFile(join(root, value.fileName), jpeg);
  assert.deepEqual(
    (await value.service.read(value.siteId, value.alertId, value.eventId, '0')).bytes,
    jpeg,
  );
  await writeFile(join(root, value.fileName), Buffer.from([0xff, 0xd8, 0x03, 0x04, 0xff, 0xd9]));
  await assert.rejects(
    value.service.read(value.siteId, value.alertId, value.eventId, '0'),
    isPublicError('CONFLICT'),
  );
});

test('ordinary v1.3 evidence refuses an image URI from another source session', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'smartsite-v13-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const value = identityFrameFixture(root, { schemaVersion: '1.3.0', uriSessionId: randomUUID() });
  await writeFile(join(root, value.fileName), jpeg);
  await assert.rejects(
    value.service.read(value.siteId, value.alertId, value.eventId, '0'),
    isPublicError('NOT_FOUND'),
  );
});
