import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import {
  AlertStatus,
  AlertType,
  CameraStatus,
  EventProcessingStatus,
  SafetyAlertEntity,
  SiteEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import dataSource from '../../src/database/typeorm.data-source.js';

async function withDataSource<T>(fn: (source: DataSource) => Promise<T>): Promise<T> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  try {
    return await fn(dataSource);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

test('foundation migration creates 7 tables with required columns, nullability, and types', async () => {
  await withDataSource(async (source) => {
    const tables = await source.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
        'site', 'camera', 'zone', 'camera_observation_region',
        'ai_observation_event', 'safety_alert', 'alert_detection_mapping'
      ) ORDER BY tablename`,
    );
    assert.equal(tables.length, 7);

    // Verify candidate_subtype is NOT NULL on safety_alert
    const [candidateSubtypeCol] = await source.query(
      `SELECT is_nullable, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'safety_alert' AND column_name = 'candidate_subtype'`,
    );
    assert.ok(candidateSubtypeCol);
    assert.equal(candidateSubtypeCol.is_nullable, 'NO');
    assert.equal(candidateSubtypeCol.character_maximum_length, 64);

    // Verify required_ppe is ARRAY on zone
    const [requiredPpeCol] = await source.query(
      `SELECT is_nullable, data_type, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'zone' AND column_name = 'required_ppe'`,
    );
    assert.ok(requiredPpeCol);
    assert.equal(requiredPpeCol.data_type, 'ARRAY');
    assert.equal(requiredPpeCol.is_nullable, 'NO');
  });
});

test('foundation migration registers exact enum labels in PostgreSQL catalog', async () => {
  await withDataSource(async (source) => {
    const enumRows = await source.query(
      `SELECT t.typname, e.enumlabel
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       WHERE t.typname IN (
         'camera_status', 'zone_type', 'zone_restriction_policy',
         'event_processing_status', 'alert_type', 'alert_status'
       )
       ORDER BY t.typname, e.enumsortorder`,
    );

    const enumMap = new Map<string, string[]>();
    for (const r of enumRows as { typname: string; enumlabel: string }[]) {
      const list = enumMap.get(r.typname) ?? [];
      list.push(r.enumlabel);
      enumMap.set(r.typname, list);
    }

    assert.deepEqual(enumMap.get('camera_status'), Object.values(CameraStatus));
    assert.deepEqual(enumMap.get('zone_type'), Object.values(ZoneType));
    assert.deepEqual(enumMap.get('zone_restriction_policy'), Object.values(ZoneRestrictionPolicy));
    assert.deepEqual(enumMap.get('event_processing_status'), Object.values(EventProcessingStatus));
    assert.deepEqual(enumMap.get('alert_type'), Object.values(AlertType));
    assert.deepEqual(enumMap.get('alert_status'), Object.values(AlertStatus));
  });
});

test('foundation migration defines all deterministic PK, UQ, FK, and Check constraints with exact onDelete rules', async () => {
  await withDataSource(async (source) => {
    // 1. Primary Keys
    const pkRows = await source.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'p' AND connamespace = 'public'::regnamespace ORDER BY conname`,
    );
    const pkNames = new Set(pkRows.map((r: { conname: string }) => r.conname));
    const expectedPKs = [
      'pk_site_id',
      'pk_camera_id',
      'pk_zone_id',
      'pk_camera_observation_region_id',
      'pk_ai_observation_event_event_id',
      'pk_safety_alert_id',
      'pk_alert_detection_mapping',
    ];
    for (const pk of expectedPKs) {
      assert.ok(pkNames.has(pk), `Missing expected primary key constraint: ${pk}`);
    }

    // 2. Unique Constraints
    const uqRows = await source.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'u' AND connamespace = 'public'::regnamespace ORDER BY conname`,
    );
    const uqNames = new Set(uqRows.map((r: { conname: string }) => r.conname));
    const expectedUQs = ['uq_site_code', 'uq_camera_external_id', 'uq_camera_site_code', 'uq_zone_site_code'];
    for (const uq of expectedUQs) {
      assert.ok(uqNames.has(uq), `Missing expected unique constraint: ${uq}`);
    }

    // 3. Check Constraints
    const chkRows = await source.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace ORDER BY conname`,
    );
    const chkNames = new Set(chkRows.map((r: { conname: string }) => r.conname));
    assert.ok(chkNames.has('chk_region_coordinate_space'), 'Missing chk_region_coordinate_space');
    assert.ok(chkNames.has('chk_region_version'), 'Missing chk_region_version');

    // 4. Foreign Keys with exact onDelete actions:
    // confdeltype: 'r' = RESTRICT, 'c' = CASCADE, 'n' = SET NULL, 'a' = NO ACTION
    const fkRows = await source.query(
      `SELECT conname, confdeltype FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
    const fkMap = new Map<string, string>(
      fkRows.map((r: { conname: string; confdeltype: string }) => [r.conname, r.confdeltype]),
    );

    const expectedFKs: Record<string, string> = {
      fk_camera_site: 'r', // RESTRICT
      fk_zone_site: 'r', // RESTRICT
      fk_region_camera: 'r', // RESTRICT
      fk_region_zone: 'r', // RESTRICT
      fk_event_resolved_camera: 'n', // SET NULL
      fk_alert_site: 'r', // RESTRICT
      fk_alert_zone: 'n', // SET NULL
      fk_mapping_alert: 'c', // CASCADE
      fk_mapping_event: 'c', // CASCADE
    };

    for (const [fkName, expectedDel] of Object.entries(expectedFKs)) {
      assert.ok(fkMap.has(fkName), `Missing expected foreign key constraint: ${fkName}`);
      assert.equal(
        fkMap.get(fkName),
        expectedDel,
        `FK ${fkName} expected confdeltype '${expectedDel}', got '${fkMap.get(fkName)}'`,
      );
    }
  });
});

test('foundation migration creates required performance indexes', async () => {
  await withDataSource(async (source) => {
    const indexRows = await source.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const indexNames = new Set(indexRows.map((r: { indexname: string }) => r.indexname));
    assert.ok(indexNames.has('idx_region_camera_active'), 'Missing idx_region_camera_active');
    assert.ok(indexNames.has('idx_event_camera_session_captured'), 'Missing idx_event_camera_session_captured');
    assert.ok(indexNames.has('idx_alert_grouping'), 'Missing idx_alert_grouping');
  });
});

test('zero metadata drift: createSchemaBuilder().log() produces 0 upQueries', async () => {
  await withDataSource(async (source) => {
    const schemaBuilder = source.driver.createSchemaBuilder();
    const { upQueries } = await schemaBuilder.log();
    if (upQueries.length > 0) {
      console.error(
        'Unexpected schema builder upQueries:',
        upQueries.map((q) => q.query),
      );
    }
    assert.equal(
      upQueries.length,
      0,
      `Expected zero schema drift, but found ${upQueries.length} up query(ies)`,
    );
  });
});

test('numeric runtime correctness: identity scores round-trip as finite numbers and parse back from string', async () => {
  await withDataSource(async (source) => {
    const siteRepo = source.getRepository(SiteEntity);
    const alertRepo = source.getRepository(SafetyAlertEntity);

    const siteId = '11111111-2222-3333-4444-555555555555';
    const alertId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    try {
      // 1. Insert parent site
      await siteRepo.save({
        id: siteId,
        code: 'NUMERIC-TEST-SITE',
        name: 'Numeric Test Site',
      });

      // 2. Insert alert with precise decimal scores
      const inserted = await alertRepo.save({
        id: alertId,
        siteId,
        zoneId: null,
        candidateWorkerId: 'worker-001',
        identitySimilarityScore: 0.95,
        identityQualityScore: 0.9876,
        alertType: AlertType.PPE_VIOLATION,
        candidateSubtype: 'NO_HARD_HAT',
        groupingKey: 'site:worker-001:ppe',
        status: AlertStatus.PENDING_REVIEW,
        firstDetectedAt: new Date('2026-09-19T00:00:00Z'),
        lastDetectedAt: new Date('2026-09-19T00:01:00Z'),
        detectionCount: 1,
      });

      assert.equal(typeof inserted.identitySimilarityScore, 'number');
      assert.equal(inserted.identitySimilarityScore, 0.95);

      // 3. Query back from database to verify pg driver string conversion to number
      const found = await alertRepo.findOneBy({ id: alertId });
      assert.ok(found);
      assert.equal(typeof found.identitySimilarityScore, 'number');
      assert.equal(found.identitySimilarityScore, 0.95);
      assert.equal(typeof found.identityQualityScore, 'number');
      assert.equal(found.identityQualityScore, 0.9876);
      assert.equal(found.candidateSubtype, 'NO_HARD_HAT');
    } finally {
      // Cleanup
      await alertRepo.delete({ id: alertId });
      await siteRepo.delete({ id: siteId });
    }
  });
});
