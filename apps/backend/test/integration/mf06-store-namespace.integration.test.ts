import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { storeVersionFixture } from '../support/mf06-store-version.fixture.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedStoreNamespaceSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

for (const mode of ['append', 'replay'] as const) {
  test(`MF06 Store ${mode} ignores empty pg_temp shadows and uses its configured schema`, async () => {
    const fixture = await storeVersionFixture(db, 'V2');
    const store = new Mf06AssessmentStore(db);
    if (mode === 'replay') assert.equal((await store.finalize(fixture.input)).state, 'RECORDED');
    const result = await db.transaction('SERIALIZABLE', async (manager) => {
      const schema = (db.options as { schema: string }).schema;
      assert.match(schema, /^isolated_test_[a-f0-9]{32}$/);
      const names = [
        'zone_entry_assessment_request',
        'zone_entry_assessment_job',
        'zone_entry_assessment',
        'zone_entry_authority_artifact',
      ];
      for (const name of names)
        await manager.query(
          `CREATE TEMP TABLE ${name} ON COMMIT DROP AS SELECT * FROM "${schema}"."${name}" WITH NO DATA`,
        );
      await manager.query(`SET LOCAL search_path=pg_temp,"${schema}"`);
      const value = await store.finalizeInTransaction(manager, fixture.input);
      assert.equal(
        (await manager.query("SELECT current_setting('search_path') AS path"))[0].path,
        `"${schema}",pg_catalog,pg_temp`,
      );
      for (const name of names)
        assert.equal(
          (await manager.query(`SELECT count(*)::int AS n FROM pg_temp.${name}`))[0].n,
          0,
        );
      return value;
    });
    assert.equal(result.state, mode === 'append' ? 'RECORDED' : 'REPLAY');
    const schema = (db.options as { schema: string }).schema;
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int AS n FROM "${schema}".zone_entry_assessment WHERE request_id=$1`,
          [fixture.requestId],
        )
      )[0].n,
      1,
    );
  });
}
