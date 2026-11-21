import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { WorkerDocumentReviewWorkflow1795478400000 } from '../../src/database/migrations/1795478400000-WorkerDocumentReviewWorkflow.js';

test('document workflow migration preserves legacy profiles, AI storage and empty rollback/reapply', async () => {
  const owned = createIsolatedTestDatabase();
  try {
    await owned.initialize();
    const site = randomUUID(),
      worker = randomUUID();
    const db = owned.dataSource;
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic Worker')",
      [worker, site],
    );
    await db.query(
      "INSERT INTO worker_compliance_profile(worker_id,national_id) VALUES($1,'000000000001')",
      [worker],
    );
    await db.transaction(async (manager) => {
      const runner = manager.queryRunner!;
      const migration = new WorkerDocumentReviewWorkflow1795478400000();
      await migration.down(runner);
      assert.equal(await runner.hasColumn('worker_compliance_profile', 'version'), false);
      assert.equal(await runner.hasColumn('worker_document', 'ai_analysis'), true);
      await migration.up(runner);
      const [restored] = await manager.query(
        'SELECT safety_card_required,version,national_id FROM worker_compliance_profile WHERE worker_id=$1',
        [worker],
      );
      assert.equal(restored.safety_card_required, true);
      assert.equal(restored.version, 1);
      assert.equal(restored.national_id, '000000000001');
      await manager.query('SAVEPOINT invalid_version');
      await assert.rejects(
        manager.query('UPDATE worker_compliance_profile SET version=0 WHERE worker_id=$1', [
          worker,
        ]),
      );
      await manager.query('ROLLBACK TO SAVEPOINT invalid_version');
    });
    const schema = await db.driver.createSchemaBuilder().log();
    assert.deepEqual(schema.upQueries, []);
  } finally {
    await owned.dispose();
  }
});
