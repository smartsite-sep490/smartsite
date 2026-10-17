import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import type { MigrationInterface } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const prepare = 'PrepareNotificationCompatibility1792010000000';
const complete = 'CompleteNotificationCompatibility1792368000001';
const naming = 'ZoneEntryPhysicalStorage1792454400000';
const additions = new Set([prepare, complete, naming]);
const old56Incoming = new Set([
  'AttendanceAbsence1792022400000',
  'ShiftExitGracePeriod1792281600000',
  'AttendanceExitNotifications1792281600001',
  'VisitorRoster1792022400000',
  'SiteManagerReviewNotifications1792108800000',
  'PreserveManagerNotificationHistory1792368000000',
]);
const safety = new Set([
  'Mf06AssessmentRequests1791590400001',
  'Mf06MainAuthorityJournal1791590400002',
  'SafetyFaceProvenance1791590400003',
  'Mf06ImmutableAssessments1791590400004',
  'Mf06TeamAuthorityHistory1792281600000',
]);

async function checklist(commit: string) {
  const text = execFileSync(
    'git',
    ['show', `${commit}:apps/backend/src/database/migrations/1792195200000-SafetyChecklists.ts`],
    { encoding: 'utf8', windowsHide: true },
  );
  const js = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  assert(!/^import\s/m.test(js));
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`))
    .SafetyChecklists1792195200000 as new () => MigrationInterface;
}

async function fixture(main = false) {
  const owned = createIsolatedTestDatabase({ canonical: true });
  const db = owned.dataSource;
  const release = db.options.migrations;
  assert(Array.isArray(release));
  for (const name of [prepare, complete])
    assert(
      release.some((m) => typeof m === 'function' && m.name === name),
      `${name} registration required`,
    );
  const HistoricalChecklist = await checklist(
    main ? '0ef7b6901cde852e5660e8a58f1a194e16ac560a' : '907b4ca',
  );
  db.setOptions({
    migrations: release
      .filter(
        (m) =>
          typeof m === 'function' &&
          !additions.has(m.name) &&
          !(main ? safety : old56Incoming).has(m.name),
      )
      .map((m) =>
        typeof m === 'function' && m.name === 'SafetyChecklists1792195200000'
          ? HistoricalChecklist
          : m,
      ),
  });
  try {
    await owned.initialize();
    assert.equal(db.migrations.length, main ? 57 : 56);
    const site = randomUUID(),
      user = randomUUID(),
      contractor = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Site')",
      [site],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic recipient','synthetic-not-login')",
      [user],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Contractor')",
      [contractor],
    );
    await db.query(
      'INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,recipient_role,request_type,request_id,event,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
      [
        randomUUID(),
        user,
        site,
        contractor,
        main ? 'SITE_MANAGER' : 'SAFETY_OFFICER',
        main ? 'ATTENDANCE' : 'CHECKLIST',
        randomUUID(),
        main ? 'ABSENT' : 'CHECKLIST_ASSIGNED',
        JSON.stringify({ checklistId: randomUUID(), message: 'Synthetic preserved notification' }),
      ],
    );
    const before = await snapshot(db);
    await db.destroy();
    db.setOptions({ migrations: release });
    await db.initialize();
    return { owned, db, before };
  } catch (error) {
    await owned.dispose();
    throw error;
  }
}

async function snapshot(db: ReturnType<typeof createIsolatedTestDatabase>['dataSource']) {
  return {
    notifications: await db.query(
      'SELECT to_jsonb(n)::text row FROM user_notification n ORDER BY id',
    ),
    journal: await db.query('SELECT * FROM migrations ORDER BY id'),
  };
}

async function noBridgeObjects(db: ReturnType<typeof createIsolatedTestDatabase>['dataSource']) {
  assert.deepEqual(
    await db.query(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND relname='notification_upgrade_bridge'`),
    [],
  );
  assert.deepEqual(
    await db.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND proname='notification_upgrade_commit_guard'`),
    [],
  );
}

for (const main of [false, true]) {
  test(`atomic ${main ? 'Main57 Manager' : 'Tuấn56 Checklist'} upgrade preserves every notification field`, async () => {
    const f = await fixture(main);
    try {
      await f.db.runMigrations({ transaction: 'all' });
      assert.deepEqual((await snapshot(f.db)).notifications, f.before.notifications);
      assert.equal((await snapshot(f.db)).journal.length, f.db.migrations.length);
      assert.deepEqual(await f.db.runMigrations({ transaction: 'all' }), []);
      assert.equal((await f.db.query('SELECT count(*)::int n FROM safety_face_consent'))[0].n, 0);
      await noBridgeObjects(f.db);
    } finally {
      await f.owned.dispose();
    }
  });
}

test('per-migration commit cannot expose temporary notification values', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.db.runMigrations({ transaction: 'each' }),
      /same transaction|bridge must complete/i,
    );
    assert.deepEqual(await snapshot(f.db), f.before);
    await noBridgeObjects(f.db);
  } finally {
    await f.owned.dispose();
  }
});

class RejectAfterNotificationPrepare1792010000001 {
  async up() {
    throw new Error('Synthetic failure after notification prepare');
  }
  async down() {
    throw new Error('Synthetic fixture must be disposed');
  }
}

test('failure after prepare restores notification, journal and bridge DDL atomically', async () => {
  const f = await fixture();
  try {
    const migrations = f.db.options.migrations;
    assert(Array.isArray(migrations));
    await f.db.destroy();
    f.db.setOptions({ migrations: [...migrations, RejectAfterNotificationPrepare1792010000001] });
    await f.db.initialize();
    await assert.rejects(
      f.db.runMigrations({ transaction: 'all' }),
      /Synthetic failure after notification prepare/,
    );
    assert.deepEqual(await snapshot(f.db), f.before);
    await noBridgeObjects(f.db);
  } finally {
    await f.owned.dispose();
  }
});
