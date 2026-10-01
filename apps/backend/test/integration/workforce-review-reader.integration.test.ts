import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { WorkerEntity } from '../../src/database/entities/worker.entity.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import type { WorkerReferenceReader } from '../../src/modules/safety/identity/worker-reference.port.js';
import { observationIdentityFixture } from '../support/observation-identity-fixture.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('existing Workforce review reader scopes UUIDs and pages inactive workers with a minimal projection', async () => {
  const f = await observationIdentityFixture();
  try {
    const service = new WorkforceConfigurationService(dataSource);
    const reader: WorkerReferenceReader = service;
    const foreignId = randomUUID();
    f.workerIds.push(foreignId);
    await dataSource.getRepository(WorkerEntity).insert({
      id: foreignId,
      siteId: f.otherSiteId,
      externalId: 'W-0',
      displayName: 'Same external ID, different Site',
      isActive: true,
    });
    await dataSource.getRepository(WorkerEntity).update(f.workerIds[1]!, { isActive: false });
    const first = await reader.findForReview(dataSource.manager, f.siteId, f.workerIds[0]!, false);
    assert.ok(first);
    assert.deepEqual(Object.keys(first).sort(), [
      'displayName',
      'externalId',
      'id',
      'isActive',
      'siteId',
    ]);
    assert.equal(first.id, f.workerIds[0]);
    assert.equal(await reader.findForReview(dataSource.manager, f.siteId, foreignId, false), null);
    assert.equal(
      await reader.findForReview(dataSource.manager, f.otherSiteId, f.workerIds[0]!, false),
      null,
    );
    assert.equal(
      await reader.findForReview(dataSource.manager, f.siteId, randomUUID(), false),
      null,
    );
    const inactive = await reader.findForReview(
      dataSource.manager,
      f.siteId,
      f.workerIds[1]!,
      false,
    );
    assert.equal(inactive?.isActive, false, 'Inactive differs from missing and remains readable');
    const page = await reader.listForReview(f.siteId, 1, 1);
    assert.equal(page.total, 2);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]!.id, f.workerIds[1]);
    assert.equal(page.items[0]!.isActive, false);
    assert.deepEqual(Object.keys(page.items[0]!).sort(), Object.keys(first).sort());
    assert.deepEqual(await reader.listForReview(f.siteId, 2, 1), { items: [], total: 2 });
    await assert.rejects(reader.listForReview(f.siteId, 0, 101));
    await assert.rejects(reader.listForReview(f.siteId, -1, 1));
    await assert.rejects(reader.findForReview(dataSource.manager, f.siteId, 'not-a-uuid', false));
  } finally {
    await f.cleanup();
  }
});

test('Workforce review reader uses the caller transaction and locks Worker against concurrent disable', async () => {
  const f = await observationIdentityFixture();
  const holder = dataSource.createQueryRunner();
  const concurrent = dataSource.createQueryRunner();
  try {
    const service = new WorkforceConfigurationService(dataSource);
    const reader: WorkerReferenceReader = service;
    await holder.connect();
    await holder.startTransaction();
    await holder.manager.getRepository(WorkerEntity).update(f.workerIds[1]!, {
      displayName: 'Uncommitted caller transaction name',
    });
    const callerVisible = await reader.findForReview(
      holder.manager,
      f.siteId,
      f.workerIds[1]!,
      false,
    );
    assert.equal(callerVisible?.displayName, 'Uncommitted caller transaction name');
    // This other Worker has not been updated: only the reader may acquire its lock.
    const locked = await reader.findForReview(holder.manager, f.siteId, f.workerIds[0]!, true);
    assert.equal(locked?.id, f.workerIds[0]);
    await concurrent.connect();
    await concurrent.startTransaction();
    await concurrent.query("SET LOCAL lock_timeout = '200ms'");
    await assert.rejects(
      concurrent.manager.getRepository(WorkerEntity).update(f.workerIds[0]!, { isActive: false }),
      (error: unknown) =>
        (error as { driverError?: { code?: string } }).driverError?.code === '55P03',
    );
    await concurrent.rollbackTransaction();
    await holder.rollbackTransaction();
    await concurrent.manager
      .getRepository(WorkerEntity)
      .update(f.workerIds[0]!, { isActive: false });
    const disabled = await reader.findForReview(
      dataSource.manager,
      f.siteId,
      f.workerIds[0]!,
      false,
    );
    assert.equal(disabled?.isActive, false);
    const rolledBack = await reader.findForReview(
      dataSource.manager,
      f.siteId,
      f.workerIds[1]!,
      false,
    );
    assert.equal(
      rolledBack?.displayName,
      'Synthetic Worker 1',
      'Caller rollback must remain effective',
    );
  } finally {
    if (concurrent.isTransactionActive) await concurrent.rollbackTransaction();
    if (holder.isTransactionActive) await holder.rollbackTransaction();
    await concurrent.release();
    await holder.release();
    await f.cleanup();
  }
});
