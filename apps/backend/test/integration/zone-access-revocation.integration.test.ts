import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
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
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase();
const { dataSource } = database;
before(() => database.initialize());
after(() => database.dispose());

async function createGrant() {
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
  // Explicit synthetic legacy grant: new ALLOW commands require a Contractor
  // ceiling and approved anchored allocation. Revoking legacy rights stays valid.
  const grant = await dataSource.getRepository(ZoneAccessGrantEntity).save({
    id: randomUUID(),
    siteId,
    zoneId,
    workerId,
    contractorId: null,
    effect: ZoneAccessEffect.ALLOW,
    validFrom: new Date('2026-10-03T07:00:00.000Z'),
    validUntil: null,
    revokedAt: null,
  });
  return { service, siteId, zoneId, grant };
}

test('concurrent Zone revocations keep the first persisted timestamp and both return stored state', async () => {
  const { service, siteId, zoneId, grant } = await createGrant();
  const repository = dataSource.getRepository(ZoneAccessGrantEntity);
  const firstTime = new Date('2026-10-03T08:00:00.000Z');
  const otherTime = new Date('2026-10-03T08:00:01.000Z');
  const blocker = dataSource.createQueryRunner();
  await blocker.connect();
  await blocker.startTransaction();
  await blocker.query('SELECT id FROM zone_access_grant WHERE id=$1 FOR UPDATE', [grant.id]);
  const pending = Promise.allSettled([
    service.revokeGrant(siteId, zoneId, grant.id, firstTime),
    service.revokeGrant(siteId, zoneId, grant.id, otherTime),
  ]);
  try {
    // Hold the real row until both requests are waiting in PostgreSQL. The old
    // repository monkeypatch no longer intercepts transaction-owned repositories.
    const scope: { schema: string }[] = await dataSource.query('SELECT current_schema() AS schema');
    const deadline = Date.now() + 5000;
    let waiting = 0;
    do {
      const rows: { n: number }[] = await dataSource.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE $1 AND query LIKE '%zone_access_grant%'`,
        [`%${scope[0]!.schema}%`],
      );
      waiting = rows[0]!.n;
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    } while (waiting < 2 && Date.now() < deadline);
    assert.equal(waiting, 2, 'Both revocations must reach the actual locked grant row');
    await blocker.commitTransaction();
    const results = await pending;
    const stored = await repository.findOneBy({ id: grant.id });
    assert(stored?.revokedAt);
    assert([firstTime.getTime(), otherTime.getTime()].includes(stored.revokedAt.getTime()));
    for (const result of results) {
      assert.equal(result.status, 'fulfilled');
      if (result.status === 'fulfilled')
        assert.equal(result.value.revokedAt?.getTime(), stored.revokedAt.getTime());
    }
    const repeated = await service.revokeGrant(
      siteId,
      zoneId,
      grant.id,
      new Date('2026-10-03T09:00:00.000Z'),
    );
    assert.equal(repeated.revokedAt?.getTime(), stored.revokedAt.getTime());
    assert.equal(
      (await repository.findOneBy({ id: grant.id }))?.revokedAt?.getTime(),
      stored.revokedAt.getTime(),
    );
  } finally {
    if (blocker.isTransactionActive) await blocker.rollbackTransaction();
    await blocker.release();
    await pending;
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
