import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import sharp from 'sharp';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { BackendEnvironment } from '../src/config/environment.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import {
  AiObservationEventEntity,
  AlertDetectionMappingEntity,
  SafetyAlertEntity,
} from '../src/database/entities/index.js';
import { SafetyAlertEvidenceService } from '../src/modules/safety/alerts/safety-alert-evidence.service.js';
import {
  reviewEventIsConsistent,
  reviewRawEventIsConsistent,
} from '../src/modules/safety/identity/observation-identity-event.js';

const jpeg = await sharp({
  create: { width: 2, height: 2, channels: 3, background: { r: 24, g: 96, b: 180 } },
})
  .jpeg()
  .toBuffer();
const sha256 = createHash('sha256').update(jpeg).digest('hex');
const fixtureRoot = await mkdtemp(
  join(process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : tmpdir(), 'mf08-v14-'),
);

async function fixture({
  sequence = '2',
  uriSequence = sequence,
  version = '1.4.0',
  wrongSha = false,
  deletedCamera = false,
}: {
  sequence?: string;
  uriSequence?: string;
  version?: string;
  wrongSha?: boolean;
  deletedCamera?: boolean;
} = {}) {
  const eventId = randomUUID(),
    sessionId = randomUUID(),
    siteId = randomUUID(),
    alertId = randomUUID();
  const evidence: { kind: string; uri: string; sha256?: string } = {
    kind: 'FRAME',
    uri: `local://evidence/${sessionId}/${uriSequence}/${eventId}.jpg`,
    ...(version === '1.0.0' ? {} : { sha256: wrongSha ? '0'.repeat(64) : sha256 }),
  };
  const raw: Record<string, unknown> = {
    eventId,
    schemaVersion: version,
    cameraExternalId: 'SYNTHETIC-MF08',
    streamSessionId: sessionId,
    capturedAt: '2026-10-27T12:00:00.000Z',
    frameDimensions: { width: 2, height: 2 },
    ...(version === '1.4.0'
      ? {
          framePartition: {
            frameId: randomUUID(),
            sequenceNumber: sequence,
            partIndex: 0,
            partCount: 1,
          },
        }
      : {}),
    observations: [
      { type: 'PERSON', trackId: 7 },
      {
        type: 'PPE',
        trackId: 7,
        ppeItem: 'HARD_HAT',
        status: 'MISSING',
        regionId: randomUUID(),
        geometryVersion: 1,
      },
    ],
    evidence: [evidence],
  };
  const event = Object.assign(new AiObservationEventEntity(), {
    eventId,
    rawPayload: raw,
    payloadHash: computeCanonicalPayloadHash(raw),
    cameraExternalId: 'SYNTHETIC-MF08',
    streamSessionId: sessionId,
    capturedAt: new Date('2026-10-27T12:00:00.000Z'),
    resolvedCameraId: deletedCamera ? null : randomUUID(),
  });
  const media = await mkdtemp(join(fixtureRoot, 'frame-'));
  await writeFile(join(media, `${sessionId}_${uriSequence}_${eventId}.jpg`), jpeg);
  const source = {
    getRepository(entity: unknown) {
      if (entity === SafetyAlertEntity)
        return {
          findOneBy: async (where: { id: string; siteId: string }) =>
            where.id === alertId && where.siteId === siteId ? { id: alertId, siteId } : null,
        };
      if (entity === AiObservationEventEntity)
        return {
          findOneBy: async (where: { eventId: string }) =>
            where.eventId === eventId ? event : null,
        };
      if (entity === AlertDetectionMappingEntity) {
        const builder = {
          innerJoin() {
            return builder;
          },
          where() {
            return builder;
          },
          andWhere() {
            return builder;
          },
          async getExists() {
            return false;
          },
        };
        return {
          findOneBy: async (where: { alertId: string; eventId: string }) =>
            where.alertId === alertId && where.eventId === eventId ? where : null,
          createQueryBuilder: () => builder,
        };
      }
      throw new Error('Unexpected fixture repository');
    },
  } as unknown as DataSource;
  const service = new SafetyAlertEvidenceService(
    source,
    new ConfigService<BackendEnvironment, true>({ EVIDENCE_LOCAL_ROOT: media }),
  );
  return { raw, event, siteId, alertId, service };
}

const publicError = (code: string) => (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === code;
const review = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.service.readFrameForIdentityReview(
    f.siteId,
    f.alertId,
    f.event.eventId,
    '0',
    f.event.payloadHash,
  );
const read = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.service.read(f.siteId, f.alertId, f.event.eventId, '0');

test('v1.4 raw and active review retain canonical bindings', async () => {
  const f = await fixture();
  assert.equal(reviewRawEventIsConsistent(f.event), true);
  assert.equal(reviewEventIsConsistent(f.event), true);
});
test('v1.4 review accepts matching actual JPEG', async () => {
  assert.deepEqual((await review(await fixture())).bytes, jpeg);
});
test('uint64max v1.4 ordinary image keeps exact filename digits', async () => {
  assert.deepEqual((await read(await fixture({ sequence: '18446744073709551615' }))).bytes, jpeg);
});
test('uint64max v1.4 review and summary remain bound', async () => {
  const f = await fixture({ sequence: '18446744073709551615' });
  assert.equal(f.service.summarize(f.raw, f.event.eventId)[0]?.available, true);
  assert.deepEqual((await review(f)).bytes, jpeg);
});
test('v1.4 URI sequence mismatch is unavailable', async () => {
  await assert.rejects(review(await fixture({ uriSequence: '3' })), publicError('NOT_FOUND'));
});
test('v1.4 review rejects mismatching actual image SHA', async () => {
  await assert.rejects(review(await fixture({ wrongSha: true })), publicError('CONFLICT'));
});
test('ordinary v1.4 image rejects mismatching actual SHA', async () => {
  await assert.rejects(read(await fixture({ wrongSha: true })), publicError('CONFLICT'));
});
test('ordinary v1.4 image rejects stored hash mismatch', async () => {
  const f = await fixture();
  f.event.payloadHash = '0'.repeat(64);
  await assert.rejects(read(f), publicError('CONFLICT'));
});
test('ordinary v1.4 image rejects row capture-time mismatch', async () => {
  const f = await fixture();
  f.event.capturedAt = new Date(f.event.capturedAt.getTime() + 1);
  await assert.rejects(read(f), publicError('CONFLICT'));
});
test('historical v1.4 image remains readable after camera deletion', async () => {
  assert.deepEqual((await read(await fixture({ deletedCamera: true }))).bytes, jpeg);
});
test('v1.4 review rejects wrong stored hash', async () => {
  const f = await fixture();
  f.event.payloadHash = '0'.repeat(64);
  assert.equal(reviewRawEventIsConsistent(f.event), false);
  await assert.rejects(review(f), publicError('CONFLICT'));
});
test('v1.4 orphan subject is rejected with recomputed payload hash', async () => {
  const f = await fixture();
  f.raw.observations = (f.raw.observations as { type: string }[]).filter(
    (o) => o.type !== 'PERSON',
  );
  f.event.payloadHash = computeCanonicalPayloadHash(f.raw);
  assert.equal(reviewRawEventIsConsistent(f.event), false);
  await assert.rejects(review(f), publicError('CONFLICT'));
});
test('deleted camera preserves raw history without allowing active review', async () => {
  const f = await fixture({ deletedCamera: true });
  assert.equal(reviewRawEventIsConsistent(f.event), true);
  assert.equal(reviewEventIsConsistent(f.event), false);
  await assert.rejects(review(f), publicError('CONFLICT'));
});
for (const version of ['1.0.0', '1.3.0'])
  test('legacy ' + version + ' remains readable', async () => {
    const f = await fixture({ version });
    assert.equal(reviewEventIsConsistent(f.event), true);
    assert.deepEqual((await review(f)).bytes, jpeg);
  });
test('legacy URI above safe integer remains unavailable', async () => {
  await assert.rejects(
    read(await fixture({ version: '1.3.0', sequence: '18446744073709551615' })),
    publicError('NOT_FOUND'),
  );
});
test('v1.4 uint64 overflow remains conflict', async () => {
  const f = await fixture({ sequence: '18446744073709551616' });
  assert.equal(reviewRawEventIsConsistent(f.event), false);
  await assert.rejects(read(f), publicError('CONFLICT'));
});
test('v1.4 row capture time is bound by the raw reader', async () => {
  const f = await fixture();
  f.event.capturedAt = new Date(f.event.capturedAt.getTime() + 1);
  assert.equal(reviewRawEventIsConsistent(f.event), false);
});
