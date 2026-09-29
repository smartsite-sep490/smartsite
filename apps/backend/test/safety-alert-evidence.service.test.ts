import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../src/database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../src/database/entities/safety-alert.entity.js';
import { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';

const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

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
        return {
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
              ? { eventId: input.eventId, rawPayload: input.rawPayload }
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
