import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { ZoneType, ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { Mf06RequestContextReader } from '../../src/modules/safety/assessments/mf06-request-context.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { bindMf06FaceInvocation } from '../../src/modules/safety/assessments/mf06-face-binding.js';
import { Mf06CandidateMetadataService } from '../../src/modules/safety/assessments/mf06-candidate-metadata.service.js';
import type { Mf06AssessmentStoreResult } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { computeCanonicalPayloadHash, computeWorkerEventBindingHash } from '@smartsite/contracts';

test('worker bound HTTP admission preserves raw event and original execution context', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  let app: NestExpressApplication | undefined;
  try {
    await owned.initialize();
    const siteId = randomUUID(),
      cameraId = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Bound test site')", [
      siteId,
    ]);
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Bound test camera')",
      [cameraId, siteId],
    );
    const generation = await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 60000);
    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
      VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
      [cameraId, siteId, generation.streamSessionId],
    );
    await db.transaction(async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneByOrFail({ id: cameraId });
      await recordCameraConfigurationBundle(
        manager,
        camera,
        {
          schemaVersion: '1.0.0',
          configurationVersion: 1,
          cameraExternalId: cameraId,
          regions: [],
        },
        new ZoneConfigurationService(db, new SiteConfigurationService(db)),
      );
    });
    const [{ bundle_sha256: bundleSha256 }] = await db.query(
      'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1',
      [cameraId],
    );
    const ack = {
      commandId: randomUUID(),
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    };
    await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, ack);
    const config = createTestConfig({
      AI_WORKER_BOUND_EVENT_ENABLED: 'true',
      AI_PARTITIONED_FRAME_ENABLED: 'true',
      AI_CONFIGURATION_CAMERA_IDS: cameraId,
      SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-bound-token',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(createLoggerParams(config, { write: () => undefined }))
      .overrideProvider(getDataSourceToken())
      .useValue(db)
      .overrideProvider(DataSource)
      .useValue(db)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
      bodyParser: false,
    });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/v1/integrations/ai/worker-events`;
    const context = {
      schemaVersion: '1.0.0',
      cameraId,
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      receiptCommandId: ack.commandId,
      sourceKind: 'LIVE',
    };
    const event = {
      eventId: randomUUID(),
      schemaVersion: '1.0.0',
      cameraExternalId: cameraId,
      streamSessionId: generation.streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 120, height: 80 },
      observations: [
        {
          type: 'PERSON',
          trackId: 1,
          confidence: 0.9,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.7, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
      evidence: [],
    };
    const envelope = { schemaVersion: '1.0.0', context, event };
    const send = (body: unknown, secret = generation.secret, token = 'synthetic-bound-token') =>
      fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-worker-generation-secret': secret,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const count = async () =>
      Number((await db.query('SELECT count(*)::int AS n FROM ai_observation_event'))[0].n);
    await t.test('disabled bound intake cannot fall back to the legacy event route', async () => {
      config.set('AI_WORKER_BOUND_EVENT_ENABLED', false);
      try {
        assert.equal((await send(envelope)).status, 503);
      } finally {
        config.set('AI_WORKER_BOUND_EVENT_ENABLED', true);
      }
      assert.equal(await count(), 0);
    });
    await t.test('service and original generation credentials are both required', async () => {
      assert.equal((await send(envelope, generation.secret, 'wrong-service')).status, 401);
      assert.equal((await send(envelope, 'x'.repeat(43))).status, 401);
      assert.equal(await count(), 0);
    });
    await t.test('live admission stores context and original raw payload atomically', async () => {
      const response = await send(envelope);
      assert.equal(response.status, 202);
      const [row] = await db.query(
        'SELECT raw_payload,admission_context FROM ai_observation_event WHERE event_id=$1',
        [event.eventId],
      );
      assert.deepEqual(row.raw_payload, event);
      assert.deepEqual(row.admission_context.context, context);
      assert.equal(row.admission_context.classification, 'LIVE');
      assert(!JSON.stringify(row).includes(generation.secret));
      assert.equal((await send(envelope)).status, 202);
      assert.equal(await count(), 1);
    });
    await t.test('wrong scope, bundle or receipt cannot create a raw event', async () => {
      for (const changes of [
        { cameraId: randomUUID() },
        { workerGenerationId: randomUUID() },
        { bundleSha256: '0'.repeat(64) },
        { receiptCommandId: randomUUID() },
        { viewRevision: 2 },
        { sourceKind: 'REPLAY' },
      ]) {
        const result = await send({
          ...envelope,
          event: { ...event, eventId: randomUUID() },
          context: { ...context, ...changes },
        });
        assert(
          [401, 404, 409].includes(result.status),
          `Unexpected scoped rejection ${result.status}`,
        );
      }
      assert.equal(await count(), 1);
    });
    await t.test(
      'same event and new valid receipt is a context conflict, not duplicate',
      async () => {
        const commandId = randomUUID();
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, {
          ...ack,
          commandId,
        });
        assert.equal(
          (await send({ ...envelope, context: { ...context, receiptCommandId: commandId } }))
            .status,
          409,
        );
        assert.equal(await count(), 1);
      },
    );
    await t.test(
      'bound frame parts retain one execution context and cannot mix legacy delivery',
      async () => {
        const frameId = randomUUID();
        const first = {
          ...event,
          eventId: randomUUID(),
          schemaVersion: '1.4.0',
          framePartition: { frameId, sequenceNumber: '9', partIndex: 0, partCount: 2 },
        };
        const second = {
          ...first,
          eventId: randomUUID(),
          framePartition: { ...first.framePartition, partIndex: 1 },
        };
        assert.equal((await send({ ...envelope, event: first })).status, 202);
        const commandId = randomUUID();
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, {
          ...ack,
          commandId,
        });
        assert.equal(
          (
            await send({
              ...envelope,
              event: second,
              context: { ...context, receiptCommandId: commandId },
            })
          ).status,
          409,
        );
        config.set('AI_WORKER_BOUND_EVENT_ENABLED', false);
        let legacy: Response;
        try {
          legacy = await fetch(url.replace('/worker-events', '/events'), {
            method: 'POST',
            headers: {
              authorization: 'Bearer synthetic-bound-token',
              'content-type': 'application/json',
            },
            body: JSON.stringify(second),
          });
        } finally {
          config.set('AI_WORKER_BOUND_EVENT_ENABLED', true);
        }
        assert.equal(legacy.status, 409);
        assert.equal((await send({ ...envelope, event: second })).status, 202);
        assert.equal(await count(), 3);
      },
    );
    await t.test(
      'capture claims predating generation/bundle issuance remain review only',
      async () => {
        const impossible = {
          ...event,
          eventId: randomUUID(),
          capturedAt: new Date(Date.now() - 120000).toISOString(),
        };
        assert.equal((await send({ ...envelope, event: impossible })).status, 202);
        const [row] = await db.query(
          'SELECT admission_context FROM ai_observation_event WHERE event_id=$1',
          [impossible.eventId],
        );
        assert.equal(row.admission_context.classification, 'REVIEW_ONLY');
      },
    );
    await t.test(
      'a later REJECTED receipt prevents an old LOADED claim becoming fresh LIVE',
      async () => {
        await recordCameraConfigurationAcknowledgement(db, cameraId, generation.secret, {
          ...ack,
          commandId: randomUUID(),
          outcome: 'REJECTED',
        });
        const rejected = { ...event, eventId: randomUUID() };
        assert.equal((await send({ ...envelope, event: rejected })).status, 202);
        const [row] = await db.query(
          'SELECT admission_context FROM ai_observation_event WHERE event_id=$1',
          [rejected.eventId],
        );
        assert.equal(row.admission_context.classification, 'REVIEW_ONLY');
      },
    );
    await t.test(
      'superseded original claim is retained for review rather than fresh LIVE handling',
      async () => {
        await provisionCameraWorkerGeneration(db, cameraId, [cameraId], 60000);
        const delayed = { ...event, eventId: randomUUID() };
        assert.equal((await send({ ...envelope, event: delayed })).status, 202);
        const [row] = await db.query(
          'SELECT admission_context,processing_status FROM ai_observation_event WHERE event_id=$1',
          [delayed.eventId],
        );
        assert.equal(row.admission_context.classification, 'REVIEW_ONLY');
        assert.equal(row.processing_status, 'SKIPPED_NO_CANDIDATE');
        assert.equal(await count(), 6);
      },
    );
    await t.test(
      'revocation denies a new event without persisting or emitting alerts',
      async () => {
        await revokeCameraWorkerGeneration(db, cameraId, [cameraId], generation.workerGenerationId);
        const response = await send({ ...envelope, event: { ...event, eventId: randomUUID() } });
        assert([401, 409].includes(response.status));
        assert.equal(await count(), 6);
        assert.equal(
          Number((await db.query('SELECT count(*)::int AS n FROM safety_alert'))[0].n),
          0,
        );
      },
    );
    await t.test(
      'immutable PPE bundle drives scoped alerts despite current Zone drift; delayed claims only review',
      async () => {
        const ppeCamera = randomUUID(),
          regionId = randomUUID(),
          referenceId = randomUUID(),
          officer = randomUUID(),
          foreignOfficer = randomUUID(),
          foreignSite = randomUUID();
        await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Foreign site')", [
          foreignSite,
        ]);
        for (const [user, scope] of [
          [officer, siteId],
          [foreignOfficer, foreignSite],
        ]) {
          await db.query(
            "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Officer','synthetic-non-login-hash')",
            [user],
          );
          await db.query(
            "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
            [randomUUID(), user, scope],
          );
        }
        await db.query(
          "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'PPE bound camera')",
          [ppeCamera, siteId],
        );
        config.set('AI_CONFIGURATION_CAMERA_IDS', [cameraId, ppeCamera]);
        const issued = await provisionCameraWorkerGeneration(db, ppeCamera, [ppeCamera], 60000);
        await db.query(
          `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
        VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
          [ppeCamera, siteId, issued.streamSessionId],
        );
        const zones = new ZoneConfigurationService(db, new SiteConfigurationService(db));
        const zone = await zones.create(siteId, {
          name: 'Bound PPE required helmet',
          type: ZoneType.STANDARD,
          restrictionPolicy: ZoneRestrictionPolicy.NONE,
          requiredPpe: ['HARD_HAT'],
        });
        const polygon = {
          coordinates: [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
          ],
        } as const;
        await db.query(
          `WITH moment AS (SELECT clock_timestamp() AS at)
        INSERT INTO camera_configuration_reference(id,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,captured_at,issued_at,expires_at,issued_by_user_id)
        SELECT $1,$2,1,$3,$4,'LIVE',120,80,$5,1,at,at,at+INTERVAL '1 minute',$6 FROM moment`,
          [referenceId, ppeCamera, siteId, issued.streamSessionId, 'a'.repeat(64), officer],
        );
        await db.query(
          'INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon) VALUES($1,$2,$3,$4::jsonb)',
          [regionId, ppeCamera, zone.id, JSON.stringify(polygon)],
        );
        await db.query(
          `INSERT INTO camera_region_geometry_revision(region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline,reference_id,view_revision,confirmed_by_user_id,confirmed_at,recorded_at)
        VALUES($1,1,$2,$3,1,'NORMALIZED_0_1',$4::jsonb,true,false,$5,1,$6,clock_timestamp(),clock_timestamp())`,
          [regionId, ppeCamera, zone.id, JSON.stringify(polygon), referenceId, officer],
        );
        await db.transaction(async (manager) => {
          await zones.markLinked(manager, await zones.lockForRegion(manager, siteId, zone.id));
          const camera = await manager
            .getRepository(CameraEntity)
            .findOneByOrFail({ id: ppeCamera });
          await recordCameraConfigurationBundle(
            manager,
            camera,
            {
              schemaVersion: '1.0.0',
              cameraExternalId: ppeCamera,
              configurationVersion: 1,
              regions: [
                { regionId, geometryVersion: 1, coordinateSpace: 'NORMALIZED_0_1', polygon },
              ],
            },
            zones,
          );
        });
        const [{ bundle_sha256: hash }] = await db.query(
          'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1',
          [ppeCamera],
        );
        const loaded = {
          commandId: randomUUID(),
          workerGenerationId: issued.workerGenerationId,
          streamSessionId: issued.streamSessionId,
          configurationVersion: 1,
          bundleSha256: hash,
          viewRevision: 1,
          outcome: 'LOADED',
        };
        await recordCameraConfigurationAcknowledgement(db, ppeCamera, issued.secret, loaded);
        const ppeContext = {
          ...context,
          cameraId: ppeCamera,
          workerGenerationId: issued.workerGenerationId,
          streamSessionId: issued.streamSessionId,
          bundleSha256: hash,
          receiptCommandId: loaded.commandId,
        };
        const ppeEvent = {
          ...event,
          schemaVersion: '1.2.0',
          eventId: randomUUID(),
          cameraExternalId: ppeCamera,
          streamSessionId: issued.streamSessionId,
          capturedAt: new Date().toISOString(),
          observations: [
            ...event.observations,
            ...['HARD_HAT', 'SAFETY_VEST'].map((ppeItem) => ({
              type: 'PPE',
              trackId: 1,
              ppeItem,
              status: 'MISSING',
              regionId,
              geometryVersion: 1,
              confidence: 0.95,
            })),
          ],
          evidence: [
            { kind: 'FRAME', uri: 'local://synthetic/bound-ppe.jpg', sha256: 'a'.repeat(64) },
          ],
        };
        // Privileged corruption only inside this owned test schema: historical policy must not become BOOTS.
        await db.query('UPDATE zone SET required_ppe=$2 WHERE id=$1', [zone.id, ['BOOTS']]);
        const response = await send(
          { schemaVersion: '1.0.0', context: ppeContext, event: ppeEvent },
          issued.secret,
        );
        assert.equal(
          response.status,
          202,
          response.status === 202 ? '' : await response.clone().text(),
        );
        const result = await response.json();
        assert.equal(result.status, 'PROCESSED');
        assert.equal(result.alertIds.length, 1);
        const [alert] = await db.query(
          'SELECT candidate_subtype,site_id,zone_id,detection_count FROM safety_alert WHERE id=$1',
          [result.alertIds[0]],
        );
        assert.equal(alert.candidate_subtype, 'PPE_HARD_HAT_MISSING');
        assert.equal(alert.site_id, siteId);
        assert.equal(alert.zone_id, zone.id);
        assert.equal(Number(alert.detection_count), 1);
        const notices = await db.query(
          'SELECT recipient_user_id,site_id,content FROM user_notification WHERE request_id=$1',
          [result.alertIds[0]],
        );
        assert.deepEqual(
          notices.map((row: { recipient_user_id: string }) => row.recipient_user_id),
          [officer],
        );
        assert.equal(notices[0].site_id, siteId);
        assert.equal(notices[0].content.safetyAlert.cameraId, ppeCamera);
        const [mapping] = await db.query(
          'SELECT person_observation_index FROM alert_detection_mapping WHERE event_id=$1',
          [ppeEvent.eventId],
        );
        assert.equal(mapping.person_observation_index, 0);
        assert.equal(
          (
            await send(
              { schemaVersion: '1.0.0', context: ppeContext, event: ppeEvent },
              issued.secret,
            )
          ).status,
          202,
        );
        config.set('MF06_ENQUEUE_ENABLED', true);
        config.set('MF06_ENQUEUE_MAX_OUTSTANDING', 10);
        // Direct corruption inside this owned fixture: enqueue must use issued geometry, not the current Region.
        await db.query(
          'UPDATE camera_observation_region SET version=2,is_active=false WHERE id=$1',
          [regionId],
        );
        const episodeEvent = { ...ppeEvent, eventId: randomUUID() };
        const routeEpoch = randomUUID();
        config.set('SAFETY_EPISODE_PROJECTION_ENABLED', true);
        config.set('SAFETY_EPISODE_ROUTE_EPOCH', routeEpoch);
        try {
          const envelope = { schemaVersion: '1.0.0', context: ppeContext, event: episodeEvent };
          const projected = await send(envelope, issued.secret);
          assert.equal(
            projected.status,
            202,
            projected.status === 202 ? '' : await projected.clone().text(),
          );
          const result = await projected.json();
          assert.equal(result.status, 'PROCESSED');
          assert.equal(result.alertIds.length, 1);
          const [snapshot] = await db.query(
            `SELECT e.raw_payload,e.payload_hash,e.admission_context,e.safety_route_mode,e.safety_route_epoch,
             a.candidate_subtype,a.episode_id,p.content_revision
             FROM ai_observation_event e JOIN alert_detection_mapping m ON m.event_id=e.event_id
             JOIN safety_alert a ON a.id=m.alert_id JOIN safety_episode p ON p.id=a.episode_id
             WHERE e.event_id=$1`,
            [episodeEvent.eventId],
          );
          assert.equal(snapshot.candidate_subtype, 'PPE_HARD_HAT_MISSING');
          assert.equal(snapshot.safety_route_mode, 'EPISODE_EVENT_LOCAL');
          assert.equal(snapshot.safety_route_epoch, routeEpoch);
          assert.deepEqual(snapshot.raw_payload, episodeEvent);
          assert.deepEqual(snapshot.admission_context.context, ppeContext);
          assert.equal(snapshot.payload_hash, computeCanonicalPayloadHash(episodeEvent));
          assert.equal(
            snapshot.admission_context.bindingHash,
            computeWorkerEventBindingHash(
              snapshot.payload_hash,
              snapshot.admission_context.context,
            ),
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM user_notification WHERE request_id=$1',
                [result.alertIds[0]],
              )
            )[0].n,
            0,
          );
          const replay = await send(envelope, issued.secret);
          assert.equal(replay.status, 202);
          assert.equal((await replay.json()).status, 'DUPLICATE_ACCEPTED');
          const [after] = await db.query(
            'SELECT content_revision FROM safety_episode WHERE id=$1',
            [snapshot.episode_id],
          );
          assert.equal(after.content_revision, snapshot.content_revision);
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM alert_detection_mapping WHERE event_id=$1',
                [episodeEvent.eventId],
              )
            )[0].n,
            1,
          );
        } finally {
          config.set('SAFETY_EPISODE_PROJECTION_ENABLED', false);
          config.set('SAFETY_EPISODE_ROUTE_EPOCH', undefined);
        }
        const zoneEvent = {
          ...ppeEvent,
          eventId: randomUUID(),
          capturedAt: new Date().toISOString().replace('Z', '456Z'),
          observations: [
            ...event.observations,
            { type: 'ZONE_ENTRY', trackId: 1, regionId, geometryVersion: 1 },
          ],
        };
        zoneEvent.evidence = [
          {
            kind: 'FRAME',
            uri: `local://evidence/${issued.streamSessionId}/1/${zoneEvent.eventId}.jpg`,
            sha256: 'a'.repeat(64),
          },
        ];
        const zoneResponse = await send(
          { schemaVersion: '1.0.0', context: ppeContext, event: zoneEvent },
          issued.secret,
        );
        assert.equal(
          zoneResponse.status,
          202,
          zoneResponse.status === 202 ? '' : await zoneResponse.clone().text(),
        );
        const requests = await db.query(
          'SELECT request_id,zone_id,geometry_version FROM zone_entry_assessment_request WHERE event_id=$1',
          [zoneEvent.eventId],
        );
        assert.equal(requests.length, 1);
        assert.equal(requests[0].zone_id, zone.id);
        assert.equal(Number(requests[0].geometry_version), 1);
        const captured = await new Mf06RequestContextReader(db).load(
          siteId,
          requests[0].request_id,
        );
        assert.equal(captured.status, 'MATCHED');
        if (captured.status === 'MATCHED')
          assert.deepEqual(captured.request.executionAdmission?.context, ppeContext);
        if (captured.status !== 'MATCHED' || !captured.subject)
          throw new Error('Synthetic bound subject missing');
        // Synthetic crop bytes exercise mechanical preparation/finalization binding only, not image decoding or Face inference.
        const cropBytes = Buffer.from('Synthetic bound MF06 crop');
        const crop = {
          bytes: cropBytes,
          cropSha256: createHash('sha256').update(cropBytes).digest('hex'),
          frameSha256: 'a'.repeat(64),
          subject: captured.subject,
          rectangle: { left: 12, top: 8, width: 72, height: 64 },
          cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1' as const,
        };
        const prepared = bindMf06FaceInvocation(captured, crop, randomUUID(), 'synthetic-no-model');
        assert.equal(prepared.state, 'BOUND_UNATTESTED');
        if (prepared.state !== 'BOUND_UNATTESTED')
          throw new Error('Synthetic invocation unavailable');
        const faceResponse = {
          ...prepared.invocation,
          state: 'UNAVAILABLE',
          provenance: 'SYNTHETIC_TEST',
          reason: 'NO_MATCH',
        };
        const finalizer = new Mf06CandidateMetadataService(
          { findCurrentForSafety: async () => ({ state: 'UNAVAILABLE' }) },
          'SYNTHETIC_TEST',
        );
        const finalize = () =>
          db.transaction('SERIALIZABLE', (manager) =>
            finalizer.revalidate(
              manager,
              siteId,
              requests[0].request_id,
              prepared,
              crop,
              faceResponse,
            ),
          );
        assert.deepEqual(await finalize(), {
          state: 'UNAVAILABLE',
          reason: 'IDENTITY_UNAVAILABLE',
        });
        const originalAdmission = captured.request.executionAdmission!;
        const changedAdmission = {
          ...originalAdmission,
          admittedAt: new Date(Date.parse(originalAdmission.admittedAt) + 1).toISOString(),
        };
        await db.query(
          'UPDATE ai_observation_event SET admission_context=$2::jsonb WHERE event_id=$1',
          [zoneEvent.eventId, JSON.stringify(changedAdmission)],
        );
        try {
          assert.deepEqual(await finalize(), { state: 'UNAVAILABLE', reason: 'INVALID_BINDING' });
          assert.equal(
            (await new Mf06RequestContextReader(db).load(siteId, requests[0].request_id)).status,
            'UNAVAILABLE',
          );
          await db.query(
            'UPDATE ai_observation_event SET admission_context=NULL WHERE event_id=$1',
            [zoneEvent.eventId],
          );
          assert.equal(
            (await new Mf06RequestContextReader(db).load(siteId, requests[0].request_id)).status,
            'UNAVAILABLE',
          );
        } finally {
          await db.query(
            'UPDATE ai_observation_event SET admission_context=$2::jsonb WHERE event_id=$1',
            [zoneEvent.eventId, JSON.stringify(originalAdmission)],
          );
        }
        const lease = await new Mf06JobLeaseService(db, {
          leaseSeconds: 30,
          maxAttempts: 2,
          retryDelaySeconds: 1,
        }).claim();
        assert.ok(lease);
        assert.equal(lease.requestId, requests[0].request_id);
        const exactClaim = await new Mf06ClaimContextReader(db).readForClaim(lease);
        assert.equal(exactClaim.status, 'MATCHED');
        if (exactClaim.status !== 'MATCHED') throw Error('Exact authenticated claim missing');
        assert.equal(exactClaim.authorityCapturedAt, zoneEvent.capturedAt);
        assert.equal(exactClaim.request.capturedAt, new Date(zoneEvent.capturedAt).toISOString());
        // Synthetic qualification proves composition, not operational authority coverage.
        const { MAIN_AUTHORITY_SNAPSHOT_TABLES } =
          await import('../../src/modules/zones/main-authority-read-snapshot.js');
        const { MAIN_AUTHORITY_V2_SOURCES } =
          await import('../../src/common/configuration/main-team-authority-sources.js');
        const { sealMainAuthorityArchive, MAIN_AUTHORITY_ARCHIVE_FORMAT_V2 } =
          await import('../../src/modules/zones/main-authority-archive-codec.js');
        const { Mf06BoundPolicyAssessmentWorkPort } =
          await import('../../src/modules/safety/assessments/mf06-bound-policy-assessment-work.js');
        const { Mf06AssessmentWorker } =
          await import('../../src/modules/safety/assessments/mf06-assessment-worker.service.js');
        const { Mf06AssessmentStore } =
          await import('../../src/modules/safety/assessments/mf06-assessment-store.service.js');
        for (const table of MAIN_AUTHORITY_SNAPSHOT_TABLES)
          await db.query(
            `CREATE TABLE IF NOT EXISTS "${db.driver.schema}"."${table}" (id integer)`,
          );
        const at = exactClaim.authorityCapturedAt!;
        const baselineAt = new Date(Date.parse(at) - 1000).toISOString();
        const authorityContext = {
          siteId,
          zoneId: zone.id,
          workerId: null,
          capturedAt: at,
          purpose: captured.request.requestedPurpose,
        };
        const sealed = sealMainAuthorityArchive(
          {
            version: MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
            context: authorityContext,
            archivedAt: new Date().toISOString(),
            baseline: {
              epochId: randomUUID(),
              capturedAt: baselineAt,
              declaredWriterManifestHash: 'a'.repeat(64),
              sourceRegistryHash: 'b'.repeat(64),
              snapshotHash: 'c'.repeat(64),
            },
            sources: MAIN_AUTHORITY_V2_SOURCES.map(([sourceKind, tableName, fields]) => ({
              sourceKind,
              tableName,
              fields,
              rows:
                sourceKind === 'SITE'
                  ? [{ id: siteId, access_policy_version: 1 }]
                  : sourceKind === 'ZONE_POLICY'
                    ? [
                        {
                          id: zone.id,
                          site_id: siteId,
                          restriction_policy: zone.restrictionPolicy,
                          required_ppe: zone.requiredPpe,
                          configuration_locked: true,
                        },
                      ]
                    : [],
            })),
          },
          authorityContext,
        );
        assert.equal(sealed.status, 'VALID');
        if (sealed.status !== 'VALID') throw Error('Invalid synthetic policy archive');
        const qualified = {
          status: 'QUALIFIED' as const,
          archive: sealed.archive,
          epochId: sealed.archive.payload.baseline.epochId,
          epochState: 'READY' as const,
          activatedAt: baselineAt,
          gappedAt: null,
          closedAt: null,
          witnessConfirmedAt: at,
          manifestSha256: 'a'.repeat(64),
          releaseCommit: 'd'.repeat(40),
          sourceRegistryHash: 'b'.repeat(64),
          provenance: 'SYNTHETIC_TEST' as const,
          operationalAuthorityCoverageEstablished: false,
          syntheticCutoverMechanicsVerified: true,
          identityEstablished: false as const,
        };
        const store = new Mf06AssessmentStore(db);
        const work = new Mf06BoundPolicyAssessmentWorkPort(
          new Mf06ClaimContextReader(db),
          {
            prepareForEvent: async (context) => {
              assert.deepEqual(context, authorityContext);
              return qualified;
            },
            revalidate: async (manager, input, prepared) => {
              assert.equal(prepared, qualified);
              assert.equal(input.epochId, qualified.epochId);
              const [mode] = await manager.query('SHOW transaction_isolation');
              assert.equal(mode.transaction_isolation, 'serializable');
              return qualified;
            },
          },
          store,
          'test',
        );
        const leases = new Mf06JobLeaseService(db, {
          leaseSeconds: 30,
          maxAttempts: 2,
          retryDelaySeconds: 1,
        });
        const pending = await work.prepare(lease, new AbortController().signal);
        for (const admission of [changedAdmission, null]) {
          await db.query(
            'UPDATE ai_observation_event SET admission_context=$2::jsonb WHERE event_id=$1',
            [zoneEvent.eventId, admission === null ? null : JSON.stringify(admission)],
          );
          try {
            const refused: Mf06AssessmentStoreResult = await db.transaction(
              'SERIALIZABLE',
              (manager): Promise<Mf06AssessmentStoreResult> =>
                work.finalize(manager, lease, pending, new AbortController().signal),
            );
            assert.deepEqual(refused, { state: 'UNAVAILABLE', reason: 'INVALID_STORED_BINDING' });
            const counts: { n: number }[] = await db.query(
              'SELECT count(*)::int AS n FROM zone_entry_assessment WHERE request_id=$1',
              [lease.requestId],
            );
            assert.equal(counts[0]!.n, 0);
          } finally {
            await db.query(
              'UPDATE ai_observation_event SET admission_context=$2::jsonb WHERE event_id=$1',
              [zoneEvent.eventId, JSON.stringify(originalAdmission)],
            );
          }
        }
        assert.equal(await leases.retry(lease, 'DATABASE_UNAVAILABLE'), 'RETRY');
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const worker = new Mf06AssessmentWorker(db, leases, work, {
          enabled: true,
          resolverTimeoutMs: 10000,
          drainTimeoutMs: 10000,
          maxDatabaseAttempts: 2,
        });
        try {
          assert.equal(await worker.runOnce(), 'COMPLETED');
          assert.equal(await worker.runOnce(), 'IDLE');
          const recorded = await db.query(
            `SELECT a.outcome,a.reason_code,a.worker_id,a.profile_revision,
            a.provenance,a.authority_artifact_id,j.status FROM zone_entry_assessment a
            JOIN zone_entry_assessment_job j USING(request_id) WHERE a.request_id=$1`,
            [lease.requestId],
          );
          assert.equal(recorded.length, 1);
          assert.equal(recorded[0].outcome, 'ALLOWED');
          assert.equal(recorded[0].reason_code, 'POLICY_NONE');
          assert.equal(recorded[0].status, 'SUCCEEDED');
          assert.equal(recorded[0].worker_id, null);
          assert.equal(recorded[0].profile_revision, null);
          assert.equal(recorded[0].provenance, 'SYNTHETIC_TEST');
          assert.ok(recorded[0].authority_artifact_id);
          const [storedRaw] = await db.query(
            'SELECT raw_payload,payload_hash FROM ai_observation_event WHERE event_id=$1',
            [zoneEvent.eventId],
          );
          assert.deepEqual(storedRaw.raw_payload, zoneEvent);
          const { computeCanonicalPayloadHash } = await import('@smartsite/contracts');
          assert.equal(storedRaw.payload_hash, computeCanonicalPayloadHash(zoneEvent));
        } finally {
          await worker.drain();
        }
        assert.equal(
          (
            await send(
              { schemaVersion: '1.0.0', context: ppeContext, event: zoneEvent },
              issued.secret,
            )
          ).status,
          202,
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM zone_entry_assessment_request WHERE event_id=$1',
              [zoneEvent.eventId],
            )
          )[0].n,
          1,
        );
        await provisionCameraWorkerGeneration(db, ppeCamera, [ppeCamera], 60000);
        const delayedZone = { ...zoneEvent, eventId: randomUUID() };
        assert.equal(
          (
            await send(
              { schemaVersion: '1.0.0', context: ppeContext, event: delayedZone },
              issued.secret,
            )
          ).status,
          202,
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM zone_entry_assessment_request WHERE event_id=$1',
              [delayedZone.eventId],
            )
          )[0].n,
          0,
        );
        config.set('MF06_ENQUEUE_ENABLED', false);
        const delayed = {
          ...ppeEvent,
          eventId: randomUUID(),
          observations: ppeEvent.observations.map((row) => ({ ...row, trackId: 999 })),
        };
        const delayedResponse = await send(
          { schemaVersion: '1.0.0', context: ppeContext, event: delayed },
          issued.secret,
        );
        assert.equal(delayedResponse.status, 202);
        assert.deepEqual((await delayedResponse.json()).alertIds, []);
        const [raw] = await db.query(
          'SELECT raw_payload,admission_context FROM ai_observation_event WHERE event_id=$1',
          [delayed.eventId],
        );
        assert.deepEqual(raw.raw_payload, delayed);
        assert.equal(raw.admission_context.classification, 'REVIEW_ONLY');
        assert.equal(
          Number(
            (
              await db.query('SELECT count(*)::int AS n FROM safety_alert WHERE zone_id=$1', [
                zone.id,
              ])
            )[0].n,
          ),
          2, // One legacy and one episode finding above; the delayed event adds none.
        );
        assert.equal(
          Number(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM user_notification WHERE request_id=$1',
                [result.alertIds[0]],
              )
            )[0].n,
          ),
          1,
        );
        assert.equal(
          (
            await db.query('SELECT detection_count FROM safety_alert WHERE id=$1', [
              result.alertIds[0],
            ])
          )[0].detection_count,
          1,
        );
      },
    );
  } finally {
    if (app) await app.close();
    await owned.dispose();
  }
});
