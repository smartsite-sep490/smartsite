import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { ZoneEntryDecisionEntity } from '../src/database/entities/zone-entry-decision.entity.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { ZoneAccessManagementService } from '../src/modules/zones/zone-access-management.service.js';

test('original Zone decisions are scoped to exact Site/event/track and project no Worker identity', async () => {
  const siteId = randomUUID();
  const eventId = randomUUID();
  const evaluatedAt = new Date('2026-10-01T00:00:00Z');
  const stored = [
    {
      id: randomUUID(),
      zoneId: randomUUID(),
      status: 'DENIED',
      reasonCode: 'PROHIBITED_FOR_ALL',
      evaluatedAt,
      workerId: randomUUID(),
    },
    {
      id: randomUUID(),
      zoneId: randomUUID(),
      status: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      evaluatedAt,
      candidateWorkerId: 'not-authority',
    },
  ];
  let query: unknown;
  const service = new ZoneAccessManagementService({
    getRepository(entity: unknown) {
      assert.equal(entity, ZoneEntryDecisionEntity);
      return {
        findAndCount: async (options: unknown) => {
          query = options;
          return [stored, 2];
        },
      };
    },
  } as unknown as DataSource);
  const result = await service.listObservationDecisions(
    siteId,
    eventId,
    Number.MAX_SAFE_INTEGER,
    0,
    100,
  );
  assert.deepEqual(query, {
    where: { siteId, eventId, trackId: Number.MAX_SAFE_INTEGER },
    order: { evaluatedAt: 'ASC', id: 'ASC' },
    skip: 0,
    take: 100,
  });
  assert.equal(result.total, 2);
  assert.deepEqual(
    result.items,
    stored.map(({ id, zoneId, status, reasonCode, evaluatedAt }) => ({
      id,
      zoneId,
      status,
      reasonCode,
      evaluatedAt,
    })),
  );
  assert.doesNotMatch(JSON.stringify(result), /workerId|candidateWorkerId/);
});

test('no stored Zone decision is an empty result, not a synthesized UNAVAILABLE decision', async () => {
  const service = new ZoneAccessManagementService({
    getRepository: () => ({ findAndCount: async () => [[], 0] }),
  } as unknown as DataSource);
  assert.deepEqual(await service.listObservationDecisions(randomUUID(), randomUUID(), 7), {
    items: [],
    total: 0,
  });
});

test('original-decision queries reject invalid scope, Track IDs and pagination before database access', async () => {
  const service = new ZoneAccessManagementService(undefined as unknown as DataSource);
  const invalid = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';
  for (const trackId of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      service.listObservationDecisions(randomUUID(), randomUUID(), trackId),
      invalid,
    );
  }
  await assert.rejects(service.listObservationDecisions('not-site', randomUUID(), 7), invalid);
  await assert.rejects(service.listObservationDecisions(randomUUID(), 'not-event', 7), invalid);
  await assert.rejects(
    service.listObservationDecisions(randomUUID(), randomUUID(), 7, -1, 20),
    invalid,
  );
  await assert.rejects(
    service.listObservationDecisions(randomUUID(), randomUUID(), 7, 0, 101),
    invalid,
  );
});
