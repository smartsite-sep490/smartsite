import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import {
  AiObservationEventEntity,
  AlertStatus,
  AlertType,
  CameraStatus,
  EventProcessingStatus,
  SafetyAlertEntity,
  SiteEntity,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/index.js';
import { parseNormalizedCapturedAt } from '../../src/integrations/ai/ai-ingestion.service.js';
import dataSource from '../support/test-data-source.js';

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
    const expectedTables = [
      'ai_observation_event',
      'alert_detection_mapping',
      'camera',
      'camera_observation_region',
      'safety_alert',
      'site',
      'zone',
    ];
    const tables = (await source.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename`,
      [expectedTables],
    )) as { tablename: string }[];
    assert.deepEqual(
      tables.map(({ tablename }) => tablename),
      expectedTables,
    );

    // Compact catalog snapshot: table|column|PostgreSQL type|nullable|varchar length|numeric precision|numeric scale|default.
    // This is independent of TypeORM metadata, so an entity and migration changing together cannot hide a spec regression.
    const expectedColumns = `
ai_observation_event|event_id|uuid|NO||||
ai_observation_event|payload_hash|bpchar|NO|64|||
ai_observation_event|camera_external_id|varchar|NO|128|||
ai_observation_event|resolved_camera_id|uuid|YES||||
ai_observation_event|stream_session_id|uuid|NO||||
ai_observation_event|captured_at|timestamptz|NO||||
ai_observation_event|received_at|timestamptz|NO||||now()
ai_observation_event|raw_payload|jsonb|NO||||
ai_observation_event|processing_status|event_processing_status|NO||||
ai_observation_event|processing_note|text|YES||||
ai_observation_event|created_at|timestamptz|NO||||now()
alert_detection_mapping|alert_id|uuid|NO||||
alert_detection_mapping|event_id|uuid|NO||||
alert_detection_mapping|created_at|timestamptz|NO||||now()
camera|id|uuid|NO||||
camera|site_id|uuid|NO||||
camera|external_id|varchar|NO|128|||
camera|code|varchar|NO|64|||
camera|name|varchar|NO|255|||
camera|status|camera_status|NO||||'ACTIVE'::camera_status
camera|created_at|timestamptz|NO||||now()
camera|configuration_version|int8|NO||64|0|1
camera_observation_region|id|uuid|NO||||
camera_observation_region|camera_id|uuid|NO||||
camera_observation_region|zone_id|uuid|NO||||
camera_observation_region|polygon|jsonb|NO||||
camera_observation_region|coordinate_space|varchar|NO|32|||'NORMALIZED_0_1'::character varying
camera_observation_region|version|int4|NO||32|0|1
camera_observation_region|is_active|bool|NO||||true
camera_observation_region|created_at|timestamptz|NO||||now()
safety_alert|id|uuid|NO||||
safety_alert|site_id|uuid|NO||||
safety_alert|zone_id|uuid|YES||||
safety_alert|candidate_worker_id|varchar|YES|128|||
safety_alert|identity_similarity_score|numeric|YES||5|4|
safety_alert|identity_quality_score|numeric|YES||5|4|
safety_alert|alert_type|alert_type|NO||||
safety_alert|candidate_subtype|varchar|NO|64|||
safety_alert|grouping_key|varchar|NO|255|||
safety_alert|status|alert_status|NO||||'PENDING_REVIEW'::alert_status
safety_alert|first_detected_at|timestamptz|NO||||
safety_alert|last_detected_at|timestamptz|NO||||
safety_alert|detection_count|int4|NO||32|0|1
safety_alert|created_at|timestamptz|NO||||now()
site|id|uuid|NO||||
site|code|varchar|NO|64|||
site|name|varchar|NO|255|||
site|created_at|timestamptz|NO||||now()
zone|id|uuid|NO||||
zone|site_id|uuid|NO||||
zone|code|varchar|NO|64|||
zone|name|varchar|NO|255|||
zone|type|zone_type|NO||||
zone|restriction_policy|zone_restriction_policy|NO||||
zone|required_ppe|_text|NO||||'{}'::text[]
zone|created_at|timestamptz|NO||||now()
zone|configuration_locked|bool|NO||||false
`
      .trim()
      .split('\n');

    const actualColumns = (await source.query(
      `SELECT table_name, column_name, udt_name, is_nullable,
              character_maximum_length, numeric_precision, numeric_scale, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1)
       ORDER BY table_name, ordinal_position`,
      [expectedTables],
    )) as Record<string, string | number | null>[];
    assert.deepEqual(
      actualColumns.map((column) =>
        [
          column.table_name,
          column.column_name,
          column.udt_name,
          column.is_nullable,
          column.character_maximum_length,
          column.numeric_precision,
          column.numeric_scale,
          column.column_default,
        ]
          .map((value) => value ?? '')
          .join('|'),
      ),
      expectedColumns,
    );
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
    const expectedUQs = [
      'uq_site_code',
      'uq_camera_external_id',
      'uq_camera_site_code',
      'uq_zone_site_code',
    ];
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
    assert.ok(
      chkNames.has('chk_camera_configuration_version'),
      'Missing chk_camera_configuration_version',
    );

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
    assert.ok(
      indexNames.has('idx_event_camera_session_captured'),
      'Missing idx_event_camera_session_captured',
    );
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
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
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
      assert.equal(found.candidateSubtype, 'PPE_HARD_HAT_MISSING');
    } finally {
      // Cleanup
      await alertRepo.delete({ id: alertId });
      await siteRepo.delete({ id: siteId });
    }
  });
});

test('ai_observation_event persists normalized leap-second Date and exact raw payload in PostgreSQL', async () => {
  await withDataSource(async (source) => {
    const eventRepo = source.getRepository(AiObservationEventEntity);
    const eventId = randomUUID();
    const leapSecondStr = '2026-12-31T23:59:60Z';
    const normalizedDate = parseNormalizedCapturedAt(leapSecondStr);
    assert.ok(normalizedDate);

    try {
      const rawPayload = {
        eventId,
        schemaVersion: '1.0.0',
        capturedAt: leapSecondStr,
        cameraExternalId: 'CAM-LEAP',
      };

      await eventRepo.insert({
        eventId,
        payloadHash: 'a'.repeat(64),
        cameraExternalId: 'CAM-LEAP',
        resolvedCameraId: null,
        streamSessionId: randomUUID(),
        capturedAt: normalizedDate,
        rawPayload,
        processingStatus: EventProcessingStatus.SKIPPED_CLOCK_SKEW,
        processingNote: 'Leap second event test',
      });

      const found = await eventRepo.findOneBy({ eventId });
      assert.ok(found);
      assert.ok(found.capturedAt instanceof Date);
      assert.ok(Number.isFinite(found.capturedAt.getTime()));
      assert.equal(found.capturedAt.toISOString(), '2026-12-31T23:59:59.000Z');
      assert.equal(
        (found.rawPayload as Record<string, unknown>)['capturedAt'],
        '2026-12-31T23:59:60Z',
      );
    } finally {
      await eventRepo.delete({ eventId });
    }
  });
});
