import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneEntryTrackIdRange1790812800001 } from '../../src/database/migrations/1790812800001-ZoneEntryTrackIdRange.js';
import dataSource from '../support/test-data-source.js';

test('Track ID migration preserves range and refuses lossy downgrade atomically', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    // Session-local table shadows the real table; no other test data is altered.
    await runner.query('CREATE TEMP TABLE zone_entry_decision (track_id integer NOT NULL)');
    await runner.query('INSERT INTO pg_temp.zone_entry_decision VALUES (0), (2147483647)');
    const migration = new ZoneEntryTrackIdRange1790812800001();
    await migration.up(runner);
    await runner.query(
      'INSERT INTO pg_temp.zone_entry_decision VALUES (2147483648), (9007199254740991)',
    );
    assert.deepEqual(
      await runner.query(
        'SELECT track_id::text AS id FROM pg_temp.zone_entry_decision ORDER BY track_id',
      ),
      [{ id: '0' }, { id: '2147483647' }, { id: '2147483648' }, { id: '9007199254740991' }],
    );
    for (const invalid of ['-1', '9007199254740992']) {
      await assert.rejects(
        runner.query('INSERT INTO pg_temp.zone_entry_decision VALUES ($1)', [invalid]),
        { code: '23514' },
      );
    }
    await assert.rejects(migration.down(runner), { code: '22003' });
    // Failed down must retain BIGINT, all rows and the CHECK constraint.
    const [metadata] = await runner.query(`
      SELECT a.atttypid::regtype::text AS type,
        (SELECT count(*)::integer FROM pg_constraint c
         WHERE c.conrelid = a.attrelid AND c.conname = 'chk_zone_entry_decision_track_id') AS checks
      FROM pg_attribute a
      WHERE a.attrelid = 'pg_temp.zone_entry_decision'::regclass AND a.attname = 'track_id'
    `);
    assert.deepEqual(metadata, { type: 'bigint', checks: 1 });
    assert.equal(
      (await runner.query('SELECT count(*)::integer AS count FROM pg_temp.zone_entry_decision'))[0]
        .count,
      4,
    );
    await runner.query('DELETE FROM pg_temp.zone_entry_decision WHERE track_id > 2147483647');
    await migration.down(runner);
    assert.equal(
      (
        await runner.query(`SELECT atttypid::regtype::text AS type FROM pg_attribute
        WHERE attrelid = 'pg_temp.zone_entry_decision'::regclass AND attname = 'track_id'`)
      )[0].type,
      'integer',
    );
    // A subsequent upgrade must remain possible and keep existing decisions.
    await migration.up(runner);
    assert.equal(
      (await runner.query('SELECT count(*)::integer AS count FROM pg_temp.zone_entry_decision'))[0]
        .count,
      2,
    );
  } finally {
    await runner.query('DROP TABLE IF EXISTS pg_temp.zone_entry_decision');
    await runner.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
});
