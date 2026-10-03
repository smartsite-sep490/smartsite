import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  SiteEntity,
  WorkerEntity,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
  ZoneEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

async function createGrant() {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const zoneId = randomUUID();
  const workerId = randomUUID();
  await dataSource.getRepository(SiteEntity).insert({
    id: siteId,
    code: `REV-${siteId}`,
    name: 'Synthetic revocation Site',
  });
  await dataSource.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: `REV-${zoneId}`,
    name: 'Synthetic restricted Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    requiredPpe: [],
    configurationLocked: false,
  });
  await dataSource.getRepository(WorkerEntity).insert({
    id: workerId,
    siteId,
    externalId: `REV-${workerId}`,
    displayName: 'Synthetic Worker',
    isActive: true,
  });
  const service = new ZoneAccessManagementService(dataSource);
  const grant = await service.createGrant(siteId, zoneId, {
    workerId,
    effect: ZoneAccessEffect.ALLOW,
    validFrom: '2026-10-03T07:00:00.000Z',
    validUntil: null,
  });
  return { service, siteId, zoneId, grant };
}

test('concurrent Zone revocations keep the first persisted timestamp and both return stored state', async () => {
  const { service, siteId, zoneId, grant } = await createGrant();
  const repository = dataSource.getRepository(ZoneAccessGrantEntity);
  const originalFind = repository.findOneBy.bind(repository);
  const restoreFind = repository.findOneBy;
  let initialReads = 0;
  let releaseReads!: () => void;
  const bothHaveRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  // Force both requests to see the initial NULL before either writes. Reads and
  // writes still use the actual PostgreSQL repository, never a fake SQL store.
  repository.findOneBy = async (where) => {
    const row = await originalFind(where);
    if (++initialReads <= 2) {
      if (initialReads === 2) releaseReads();
      await bothHaveRead;
    }
    return row;
  };
  const firstTime = new Date('2026-10-03T08:00:00.000Z');
  const otherTime = new Date('2026-10-03T08:00:01.000Z');
  try {
    const results = await Promise.all([
      service.revokeGrant(siteId, zoneId, grant.id, firstTime),
      service.revokeGrant(siteId, zoneId, grant.id, otherTime),
    ]);
    const stored = await originalFind({ id: grant.id });
    assert(stored?.revokedAt);
    assert([firstTime.getTime(), otherTime.getTime()].includes(stored.revokedAt.getTime()));
    for (const result of results) {
      assert.equal(result.revokedAt?.getTime(), stored.revokedAt.getTime());
    }
    const repeated = await service.revokeGrant(
      siteId,
      zoneId,
      grant.id,
      new Date('2026-10-03T09:00:00.000Z'),
    );
    assert.equal(repeated.revokedAt?.getTime(), stored.revokedAt.getTime());
    assert.equal(
      (await originalFind({ id: grant.id }))?.revokedAt?.getTime(),
      stored.revokedAt.getTime(),
    );
  } finally {
    repository.findOneBy = restoreFind;
  }
});

test('Zone revocation refuses wrong Site or Zone without modifying the grant', async () => {
  const { service, siteId, zoneId, grant } = await createGrant();
  const notFound = (error: unknown) =>
    error instanceof PublicHttpException && error.getStatus() === 404;
  await assert.rejects(service.revokeGrant(randomUUID(), zoneId, grant.id), notFound);
  await assert.rejects(service.revokeGrant(siteId, randomUUID(), grant.id), notFound);
  assert.equal(
    (await dataSource.getRepository(ZoneAccessGrantEntity).findOneBy({ id: grant.id }))?.revokedAt,
    null,
  );
});
