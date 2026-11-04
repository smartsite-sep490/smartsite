import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';

test('claim revalidation shares a single-connection final transaction and its rollback', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  db.setOptions({ extra: { ...db.options.extra, max: 1, connectionTimeoutMillis: 1000 } });
  try {
    await owned.initialize();
    const { input, requestId } = await storeVersionFixture(db, 'V2', '1.3.0');
    const [job] = await db.query(
      'SELECT attempt_count,lease_expires_at,deadline_at FROM zone_entry_assessment_job WHERE request_id=$1',
      [requestId],
    );
    const claim = {
      ...input.claim,
      attemptCount: job.attempt_count,
      leaseExpiresAt: job.lease_expires_at.toISOString(),
      deadlineAt: job.deadline_at.toISOString(),
    };
    const reader = new Mf06ClaimContextReader(db);
    const original = await reader.readForClaim(claim);
    assert.equal(original.status, 'MATCHED');
    await assert.rejects(
      db.transaction('SERIALIZABLE', async (manager) => {
        assert.deepEqual(await reader.revalidateForClaim(manager, claim), original);
        await manager.query(
          "UPDATE zone_entry_assessment_job SET status='CANCELLED',lease_token=NULL,lease_expires_at=NULL,head_revision=head_revision+1 WHERE request_id=$1",
          [requestId],
        );
        assert.deepEqual(await reader.revalidateForClaim(manager, claim), {
          status: 'UNAVAILABLE',
          reason: 'CLAIM_NOT_ACTIVE',
        });
        throw new Error('owned-claim-rollback');
      }),
      /owned-claim-rollback/,
    );
    assert.deepEqual(await reader.readForClaim(claim), original);
    await db.transaction('REPEATABLE READ', async (manager) => {
      assert.deepEqual(await reader.revalidateForClaim(manager, claim), {
        status: 'UNAVAILABLE',
        reason: 'TRANSACTION_REQUIRED',
      });
    });
    await db.transaction('SERIALIZABLE', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      assert.deepEqual(await reader.revalidateForClaim(manager, claim), {
        status: 'UNAVAILABLE',
        reason: 'TRANSACTION_REQUIRED',
      });
    });
    await db.transaction('SERIALIZABLE', async (manager) => {
      await manager.query("SELECT set_config('search_path',quote_ident($1)||', pg_temp',true)", [
        db.driver.schema,
      ]);
      assert.deepEqual(await reader.revalidateForClaim(manager, claim), {
        status: 'UNAVAILABLE',
        reason: 'TRANSACTION_REQUIRED',
      });
    });
  } finally {
    await owned.dispose();
  }
});
