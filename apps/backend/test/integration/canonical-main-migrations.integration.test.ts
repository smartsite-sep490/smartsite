import 'reflect-metadata';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DatabaseService } from '../../src/database/database.service.js';
import { ZONE_ENTRY_STORAGE_NAMES } from '../../src/common/configuration/zone-entry-storage-profile-v1.js';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { LEGACY_TEST_MIGRATIONS } from '../support/legacy-test-migrations.js';
import { loadMainRecoveryMigrations } from '../support/main-recovery-profile.js';
import { reviewedReleaseMigrationNames } from '../support/reviewed-release-graph.js';

const repository = process.env.SMARTSITE_TEST_SOURCE_REPO;
const snapshot = process.env.SMARTSITE_TEST_MAIN_SNAPSHOT;
// Keep the historical release54 prefix: exclude the checklist, three attendance
// additions, later visitor/manager notifications, Main QR/document additions,
// and release72+ authority/storage/notification extensions.
const afterRelease54 = new Set([
  'SafetyChecklists1792195200000',
  'AttendanceAbsence1792022400000',
  'ShiftExitGracePeriod1792281600000',
  'AttendanceExitNotifications1792281600001',
  'VisitorRoster1792022400000',
  'SiteManagerReviewNotifications1792108800000',
  'PreserveManagerNotificationHistory1792368000000',
  'WorkerQrShortCodes1792454400000',
  'WorkerDocuments1792540800000',
  'WorkerDocumentIdentityChecks1792627200000',
  'WorkerDocumentSubmittedExpiry1792713600000',
  'WorkerHealthIssueDate1792800000000',
  'PrepareNotificationCompatibility1792010000000',
  'Mf06TeamAuthorityHistory1792281600000',
  'CompleteNotificationCompatibility1792368000001',
  'ZoneEntryPhysicalStorage1792454400000',
  'PpeAlertNotifications1792886400000',
  'ExpandedPpeNotificationKinds1793145600000',
  'AuthorizationHistoryCutover1793232000000',
  'ZoneAlertNotifications1793318400000',
  'AlertDetectionSubject1793404800000',
  'CameraConfigurationReferences1793491200000',
]);
for (const profile of [
  'fresh',
  'populated-release54',
  'populated-main35',
  'populated-legacy24',
] as const) {
  test(
    `canonical current Main plus Safety ${profile}: preserve existing data/DENY, no consent or READY adoption`,
    {
      timeout: 60_000,
      skip:
        profile === 'populated-main35'
          ? repository && snapshot
            ? false
            : 'Explicit approved MAIN snapshot required'
          : !process.env.TEST_DATABASE_URL,
    },
    async (t) => {
      const isolated = createIsolatedTestDatabase({ canonical: true });
      const db = isolated.dataSource;
      const production = db.options.migrations;
      assert(Array.isArray(production));
      const expectedReleaseCount = reviewedReleaseMigrationNames(production).length;
      if (profile === 'populated-release54')
        db.setOptions({
          migrations: production.filter(
            (migration) => typeof migration !== 'function' || !afterRelease54.has(migration.name),
          ),
        });
      else if (profile === 'populated-main35') {
        assert.ok(repository && snapshot);
        db.setOptions({
          migrations: (await loadMainRecoveryMigrations(repository, snapshot)).slice(0, 35),
        });
      } else if (profile === 'populated-legacy24')
        db.setOptions({ migrations: [...LEGACY_TEST_MIGRATIONS] });
      t.after(() => isolated.dispose());
      await isolated.initialize();
      if (profile === 'populated-release54') assert.equal(db.migrations.length, 54);
      const site = randomUUID(),
        worker = randomUUID(),
        zone = randomUUID(),
        actor = randomUUID(),
        contractor = randomUUID(),
        face = randomUUID();
      const inventory: { table: string; fields: string[]; rows: unknown[] }[] = [];
      if (profile !== 'fresh') {
        await db.query(
          "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic upgrade actor','not-a-runtime-password')",
          [actor],
        );
        await db.query(
          "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Site')",
          [site],
        );
        await db.query(
          "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Contractor')",
          [contractor],
        );
        await db.query(
          "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic upgrade Worker')",
          [worker, site, contractor],
        );
        await db.query(
          "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic upgrade Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
          [zone, site],
        );
        await db.query(
          "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY','2026-10-01T00:00:00.123456Z','2026-11-01T00:00:00.654321Z')",
          [randomUUID(), site, zone, worker],
        );
        await db.query(
          "INSERT INTO face_profile(id,worker_id,profile_reference_hash,model_version,status,consent_version,consented_at,created_by_user_id) VALUES($1,$2,$3,'synthetic/no-model',$5,'legacy-only','2026-10-01T00:00:00.123456Z',$4)",
          [
            face,
            worker,
            'a'.repeat(64),
            actor,
            profile === 'populated-legacy24' ? 'NEEDS_REENROLL' : 'REVOKED',
          ],
        );
        if (profile === 'populated-legacy24')
          await db.query(
            "INSERT INTO zone_authority_command(command_id,operation,actor_kind,actor_user_id,request_hash) VALUES($1,'SYNTHETIC_UPGRADE','USER',$2,$3)",
            [randomUUID(), actor, 'b'.repeat(64)],
          );
        const columns: { table_name: string; column_name: string }[] = await db.query(
          "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name<>'migrations' ORDER BY table_name,ordinal_position",
          [db.driver.schema],
        );
        for (const table of [...new Set(columns.map((c) => c.table_name))]) {
          // Approved MAIN ErdFaceConsent intentionally revokes legacy NEEDS_REENROLL.
          // Check that transform separately; do not label its specified changes data loss.
          const fields = columns
            .filter(
              (c) =>
                c.table_name === table &&
                !(
                  profile === 'populated-legacy24' &&
                  table === 'face_profile' &&
                  ['status', 'revoked_at'].includes(c.column_name)
                ) &&
                // Current Main deliberately clears historical password-change requirements.
                !(
                  ['populated-main35', 'populated-legacy24'].includes(profile) &&
                  table === 'app_user' &&
                  c.column_name === 'must_change_password'
                ) &&
                // Team authority history extends ASSIGNMENT fields in the source registry.
                !(
                  profile === 'populated-release54' &&
                  table === 'mf06_authority_source' &&
                  c.column_name === 'fields'
                ),
            )
            .map((c) => c.column_name);
          assert([table, ...fields].every((n) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)));
          const sql = `SELECT to_jsonb(r)::text AS row FROM (SELECT ${fields.map((f) => `"${f}"`).join(',')} FROM "${table}") r ORDER BY to_jsonb(r)::text`;
          inventory.push({ table, fields, rows: await db.query(sql) });
        }
        await db.destroy();
        db.setOptions({ migrations: production });
        await db.initialize();
        const applied = await db.runMigrations();
        assert.equal(
          applied.length,
          expectedReleaseCount -
            (profile === 'populated-release54' ? 54 : profile === 'populated-main35' ? 35 : 24) +
            (profile === 'populated-legacy24' ? 1 : 0),
        );
        for (const { table, fields, rows } of inventory) {
          const afterTable =
            ZONE_ENTRY_STORAGE_NAMES[table as keyof typeof ZONE_ENTRY_STORAGE_NAMES] ?? table;
          const where =
            table === 'mf06_authority_source' ? " WHERE source_kind NOT LIKE 'TEAM%'" : '';
          assert.deepEqual(
            await db.query(
              `SELECT to_jsonb(r)::text AS row FROM (SELECT ${fields.map((f) => `"${f}"`).join(',')} FROM "${afterTable}"${where}) r ORDER BY to_jsonb(r)::text`,
            ),
            rows,
            table,
          );
        }
      }
      assert.equal(db.migrations.length, expectedReleaseCount);
      assert.equal(await new DatabaseService(db).isReady(), true);
      assert.deepEqual(await db.runMigrations(), []);
      const applied: { name: string }[] = await db.query(
        'SELECT name FROM migrations ORDER BY timestamp,id',
      );
      const registered = buildTypeOrmOptions({
        DATABASE_URL: 'postgresql://unit:unit@localhost/unit',
      }).migrations;
      assert(Array.isArray(registered));
      for (const migration of registered) {
        assert.equal(typeof migration, 'function');
        assert.equal(
          applied.filter((row) => row.name === (migration as new () => unknown).name).length,
          1,
        );
      }
      assert.equal(
        applied.length,
        expectedReleaseCount + (profile === 'populated-legacy24' ? 1 : 0),
      );
      const staleRelations = await db.query(
        'SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname = ANY($1::text[])',
        [Object.keys(ZONE_ENTRY_STORAGE_NAMES)],
      );
      assert.deepEqual(staleRelations, []);
      assert.deepEqual(
        await db.query(
          'SELECT source_kind,table_name,fields,protocol_version FROM authorization_history_source ORDER BY source_kind',
        ),
        MAIN_AUTHORITY_V2_SOURCES.map(([source_kind, table_name, fields]) => ({
          source_kind,
          table_name,
          fields: [...fields],
          protocol_version: 'MAIN_ROW_JOURNAL_V1',
        })).sort((a, b) =>
          a.source_kind < b.source_kind ? -1 : a.source_kind > b.source_kind ? 1 : 0,
        ),
        'Only the exact reviewed V2 registry transformation is allowed',
      );
      assert.equal(
        (await db.query('SELECT epoch_id FROM authorization_history_control WHERE singleton=1'))[0]
          .epoch_id,
        null,
      );
      for (const table of [
        'mf06_authority_epoch',
        'mf06_authority_fact',
        'mf06_authority_head',
        'safety_face_consent',
        'safety_face_consent_revocation',
      ]) {
        const afterTable =
          ZONE_ENTRY_STORAGE_NAMES[table as keyof typeof ZONE_ENTRY_STORAGE_NAMES] ?? table;
        const retained =
          profile === 'populated-release54'
            ? (inventory.find((entry) => entry.table === table)?.rows.length ?? 0)
            : profile !== 'fresh' && ['mf06_authority_fact', 'mf06_authority_head'].includes(table)
              ? 1
              : 0;
        assert.equal(
          Number((await db.query(`SELECT count(*) n FROM ${afterTable}`))[0].n),
          retained,
          afterTable,
        );
      }
      if (profile !== 'fresh') {
        if (profile !== 'populated-release54') {
          const facts = await db.query(
            'SELECT source_kind,source_id,operation,epoch_id,before_payload,after_payload FROM authorization_history_revision',
          );
          assert.equal(facts.length, 1);
          assert.equal(facts[0].source_kind, 'USER_ACCOUNT');
          assert.equal(facts[0].source_id, actor);
          assert.equal(facts[0].operation, 'UPDATE');
          assert.equal(facts[0].epoch_id, null);
          assert.equal(facts[0].before_payload.must_change_password, true);
          assert.equal(facts[0].after_payload.must_change_password, false);
        }
        const [metadata] = await db.query(
          'SELECT status,consent_method,consent_version,safety_revision FROM face_profile WHERE id=$1',
          [face],
        );
        assert.equal(metadata.status, 'REVOKED');
        assert.equal(metadata.consent_method, 'LEGACY_UNVERIFIED');
        assert.equal(metadata.consent_version, 'legacy-only');
        assert.match(metadata.safety_revision, /^[0-9a-f-]{36}$/);
        if (profile === 'populated-legacy24') {
          assert.equal(
            (await db.query('SELECT must_change_password FROM app_user WHERE id=$1', [actor]))[0]
              .must_change_password,
            false,
            'Retain Main optional-password migration',
          );
          const [legacy] = await db.query(
            'SELECT revoked_at IS NOT NULL AND isfinite(revoked_at) AS revoked FROM face_profile WHERE id=$1',
            [face],
          );
          assert.equal(legacy.revoked, true, 'Retained MAIN legacy re-enrollment conversion');
        }
        const result = await new ZoneEntryAuthorizationService().decide(db.manager, {
          eventId: randomUUID(),
          siteId: site,
          zoneId: zone,
          trackId: 7,
          verifiedWorkerId: worker,
          evaluatedAt: new Date('2026-10-12T12:00:00Z'),
          restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
        });
        assert.equal(result.status, 'DENIED');
        assert.equal(result.reasonCode, 'EXPLICIT_DENY');
        await assert.rejects(
          db.query('UPDATE face_profile SET safety_revision=$1 WHERE id=$2', [randomUUID(), face]),
          (error: unknown) => (error as { code?: string }).code === '23514',
        );
      }
      console.log(
        `Canonical profile ${profile}: applied${applied.length}, existingTables${inventory.length}, source data preserved; no epoch/consent adoption`,
      );
    },
  );
}
