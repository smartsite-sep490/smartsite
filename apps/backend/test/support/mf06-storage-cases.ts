import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import type { CanonicalMf06Requests1794096000000 } from '../../src/database/migrations/1794096000000-CanonicalMf06Requests.js';
export async function checkPopulated(
  source: DataSource,
  runner: QueryRunner,
  migration: CanonicalMf06Requests1794096000000,
  entities: typeof import('../../src/database/entities/index.js'),
) {
  const {
    SiteEntity,
    CameraEntity,
    ZoneEntity,
    AiObservationEventEntity,
    ZoneType,
    ZoneRestrictionPolicy,
    EventProcessingStatus,
  } = entities;
  const site = randomUUID(),
    camera = randomUUID(),
    zone = randomUUID(),
    event = randomUUID(),
    session = randomUUID(),
    region = randomUUID(),
    request = randomUUID();
  const at = new Date('2026-10-28T00:00:00.123Z'),
    hash = 'a'.repeat(64);
  await source
    .getRepository(SiteEntity)
    .insert({ id: site, code: site, name: 'Synthetic storage Site' });
  await source
    .getRepository(CameraEntity)
    .insert({
      id: camera,
      siteId: site,
      externalId: camera,
      code: camera,
      name: 'Synthetic storage Camera',
    });
  await source
    .getRepository(ZoneEntity)
    .insert({
      id: zone,
      siteId: site,
      code: zone,
      name: 'Synthetic storage Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    });
  const raw = {
    eventId: event,
    schemaVersion: '1.0.0',
    cameraExternalId: camera,
    streamSessionId: session,
    capturedAt: at.toISOString(),
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      { type: 'ZONE_ENTRY', trackId: 7, regionId: region, geometryVersion: 3 },
    ],
    evidence: [],
  };
  await source
    .getRepository(AiObservationEventEntity)
    .insert({
      eventId: event,
      payloadHash: hash,
      cameraExternalId: camera,
      resolvedCameraId: camera,
      streamSessionId: session,
      capturedAt: at,
      rawPayload: raw,
      processingStatus: EventProcessingStatus.PROCESSED,
      processingNote: null,
    });
  const sql = `INSERT INTO zone_entry_assessment_request(request_id,event_id,payload_hash,person_observation_index,zone_observation_index,subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash) VALUES($1,$2,$3,0,1,'BOUND',7,$4,$5::uuid,$5::uuid::text,$6,$7,$8,$9,$10,'INITIAL_OBSERVATION_ASSESSMENT',1,$11)`;
  const args = [request, event, hash, site, camera, session, region, 3, zone, at, 'b'.repeat(64)];
  const reject = async (fn: () => Promise<unknown>) =>
    assert.rejects(fn, (e: unknown) => e instanceof Error && 'code' in e && e.code === '23514');
  const tampered = [...args];
  tampered[7] = 4;
  await reject(() => source.query(sql, tampered));
  const anotherSite = randomUUID();
  await source
    .getRepository(SiteEntity)
    .insert({ id: anotherSite, code: anotherSite, name: 'Synthetic foreign Site' });
  const crossSite = [...args];
  crossSite[3] = anotherSite;
  await assert.rejects(
    () => source.query(sql, crossSite),
    (e: unknown) => e instanceof Error && 'code' in e && e.code === '23503',
  );
  await source.query(sql, args);
  await runner.startTransaction();
  try {
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    assert.match(name, /^isolated_test_[0-9a-f]{32}$/);
    const shadow = name + '_shadow';
    await runner.query(`CREATE SCHEMA "${shadow}"`);
    await runner.query(`CREATE TABLE "${shadow}".zone_entry_assessment_request(event_id uuid)`);
    await runner.query(`SET LOCAL search_path="${shadow}","${name}"`);
    await reject(() =>
      runner.query(`UPDATE "${name}".ai_observation_event SET payload_hash=$2 WHERE event_id=$1`, [
        event,
        'c'.repeat(64),
      ]),
    );
  } finally {
    await runner.rollbackTransaction();
  }
  await runner.startTransaction();
  try {
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    assert.match(name, /^isolated_test_[0-9a-f]{32}$/);
    await runner.query(
      'CREATE TEMP TABLE zone_entry_assessment_request(event_id uuid) ON COMMIT DROP',
    );
    await reject(() =>
      runner.query(`UPDATE "${name}".ai_observation_event SET payload_hash=$2 WHERE event_id=$1`, [
        event,
        'c'.repeat(64),
      ]),
    );
  } finally {
    await runner.rollbackTransaction();
  }
  await reject(() =>
    source.query(
      'UPDATE zone_entry_assessment_request SET request_revision=2 WHERE request_id=$1',
      [request],
    ),
  );
  await reject(() =>
    source.query('UPDATE ai_observation_event SET payload_hash=$2 WHERE event_id=$1', [
      event,
      'c'.repeat(64),
    ]),
  );
  await reject(() => source.query('TRUNCATE zone_entry_assessment_request CASCADE'));
  await source.query(
    "INSERT INTO zone_entry_assessment_job(request_id,status,attempt_count,head_revision,next_attempt_at,deadline_at) VALUES($1,'PENDING',0,1,statement_timestamp(),statement_timestamp()+interval '1 hour')",
    [request],
  );
  await reject(() =>
    source.query(
      "UPDATE zone_entry_assessment_job SET status='CLAIMED',head_revision=2 WHERE request_id=$1",
      [request],
    ),
  );
  await reject(() =>
    source.query('UPDATE zone_entry_assessment_job SET attempt_count=1 WHERE request_id=$1', [
      request,
    ]),
  );
  await source.query(
    'UPDATE zone_entry_assessment_job SET head_revision=2,attempt_count=1 WHERE request_id=$1',
    [request],
  );
  await reject(() => migration.down(runner));
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM zone_entry_assessment_request'))[0].n,
    1,
  );
  assert.equal(
    (
      await source.query(
        'SELECT head_revision FROM zone_entry_assessment_job WHERE request_id=$1',
        [request],
      )
    )[0].head_revision,
    2,
  );
  const flexible = sql.replace("0,1,'BOUND'", '$12,$14,$13');
  for (const [name, observations, status, index, zoneIndex] of [
    ['missing', [raw.observations[1]], 'PERSON_NOT_FOUND', null, 0],
    [
      'ambiguous',
      [raw.observations[0], raw.observations[0], raw.observations[1]],
      'AMBIGUOUS_PERSON_TRACK',
      null,
      2,
    ],
    [
      'box-unavailable',
      [{ type: 'PERSON', trackId: 7 }, raw.observations[1]],
      'PERSON_BOX_UNAVAILABLE',
      0,
      1,
    ],
  ] as const) {
    const nextEvent = randomUUID(),
      nextRequest = randomUUID();
    await source
      .getRepository(AiObservationEventEntity)
      .insert({
        eventId: nextEvent,
        payloadHash: hash,
        cameraExternalId: camera,
        resolvedCameraId: camera,
        streamSessionId: session,
        capturedAt: at,
        rawPayload: { ...raw, eventId: nextEvent, observations },
        processingStatus: EventProcessingStatus.PROCESSED,
        processingNote: null,
      });
    const next = [...args];
    next[0] = nextRequest;
    next[1] = nextEvent;
    await reject(() => source.query(flexible, [...next, 0, 'BOUND', zoneIndex]));
    await source.query(flexible, [...next, index, status, zoneIndex]);
    assert.equal(
      (
        await source.query(
          'SELECT subject_binding_status FROM zone_entry_assessment_request WHERE request_id=$1',
          [nextRequest],
        )
      )[0].subject_binding_status,
      status,
      name,
    );
  }
  console.log(
    'PASS populated binding/immutability/parent/truncate/lease/head/downgrade preservation',
  );
  console.log(
    'PASS cross-Site FK refusal and missing/ambiguous/box-unavailable PERSON states without invented BOUND',
  );
  console.log('PASS changed caller search_path cannot shadow canonical request parent protection');
}
