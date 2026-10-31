import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import {
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  AiObservationEventEntity,
} from '../../src/database/entities/index.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { SafetyEventRoutes1794873600000 } from '../../src/database/migrations/1794873600000-SafetyEventRoutes.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
import { SafetyEpisodeProjectionService } from '../../src/modules/safety/alerts/safety-episode-projection.service.js';
import type { AlertCandidate } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
before(() => owned.initialize());
after(() => owned.dispose());
const projection = new SafetyEpisodeProjectionService(db);

async function seedUngroupedEvent(
  manager: import('typeorm').EntityManager,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const source = await manager
    .getRepository(AiObservationEventEntity)
    .findOneByOrFail({ eventId: f.eventId });
  const eventId = randomUUID();
  const rawPayload = { ...f.input, eventId };
  await manager.getRepository(AiObservationEventEntity).insert({
    ...source,
    eventId,
    rawPayload,
    payloadHash: computeCanonicalPayloadHash(rawPayload),
  });
  return eventId;
}

async function fixture(configOverrides: Record<string, unknown> = {}) {
  const siteId = randomUUID(),
    cameraId = randomUUID(),
    zoneId = randomUUID(),
    regionId = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: siteId, code: siteId, name: 'Synthetic projection Site' });
  await db.getRepository(CameraEntity).insert({
    id: cameraId,
    siteId,
    externalId: cameraId,
    code: cameraId,
    name: 'Synthetic projection camera',
  });
  await db.getRepository(ZoneEntity).insert({
    id: zoneId,
    siteId,
    code: zoneId,
    name: 'Synthetic PPE Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  });
  await db.getRepository(CameraObservationRegionEntity).insert({
    id: regionId,
    cameraId,
    zoneId,
    version: 1,
    isActive: true,
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  });
  const config = createTestConfig(configOverrides);
  const notifier = new SchedulingNotificationService(db);
  const recordPpeAlert = notifier.recordPpeAlert.bind(notifier);
  let legacyNotificationCalls = 0;
  notifier.recordPpeAlert = async (...args) => {
    legacyNotificationCalls++;
    return recordPpeAlert(...args);
  };
  const grouping = new DurableGroupingService(config, notifier);
  const ingestion = new AiIngestionService(
    db,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    grouping,
    config,
    undefined,
    undefined,
    undefined,
    new SafetyEpisodeProjectionService(db),
  );
  const person = (trackId: number) => ({
    type: 'PERSON',
    trackId,
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
  });
  const missing = (trackId: number, ppeItem: string) => ({
    type: 'PPE',
    trackId,
    ppeItem,
    status: 'MISSING',
    regionId,
    geometryVersion: 1,
  });
  const eventId = randomUUID();
  const input = {
    schemaVersion: '1.0.0',
    eventId,
    cameraExternalId: cameraId,
    streamSessionId: randomUUID(),
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 640, height: 480 },
    evidence: [],
    observations: [
      person(7),
      missing(7, 'HARD_HAT'),
      missing(7, 'SAFETY_VEST'),
      person(8),
      missing(8, 'HARD_HAT'),
    ],
  };
  await ingestion.ingestEvent(input);
  const mappings: { id: string; person: number; subtype: string }[] = await db.query(
    `SELECT a.id,m.person_observation_index AS person,a.candidate_subtype AS subtype
    FROM alert_detection_mapping m JOIN safety_alert a ON a.id=m.alert_id WHERE m.event_id=$1 ORDER BY a.id`,
    [eventId],
  );
  assert.equal(mappings.length, 3);
  const first = mappings.filter((row) => row.person === 0).map((row) => row.id);
  const second = mappings.filter((row) => row.person === 3).map((row) => row.id);
  assert.equal(first.length, 2);
  assert.equal(second.length, 1);
  const alertState = await db.query(
    "SELECT to_jsonb(a)-'episode_id' AS body FROM safety_alert a WHERE site_id=$1 ORDER BY id",
    [siteId],
  );
  return {
    siteId,
    zoneId,
    eventId,
    first,
    second,
    alertState,
    ingestion,
    input,
    grouping,
    legacyNotificationCalls: () => legacyNotificationCalls,
  };
}

test('enabled episode ingestion fails closed when its module provider is unavailable', async () => {
  const f = await fixture();
  const ingestion = new AiIngestionService(
    db,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    f.grouping,
    createTestConfig({
      SAFETY_EPISODE_PROJECTION_ENABLED: 'true',
      SAFETY_EPISODE_ROUTE_EPOCH: randomUUID(),
    }),
  );
  const eventId = randomUUID();
  await assert.rejects(
    ingestion.ingestEvent({ ...f.input, eventId }),
    (error) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
  const [row] = await db.query(
    'SELECT count(*)::int AS count FROM ai_observation_event WHERE event_id=$1',
    [eventId],
  );
  assert.equal(row.count, 0);
});

test('configured ingestion persists one non-delivering episode route and retries cannot switch back to legacy', async () => {
  const epoch = randomUUID();
  const f = await fixture({
    SAFETY_EPISODE_PROJECTION_ENABLED: 'true',
    SAFETY_EPISODE_ROUTE_EPOCH: epoch,
  });
  const [count] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(count.count, 2);
  assert.equal(f.legacyNotificationCalls(), 0);
  const [route] = await db.query(
    'SELECT safety_route_mode,safety_route_epoch,raw_payload,payload_hash FROM ai_observation_event WHERE event_id=$1',
    [f.eventId],
  );
  assert.equal(route.safety_route_mode, 'EPISODE_EVENT_LOCAL');
  assert.equal(route.safety_route_epoch, epoch);
  assert.equal(route.payload_hash, computeCanonicalPayloadHash(f.input));
  assert.deepEqual(route.raw_payload, f.input);
  const legacy = new AiIngestionService(
    db,
    new ObservationContextResolverService(),
    new AlertCandidateEvaluator(),
    new DurableGroupingService(createTestConfig(), new SchedulingNotificationService(db)),
    createTestConfig(),
  );
  assert.equal((await legacy.ingestEvent(f.input)).status, 'DUPLICATE_ACCEPTED');
  const [after] = await db.query(
    'SELECT safety_route_mode,safety_route_epoch FROM ai_observation_event WHERE event_id=$1',
    [f.eventId],
  );
  assert.deepEqual(after, { safety_route_mode: 'EPISODE_EVENT_LOCAL', safety_route_epoch: epoch });
  const [recipients] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode_recipient WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(recipients.count, 0);
  await assert.rejects(
    db.transaction((manager) =>
      manager.query(
        "UPDATE ai_observation_event SET safety_route_mode='LEGACY' WHERE event_id=$1",
        [f.eventId],
      ),
    ),
    /route.*immutable/i,
  );
});

test('a chosen episode route rolls back on failure without invoking the legacy writer; mixed zone events stay legacy', async () => {
  const epoch = randomUUID();
  const f = await fixture({
    SAFETY_EPISODE_PROJECTION_ENABLED: 'true',
    SAFETY_EPISODE_ROUTE_EPOCH: epoch,
  });
  const oldEpisodeGroup = f.grouping.groupEpisodeCandidate.bind(f.grouping);
  const oldLegacyGroup = f.grouping.groupCandidate.bind(f.grouping);
  let legacyCalls = 0;
  f.grouping.groupCandidate = async (...args) => {
    legacyCalls++;
    return oldLegacyGroup(...args);
  };
  f.grouping.groupEpisodeCandidate = async () => {
    throw new Error('Synthetic episode persistence failure');
  };
  const failedId = randomUUID();
  await assert.rejects(
    f.ingestion.ingestEvent({ ...f.input, eventId: failedId }),
    (error) => error instanceof PublicHttpException && error.getStatus() === 503,
  );
  assert.equal(legacyCalls, 0);
  const [absent] = await db.query(
    'SELECT count(*)::int AS count FROM ai_observation_event WHERE event_id=$1',
    [failedId],
  );
  assert.equal(absent.count, 0);
  const [episodes] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(episodes.count, 2);
  f.grouping.groupEpisodeCandidate = oldEpisodeGroup;
  const ppe = f.input.observations.find((o) => o.type === 'PPE')!;
  const mixedId = randomUUID();
  await f.ingestion.ingestEvent({
    ...f.input,
    eventId: mixedId,
    observations: [
      ...f.input.observations,
      {
        type: 'ZONE_ENTRY',
        trackId: 7,
        regionId: (ppe as { regionId: string }).regionId,
        geometryVersion: 1,
      },
    ],
  });
  assert.ok(legacyCalls > 0);
  assert.ok(f.legacyNotificationCalls() > 0);
  const [route] = await db.query(
    'SELECT safety_route_mode,safety_route_epoch FROM ai_observation_event WHERE event_id=$1',
    [mixedId],
  );
  assert.deepEqual(route, { safety_route_mode: 'LEGACY', safety_route_epoch: epoch });
});

test('route migration preserves old raw bytes, rejects NULL pairing and refuses erasing explicit route history', async () => {
  const migrationOwned = createIsolatedTestDatabase();
  await migrationOwned.initialize();
  const migrationDb = migrationOwned.dataSource;
  const eventId = randomUUID();
  const migration = new SafetyEventRoutes1794873600000();
  try {
    await migrationDb.transaction(async (manager) => {
      await manager.query(
        "INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,stream_session_id,captured_at,raw_payload,processing_status) VALUES($1,$2,'synthetic-route',$3,now(),'{}','PROCESSED')",
        [eventId, 'a'.repeat(64), randomUUID()],
      );
      const runner = manager.queryRunner!;
      const [scope] = await manager.query('SELECT current_schema() AS schema');
      assert.equal(scope.schema, migrationDb.driver.schema);
      await manager.query('SET LOCAL search_path TO pg_catalog');
      await assert.rejects(migration.up(runner), /Invalid safety route schema/);
      await manager.query(`SET LOCAL search_path TO "${scope.schema.replaceAll('"', '""')}"`);
      const before = await manager.query(
        'SELECT event_id,payload_hash,raw_payload FROM ai_observation_event WHERE event_id=$1',
        [eventId],
      );
      await migration.down(runner);
      await migration.up(runner);
      assert.deepEqual(
        await manager.query(
          'SELECT event_id,payload_hash,raw_payload FROM ai_observation_event WHERE event_id=$1',
          [eventId],
        ),
        before,
      );
      const [legacy] = await manager.query(
        'SELECT safety_route_mode,safety_route_epoch FROM ai_observation_event WHERE event_id=$1',
        [eventId],
      );
      assert.deepEqual(legacy, { safety_route_mode: null, safety_route_epoch: null });
      // This deliberate direct SQL insertion checks metadata pairing, not AI admission.
      const source = await manager
        .getRepository(AiObservationEventEntity)
        .findOneByOrFail({ eventId });
      await manager.query('SAVEPOINT bad_pair');
      await assert.rejects(
        manager.getRepository(AiObservationEventEntity).insert({
          ...source,
          rawPayload: {},
          eventId: randomUUID(),
          safetyRouteMode: null,
          safetyRouteEpoch: randomUUID(),
        }),
        /chk_ai_event_safety_route_pair/,
      );
      await manager.query('ROLLBACK TO SAVEPOINT bad_pair');
      await manager.getRepository(AiObservationEventEntity).insert({
        ...source,
        rawPayload: {},
        eventId: randomUUID(),
        safetyRouteMode: 'LEGACY',
        safetyRouteEpoch: randomUUID(),
      });
      await assert.rejects(migration.down(runner), /route history must be preserved/);
    });
  } finally {
    await migrationOwned.dispose();
  }
});

test('one atomic producer groups two subjects, replays without revision growth and rolls back partial work', async () => {
  const f = await fixture();
  const notifications = new SchedulingNotificationService(db);
  notifications.recordPpeAlert = async () => assert.fail('Episode producer used legacy notifier');
  const grouping = new DurableGroupingService(createTestConfig(), notifications);
  const produce = (
    projection as unknown as {
      produceObservationFindings: (
        manager: import('typeorm').EntityManager,
        input: { siteId: string; eventId: string; candidates: AlertCandidate[] },
        grouping: DurableGroupingService,
      ) => Promise<{
        alertIds: string[];
        episodes: {
          episodeId: string;
          contentRevision: number;
          findingCount: number;
          deliveryAdmitted: false;
        }[];
      }>;
    }
  ).produceObservationFindings;
  assert.equal(typeof produce, 'function');
  const base: AlertCandidate = {
    alertType: 'PPE_VIOLATION',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    cameraId: f.input.cameraExternalId,
    streamSessionId: f.input.streamSessionId,
    zoneId: f.zoneId,
    trackId: 7,
    groupingKey: 'ignored-legacy-key',
    details: {},
  };
  const candidates = [
    { ...base, trackId: 8 },
    { ...base, candidateSubtype: 'PPE_SAFETY_VEST_MISSING' as const },
    base,
  ];
  const result = await db.transaction(async (manager) => {
    const eventId = await seedUngroupedEvent(manager, f);
    const input = { siteId: f.siteId, eventId, candidates };
    const first = await produce.call(projection, manager, input, grouping);
    assert.equal(first.alertIds.length, 3);
    assert.deepEqual(first.episodes.map((e) => e.findingCount).sort(), [1, 2]);
    assert.ok(first.episodes.every((e) => e.deliveryAdmitted === false));
    const replay = await produce.call(
      projection,
      manager,
      { ...input, candidates: [...candidates].reverse() },
      grouping,
    );
    assert.deepEqual([...replay.alertIds].sort(), [...first.alertIds].sort());
    assert.deepEqual(
      replay.episodes,
      first.episodes.map((e) => ({ ...e, materialChange: false })),
    );
    return { eventId, first };
  });
  const [maps] = await db.query(
    'SELECT count(*)::int AS count FROM alert_detection_mapping WHERE event_id=$1',
    [result.eventId],
  );
  assert.equal(maps.count, 3);
  const concurrent = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      db.transaction((manager) =>
        produce.call(
          projection,
          manager,
          {
            siteId: f.siteId,
            eventId: result.eventId,
            candidates: index % 2 ? [...candidates].reverse() : candidates,
          },
          grouping,
        ),
      ),
    ),
  );
  assert.ok(
    concurrent.every(
      (item) => JSON.stringify(item.episodes) === JSON.stringify(concurrent[0]!.episodes),
    ),
  );
  const [before] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  const invalid = [...candidates, { ...base, trackId: 8, zoneId: randomUUID() }];
  const [beforeAlerts] = await db.query(
    'SELECT count(*)::int AS count FROM safety_alert WHERE site_id=$1',
    [f.siteId],
  );
  let rolledBackEvent: string | undefined;
  await assert.rejects(
    db.transaction(async (manager) => {
      const eventId = await seedUngroupedEvent(manager, f);
      rolledBackEvent = eventId;
      await produce.call(
        projection,
        manager,
        { siteId: f.siteId, eventId, candidates: invalid },
        grouping,
      );
    }),
    /AI ingestion is temporarily unavailable/,
  );
  const [after] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(after.count, before.count);
  const [afterAlerts] = await db.query(
    'SELECT count(*)::int AS count FROM safety_alert WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(afterAlerts.count, beforeAlerts.count);
  const [rolledBack] = await db.query(
    'SELECT count(*)::int AS count FROM ai_observation_event WHERE event_id=$1',
    [rolledBackEvent],
  );
  assert.equal(rolledBack.count, 0);
  await assert.rejects(
    db.transaction(async (manager) => {
      const eventId = await seedUngroupedEvent(manager, f);
      await manager.query(
        "UPDATE ai_observation_event SET processing_status='SKIPPED_CLOCK_SKEW' WHERE event_id=$1",
        [eventId],
      );
      await produce.call(projection, manager, { siteId: f.siteId, eventId, candidates }, grouping);
    }),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
  await assert.rejects(
    db.transaction((manager) =>
      produce.call(
        projection,
        manager,
        {
          siteId: f.siteId,
          eventId: f.eventId,
          candidates,
        },
        grouping,
      ),
    ),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
});

test('episode finding grouping never reuses a legacy cooldown alert or emits its legacy notification', async () => {
  const f = await fixture();
  const foreign = await fixture();
  const notifications = new SchedulingNotificationService(db);
  notifications.recordPpeAlert = async () => assert.fail('Episode path invoked legacy notifier');
  const grouping = new DurableGroupingService(createTestConfig(), notifications);
  const group = grouping.groupEpisodeCandidate;
  assert.equal(typeof group, 'function');
  const candidate: AlertCandidate = {
    alertType: 'PPE_VIOLATION',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    cameraId: f.input.cameraExternalId,
    streamSessionId: f.input.streamSessionId,
    zoneId: f.zoneId,
    trackId: 7,
    groupingKey: 'caller-key-must-not-be-used',
    details: {},
  };
  const captured = new Date(f.input.capturedAt);
  const first = await db.transaction(async (manager) => {
    const episode = await projection.reserveObservation(manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 0,
    });
    const schema = manager.connection.driver.schema!;
    await manager.query('SET LOCAL search_path TO pg_catalog');
    const hat = await group.call(
      grouping,
      manager,
      f.siteId,
      candidate,
      captured,
      episode.episodeId,
    );
    await manager.query(`SET LOCAL search_path TO "${schema.replaceAll('"', '""')}"`);
    for (const invalid of [
      { ...candidate, zoneId: foreign.zoneId },
      { ...candidate, trackId: 8 },
      { ...candidate, streamSessionId: randomUUID() },
      { ...candidate, candidateWorkerId: randomUUID() },
      { ...candidate, identitySimilarityScore: 0.9 },
      { ...candidate, candidateSubtype: 'PPE_BOOTS_MISSING' as const },
    ])
      await assert.rejects(
        group.call(grouping, manager, f.siteId, invalid, captured, episode.episodeId),
        /AI ingestion is temporarily unavailable/,
      );
    const again = await group.call(
      grouping,
      manager,
      f.siteId,
      candidate,
      captured,
      episode.episodeId,
    );
    assert.equal(hat.id, again.id);
    assert.ok(!f.first.includes(hat.id));
    assert.notEqual(hat.groupingKey, candidate.groupingKey);
    const vest = await group.call(
      grouping,
      manager,
      f.siteId,
      {
        ...candidate,
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
      },
      captured,
      episode.episodeId,
    );
    assert.notEqual(hat.id, vest.id);
    for (const alert of [hat, vest])
      await manager.query(
        'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,0)',
        [alert.id, f.eventId],
      );
    const attached = await projection.attachObservation(manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 0,
      alertIds: [hat.id, vest.id],
    });
    assert.equal(attached.findingCount, 2);
    return { episode, hat };
  });
  const laterId = randomUUID();
  await f.ingestion.ingestEvent({ ...f.input, eventId: laterId });
  await db.transaction(async (manager) => {
    const episode = await projection.reserveObservation(manager, {
      siteId: f.siteId,
      eventId: laterId,
      personObservationIndex: 0,
    });
    const hat = await group.call(
      grouping,
      manager,
      f.siteId,
      candidate,
      captured,
      episode.episodeId,
    );
    assert.notEqual(hat.id, first.hat.id);
    await manager.query(
      'INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,0)',
      [hat.id, laterId],
    );
    await projection.attachObservation(manager, {
      siteId: f.siteId,
      eventId: laterId,
      personObservationIndex: 0,
      alertIds: [hat.id],
    });
  });
  assert.equal(candidate.groupingKey, 'caller-key-must-not-be-used');
});

test('legacy cooldown reuse cannot be attached to a second event-local episode', async () => {
  const f = await fixture();
  const initial = await db.transaction((manager) =>
    projection.attachObservation(manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 0,
      alertIds: f.first,
    }),
  );
  const laterId = randomUUID();
  await f.ingestion.ingestEvent({ ...f.input, eventId: laterId });
  const mappings: { alert_id: string; person_observation_index: number }[] = await db.query(
    'SELECT alert_id,person_observation_index FROM alert_detection_mapping WHERE event_id=$1',
    [laterId],
  );
  const reused = mappings
    .filter((row) => row.person_observation_index === 0)
    .map((row) => row.alert_id);
  assert.deepEqual([...reused].sort(), [...f.first].sort());
  await assert.rejects(
    db.transaction((manager) =>
      projection.attachObservation(manager, {
        siteId: f.siteId,
        eventId: laterId,
        personObservationIndex: 0,
        alertIds: reused,
      }),
    ),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
  const episodes: { id: string; event_id: string; content_revision: number }[] = await db.query(
    'SELECT id,event_id,content_revision FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.deepEqual(episodes, [{ id: initial.episodeId, event_id: f.eventId, content_revision: 1 }]);
  const links: { episode_id: string }[] = await db.query(
    'SELECT episode_id FROM safety_alert WHERE id=ANY($1::uuid[])',
    [f.first],
  );
  assert.ok(links.every((row) => row.episode_id === initial.episodeId));
});

test('the owning transaction can resolve an exact subject before findings without delivering or linking legacy alerts', async () => {
  const f = await fixture();
  const reserve = projection.reserveObservation;
  assert.equal(typeof reserve, 'function');
  await db.transaction(async (manager) => {
    const input = { siteId: f.siteId, eventId: f.eventId, personObservationIndex: 0 };
    const first = await reserve.call(projection, manager, input);
    const replay = await reserve.call(projection, manager, input);
    assert.equal(replay.episodeId, first.episodeId);
    assert.equal(first.contentRevision, 1);
    assert.equal(first.findingCount, 0);
    assert.equal(first.deliveryAdmitted, false);
    const other = await reserve.call(projection, manager, { ...input, personObservationIndex: 3 });
    assert.notEqual(other.episodeId, first.episodeId);
    const [links] = await manager.query(
      'SELECT count(*)::int AS count FROM safety_alert WHERE site_id=$1 AND episode_id IS NOT NULL',
      [f.siteId],
    );
    assert.equal(links.count, 0);
    const attached = await projection.attachObservation(manager, { ...input, alertIds: f.first });
    assert.equal(attached.episodeId, first.episodeId);
    assert.equal(attached.findingCount, 2);
    assert.equal(attached.contentRevision, 2);
    const replayAfter = await reserve.call(projection, manager, input);
    assert.equal(replayAfter.contentRevision, 2);
    const otherAttached = await projection.attachObservation(manager, {
      ...input,
      personObservationIndex: 3,
      alertIds: f.second,
    });
    assert.equal(otherAttached.episodeId, other.episodeId);
    assert.equal(otherAttached.findingCount, 1);
  });
  const [recipients] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode_recipient WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(recipients.count, 0);
  await assert.rejects(
    reserve.call(projection, db.manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 0,
    }),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
});

test('one exact person retains two independent PPE findings, and another person gets another episode', async () => {
  const f = await fixture();
  const first = await db.transaction((manager) =>
    projection.attachObservation(manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 0,
      alertIds: f.first,
    }),
  );
  assert.equal(first.contentRevision, 1);
  assert.equal(first.findingCount, 2);
  assert.equal(first.deliveryAdmitted, false);
  const second = await db.transaction((manager) =>
    projection.attachObservation(manager, {
      siteId: f.siteId,
      eventId: f.eventId,
      personObservationIndex: 3,
      alertIds: f.second,
    }),
  );
  assert.notEqual(first.episodeId, second.episodeId);
  const rows = await db.query(
    'SELECT id,status,grouping_key,episode_id FROM safety_alert WHERE site_id=$1 ORDER BY id',
    [f.siteId],
  );
  assert.equal(rows.length, 3);
  assert.equal(
    rows.filter((row: { episode_id: string }) => row.episode_id === first.episodeId).length,
    2,
  );
  assert.deepEqual(
    await db.query(
      "SELECT to_jsonb(a)-'episode_id' AS body FROM safety_alert a WHERE site_id=$1 ORDER BY id",
      [f.siteId],
    ),
    f.alertState,
  );
});

test('pre-finding reservation rejects wrong context and rolls back without a placeholder episode', async () => {
  const f = await fixture();
  for (const input of [
    { siteId: randomUUID(), eventId: f.eventId, personObservationIndex: 0 },
    { siteId: f.siteId, eventId: randomUUID(), personObservationIndex: 0 },
    { siteId: f.siteId, eventId: f.eventId, personObservationIndex: 1 },
    { siteId: f.siteId, eventId: f.eventId, personObservationIndex: 0, alertIds: [] },
  ]) {
    await assert.rejects(
      db.transaction((manager) => projection.reserveObservation(manager, input)),
      /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
    );
  }
  const rollback = new Error('Synthetic pre-finding caller rollback');
  await assert.rejects(
    db.transaction(async (manager) => {
      await projection.reserveObservation(manager, {
        siteId: f.siteId,
        eventId: f.eventId,
        personObservationIndex: 0,
      });
      throw rollback;
    }),
    (error) => error === rollback,
  );
  const [row] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(row.count, 0);
});

test('ten concurrent retries create one episode and do not increase its revision', async () => {
  const f = await fixture();
  const values = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.transaction((manager) =>
        projection.attachObservation(manager, {
          siteId: f.siteId,
          eventId: f.eventId,
          personObservationIndex: 0,
          alertIds: [...f.first, f.first[0]!],
        }),
      ),
    ),
  );
  assert.equal(new Set(values.map((value) => value.episodeId)).size, 1);
  assert.ok(values.every((value) => value.contentRevision === 1 && value.findingCount === 2));
});

test('late second finding advances content once; replay and duplicate input do not', async () => {
  const f = await fixture();
  const apply = (alertIds: string[]) =>
    db.transaction((manager) =>
      projection.attachObservation(manager, {
        siteId: f.siteId,
        eventId: f.eventId,
        personObservationIndex: 0,
        alertIds,
      }),
    );
  const initial = await apply([f.first[0]!]);
  const next = await apply(f.first);
  const replay = await apply([...f.first, f.first[0]!]);
  assert.equal(next.episodeId, initial.episodeId);
  assert.equal(next.contentRevision, 2);
  assert.equal(next.materialChange, true);
  assert.equal(replay.contentRevision, 2);
  assert.equal(replay.materialChange, false);
});

test('wrong person, wrong Site and caller rollback leave no partial episode or linkage', async () => {
  const f = await fixture();
  for (const scope of [
    { siteId: f.siteId, personObservationIndex: 3 },
    { siteId: randomUUID(), personObservationIndex: 0 },
  ])
    await assert.rejects(
      db.transaction((manager) =>
        projection.attachObservation(manager, { ...scope, eventId: f.eventId, alertIds: f.first }),
      ),
      /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
    );
  const rollback = new Error('Synthetic caller failure after projection');
  await assert.rejects(
    db.transaction(async (manager) => {
      await projection.attachObservation(manager, {
        siteId: f.siteId,
        eventId: f.eventId,
        personObservationIndex: 0,
        alertIds: f.first,
      });
      throw rollback;
    }),
    (error) => error === rollback,
  );
  const [row] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(row.count, 0);
  const [linked] = await db.query(
    'SELECT count(*)::int AS count FROM safety_alert WHERE site_id=$1 AND episode_id IS NOT NULL',
    [f.siteId],
  );
  assert.equal(linked.count, 0);
});

test('a sealed episode permits replay but does not silently collect an additional finding', async () => {
  const f = await fixture();
  const apply = (alertIds: string[]) =>
    db.transaction((manager) =>
      projection.attachObservation(manager, {
        siteId: f.siteId,
        eventId: f.eventId,
        personObservationIndex: 0,
        alertIds,
      }),
    );
  const first = await apply([f.first[0]!]);
  await db.query("UPDATE safety_episode SET collection_state='SEALED' WHERE id=$1", [
    first.episodeId,
  ]);
  await assert.rejects(apply(f.first), /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/);
  const replay = await apply([f.first[0]!]);
  assert.equal(replay.materialChange, false);
  assert.equal(replay.contentRevision, 1);
  assert.equal(replay.findingCount, 1);
});

test('missing person provenance and use outside an owning transaction are refused before projection', async () => {
  const f = await fixture();
  const input = {
    siteId: f.siteId,
    eventId: f.eventId,
    personObservationIndex: 0,
    alertIds: f.first,
  };
  await assert.rejects(
    projection.attachObservation(db.manager, input),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
  await db.query(
    'UPDATE alert_detection_mapping SET person_observation_index=NULL WHERE alert_id=$1 AND event_id=$2',
    [f.first[0], f.eventId],
  );
  await assert.rejects(
    db.transaction((manager) => projection.attachObservation(manager, input)),
    /SAFETY_EPISODE_PROJECTION_UNAVAILABLE/,
  );
  const [row] = await db.query(
    'SELECT count(*)::int AS count FROM safety_episode WHERE site_id=$1',
    [f.siteId],
  );
  assert.equal(row.count, 0);
});
