import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { SafetyEpisodes1794355200000 } from '../../src/database/migrations/1794355200000-SafetyEpisodes.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase();
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());

test('registered episode migration and entity metadata agree on the fresh canonical schema', async () => {
  assert.equal(db.options.synchronize, false);
  assert.equal(db.options.migrationsRun, false);
  const runner = db.createQueryRunner();
  try {
    assert.equal(await runner.hasTable('safety_episode'), true);
    assert.equal(await runner.hasTable('safety_episode_recipient'), true);
  } finally {
    await runner.release();
  }
  const drift = await db.driver.createSchemaBuilder().log();
  assert.deepEqual(
    drift.upQueries.map((query) => query.query),
    [],
  );
});

test('same-site exact subject storage and revision acknowledgement preserve history and refuse unsafe rollback', async () => {
  const runner = db.createQueryRunner();
  await runner.connect();
  try {
    await runner.startTransaction();
    const site = randomUUID(),
      other = randomUUID(),
      camera = randomUUID(),
      event = randomUUID();
    const episode = randomUUID(),
      user = randomUUID(),
      recipient = randomUUID();
    const captured = '2026-10-29T00:00:00.000Z',
      hash = 'a'.repeat(64);
    await runner.query(
      'INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text),($2::uuid,$2::text,$2::text)',
      [site, other],
    );
    await runner.query(
      'INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1::uuid,$2::uuid,$1::text,$1::text,$1::text)',
      [camera, site],
    );
    await runner.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,
      stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,$3::text,$3::uuid,$4,$5,$6::jsonb,'PROCESSED')`,
      [
        event,
        hash,
        camera,
        randomUUID(),
        captured,
        JSON.stringify({ observations: [{ type: 'PERSON', trackId: 7 }] }),
      ],
    );
    const insert = (id: string, scopedSite = site, index = 0) =>
      runner.query(
        `INSERT INTO safety_episode
      (id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
        [id, scopedSite, camera, event, index, hash, captured],
      );
    let sequence = 0;
    const refuses = async (operation: () => Promise<unknown>, expected: string) => {
      const savepoint = `episode_case_${++sequence}`;
      await runner.query(`SAVEPOINT ${savepoint}`);
      try {
        await assert.rejects(operation, (error: unknown) => {
          const failure = error as { code?: string; driverError?: { code?: string } };
          return (failure.driverError?.code ?? failure.code) === expected;
        });
      } finally {
        await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await runner.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
    };
    await refuses(() => insert(randomUUID(), other), '23514');
    await refuses(() => insert(randomUUID(), site, 1), '23514');
    await insert(episode);
    await refuses(() => insert(randomUUID()), '23505');
    const alert = randomUUID();
    const insertAlert = (scopedSite: string) =>
      runner.query(
        `INSERT INTO safety_alert
      (id,site_id,episode_id,alert_type,candidate_subtype,grouping_key,first_detected_at,last_detected_at)
      VALUES($1,$2,$3,'PPE_VIOLATION','PPE_HARD_HAT_MISSING','SYNTHETIC_EPISODE_STORAGE',$4,$4)`,
        [alert, scopedSite, episode, captured],
      );
    await refuses(() => insertAlert(other), '23503');
    await insertAlert(site);
    await refuses(
      () => runner.query('UPDATE safety_alert SET episode_id=NULL WHERE id=$1', [alert]),
      '23514',
    );
    await refuses(
      () => runner.query('UPDATE safety_episode SET site_id=$2 WHERE id=$1', [episode, other]),
      '23514',
    );
    await runner.query(
      `INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,'SYNTHETIC_NOT_USABLE')`,
      [user],
    );
    await runner.query(
      `INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id) VALUES($1,$2,$3,$4)`,
      [recipient, episode, site, user],
    );
    await refuses(
      () =>
        runner.query('UPDATE safety_episode_recipient SET seen_revision=2 WHERE id=$1', [
          recipient,
        ]),
      '23514',
    );
    await runner.query('UPDATE safety_episode SET content_revision=2 WHERE id=$1', [episode]);
    await runner.query('UPDATE safety_episode_recipient SET seen_revision=1 WHERE id=$1', [
      recipient,
    ]);
    const [state] = await runner.query(
      `SELECT r.seen_revision,e.content_revision,(r.seen_revision<e.content_revision) AS unread
      FROM safety_episode_recipient r JOIN safety_episode e ON e.id=r.episode_id WHERE r.id=$1`,
      [recipient],
    );
    assert.deepEqual(state, { seen_revision: 1, content_revision: 2, unread: true });
    await refuses(
      () =>
        runner.query('UPDATE safety_episode_recipient SET seen_revision=0 WHERE id=$1', [
          recipient,
        ]),
      '23514',
    );
    await assert.rejects(
      new SafetyEpisodes1794355200000().down(runner),
      /history must be preserved/,
    );
    const [retained] = await runner.query(
      'SELECT count(*)::int AS count FROM safety_episode WHERE id=$1',
      [episode],
    );
    assert.equal(retained.count, 1);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('empty downgrade and populated upgrade preserve preexisting Site bytes', async () => {
  const site = randomUUID();
  await db.query('INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text)', [site]);
  const before = await db.query('SELECT to_jsonb(s) AS row FROM site s WHERE id=$1', [site]);
  const runner = db.createQueryRunner(),
    migration = new SafetyEpisodes1794355200000();
  await runner.connect();
  try {
    await runner.startTransaction();
    await migration.down(runner);
    assert.equal(await runner.hasTable('safety_episode'), false);
    await migration.up(runner);
    assert.equal(await runner.hasTable('safety_episode'), true);
    await runner.commitTransaction();
    assert.deepEqual(
      await db.query('SELECT to_jsonb(s) AS row FROM site s WHERE id=$1', [site]),
      before,
    );
    const drift = await db.driver.createSchemaBuilder().log();
    assert.deepEqual(
      drift.upQueries.map((query) => query.query),
      [],
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});
