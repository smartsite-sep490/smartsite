import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPendingRecoveryIndex1795046400004 } from '../../src/database/migrations/1795046400004-TrackedPendingRecoveryIndex.js';
import { TrackedWireGenerationFence1795046400008 } from '../../src/database/migrations/1795046400008-TrackedWireGenerationFence.js';
import { createTestConfig } from '../support/config.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { TrackedFrameRecovery } from '../../src/integrations/ai/tracked-frame-recovery.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';

for (const variant of [
  'ppe-only',
  'ppe-c02',
  'camera-v17',
  'camera-upload-v17',
  'region-v17',
  'camera-region-mismatch-v17',
  'region-disabled-v17',
  'region-stale-v17',
  'zone-uppercase',
  'zone-uppercase-v17',
  'zone-unissued',
  'zone-disabled',
] as const)
  test(`registered tracked worker HTTP intake preserves ${variant} handling`, async () => {
    const wire17 = variant.endsWith('-v17');
    const uppercaseZone = variant === 'zone-uppercase' || variant === 'zone-uppercase-v17';
    const cameraScope =
      variant === 'camera-v17' ||
      variant === 'camera-upload-v17' ||
      variant === 'camera-region-mismatch-v17';
    const invalidScope = variant === 'camera-region-mismatch-v17' || variant === 'region-stale-v17';
    const withC02 = variant === 'ppe-c02' || wire17;
    const findingCount = variant === 'region-v17' ? 1 : 2;
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let app: NestExpressApplication | undefined;
    const saved = new Map<string, string | undefined>();
    try {
      await owned.initialize();
      if (withC02) {
        const cli = new DataSource(
          buildMigrationOptions(
            { DATABASE_URL: resolveTestDatabaseUrl() },
            {
              profile: wire17 ? 'tracked-v17-identification-ppe' : 'tracked-v16-identification',
              schema: db.driver.schema!,
            },
          ),
        );
        try {
          await cli.initialize();
          await cli.runMigrations();
        } finally {
          if (cli.isInitialized) await cli.destroy();
        }
      } else
        await db.transaction(async (manager) => {
          for (const migration of [
            new WorkerEventAdmission1795046400002(),
            new TrackedSubjectStorage1795046400003(),
            new TrackedPendingRecoveryIndex1795046400004(),
            new TrackedWireGenerationFence1795046400008(),
          ])
            await migration.up(manager.queryRunner!);
        });
      const fixture = await seedTrackedFrameFixture(
        db,
        variant === 'camera-v17' ? [] : ['HARD_HAT', 'SAFETY_VEST'],
      );
      const routeEpoch = randomUUID();
      await db.query(
        "UPDATE camera_worker_generation SET observation_route_mode='EPISODE_TRACKED',tracking_route_epoch=$2,tracked_wire_version=$3 WHERE id=$1",
        [fixture.generation.workerGenerationId, routeEpoch, wire17 ? '1.7.0' : '1.6.0'],
      );
      const officer = randomUUID();
      const password = 'Synthetic_tracked_officer_123';
      const passwordHash = await hashPassword(password);
      const managerId = randomUUID();
      const evidenceRoot = await mkdtemp(join(tmpdir(), 'tracked-http-evidence-'));
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic officer',$2)",
        [officer, passwordHash],
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
        [randomUUID(), officer, fixture.siteId],
      );
      if (withC02) {
        await db.query(
          "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic manager',$2)",
          [managerId, passwordHash],
        );
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
          [randomUUID(), managerId, fixture.siteId],
        );
      }
      const token = randomUUID() + randomUUID();
      const env = {
        NODE_ENV: 'test',
        EVIDENCE_LOCAL_ROOT: evidenceRoot,
        STORAGE_LOCAL_ROOT: evidenceRoot,
        SAFETY_IDENTIFICATION_ENABLED: withC02 ? 'true' : 'false',
        SMARTSITE_AI_SERVICE_TOKEN: token,
        AI_CONFIGURATION_CAMERA_IDS: fixture.cameraId,
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: db.driver.schema!,
        SMARTSITE_DB_MIGRATION_PROFILE: wire17
          ? 'tracked-v17-identification-ppe'
          : withC02
            ? 'tracked-v16-identification'
            : 'tracked-v16',
        AI_TRACKED_FRAME_RUNTIME_ENABLED: 'true',
        AI_EVIDENCE_OBJECT_STORAGE_ENABLED:
          variant === 'camera-v17' || variant === 'camera-upload-v17' ? 'true' : 'false',
        MF06_ENQUEUE_ENABLED: uppercaseZone || variant === 'zone-unissued' ? 'true' : 'false',
        ...(uppercaseZone || variant === 'zone-unissued'
          ? { MF06_ENQUEUE_MAX_OUTSTANDING: '8' }
          : {}),
        AI_TRACKED_FRAME_RUNTIME_POLICY: JSON.stringify({
          profile: {
            wireVersion: wire17 ? '1.7.0' : '1.6.0',
            routeEpoch,
            profileSha256: 'a'.repeat(64),
            allowedCameraIds: [fixture.cameraId],
            clockToleranceMs: 5000,
          },
          pending: {
            pendingTtlMs: 30000,
            maxPendingFrames: 8,
            maxPendingParts: 16,
            maxPendingPayloadBytes: 100000,
          },
          heads: {
            firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
            maxCaptureGapMs: 10000,
            maxSourceSequenceGap: '1',
            maxSegmentRows: 32,
          },
          recovery: { intervalMs: 50, maxFramesPerCamera: 8 },
          maxRecipients: 8,
        }),
      };
      for (const [key, value] of Object.entries(env)) {
        saved.set(key, process.env[key]);
        process.env[key] = value;
      }
      const { AppModule } = await import(
        new URL('../../src/app.module.js?' + variant, import.meta.url).href
      );
      const config = createTestConfig(env);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue(createLoggerParams(config, { write: () => undefined }))

        .compile();
      const runtimeDb = module.get(DataSource);
      assert.notEqual(runtimeDb, db);
      assert.equal(runtimeDb.driver.schema, db.driver.schema);
      assert.deepEqual(await runtimeDb.query('SELECT current_schema() AS schema'), [
        { schema: db.driver.schema },
      ]);
      app = module.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
        bodyParser: false,
      });
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const prefix = (await app.getUrl()) + '/api/v1/integrations/ai';
      if (wire17) {
        const manager = await module
          .get(AuthService)
          .login(managerId, password, AuthClientType.WEB);
        const activeRegions = await runtimeDb.query<Array<{ id: string }>>(
          'SELECT id FROM camera_observation_region WHERE camera_id=$1 AND is_active=true',
          [fixture.cameraId],
        );
        const initialized = await fetch(
          (await app.getUrl()) +
            '/api/v1/sites/' +
            fixture.siteId +
            '/cameras/' +
            fixture.cameraId +
            '/ppe-policy/initialize',
          {
            method: 'POST',
            headers: {
              authorization: 'Bearer ' + manager.accessToken,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              commandId: randomUUID(),
              expectedConfigurationVersion: 1,
              policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
              regionPolicies: activeRegions.map(({ id }) => ({
                regionId: id,
                policy:
                  variant === 'region-disabled-v17'
                    ? { mode: 'DISABLED', reason: 'Synthetic disabled region' }
                    : variant === 'region-v17'
                      ? { mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST'] }
                      : { mode: 'INHERIT' },
              })),
            }),
          },
        );
        assert.equal(initialized.status, 201, await initialized.clone().text());
        const [{ bundle_sha256: bundleSha256 }] = await runtimeDb.query(
          'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=2',
          [fixture.cameraId],
        );
        const receiptCommandId = randomUUID();
        await recordCameraConfigurationAcknowledgement(
          runtimeDb,
          fixture.cameraId,
          fixture.generation.secret,
          {
            commandId: receiptCommandId,
            workerGenerationId: fixture.generation.workerGenerationId,
            streamSessionId: fixture.generation.streamSessionId,
            configurationVersion: 2,
            bundleSha256,
            viewRevision: 1,
            outcome: 'LOADED',
          },
        );
        Object.assign(fixture.context, { configurationVersion: 2, bundleSha256, receiptCommandId });
      }
      const base = fixture.event();
      const rectangles = Array.from({ length: 10 }, (_, i) => ({
        input: Buffer.from(
          `<svg width="12" height="20"><rect width="12" height="20" fill="${i === 1 ? '#00ff00' : '#ff0000'}"/></svg>`,
        ),
        left: 15 + 18 * (i % 5),
        top: i < 5 ? 10 : 44,
      }));
      const bytes = await sharp({
        create: { width: 120, height: 80, channels: 3, background: '#456789' },
      })
        .composite(withC02 ? rectangles : [])
        .jpeg()
        .toBuffer();
      const digest = createHash('sha256').update(bytes).digest('hex');
      // The upload-enabled journey must succeed without a legacy local worker file.
      if (variant !== 'camera-v17' && variant !== 'camera-upload-v17')
        await writeFile(
          join(evidenceRoot, base.streamSessionId + '_0_' + base.eventId + '.jpg'),
          bytes,
          { flag: 'wx' },
        );
      const event = {
        ...base,
        schemaVersion: wire17 ? '1.7.0' : '1.6.0',
        evidence: [
          {
            kind: 'FRAME',
            uri: 'local://evidence/' + base.streamSessionId + '/0/' + base.eventId + '.jpg',
            sha256: digest,
          },
        ],
        observations: [
          {
            type: 'PERSON',
            trackId: 1,
            ...(variant !== 'ppe-only'
              ? {
                  boundingBox: {
                    coordinateSpace: 'NORMALIZED_0_1',
                    x1: 0.2,
                    y1: 0.2,
                    x2: 0.6,
                    y2: 0.8,
                  },
                }
              : {}),
          },
          ...['HARD_HAT', 'SAFETY_VEST'].map((ppeItem) => ({
            type: 'PPE',
            trackId: 1,
            ppeItem,
            status: 'MISSING',
            regionId: fixture.ppeRegionId,
            geometryVersion: 1,
          })),
          ...(variant.startsWith('zone-')
            ? [
                {
                  type: 'ZONE_ENTRY',
                  trackId: 1,
                  regionId:
                    variant === 'zone-unissued'
                      ? randomUUID()
                      : uppercaseZone
                        ? fixture.ppeRegionId!.toUpperCase()
                        : fixture.ppeRegionId!,
                  geometryVersion: 1,
                  entryOrigin: 'INSIDE_ENTRY_UNOBSERVED',
                },
              ]
            : []),
        ],
        continuity: {
          ...base.continuity,
          subjects: [
            {
              personObservationIndex: 0,
              segmentId: randomUUID(),
              link: { kind: 'START', reason: 'INITIAL' },
            },
          ],
        },
      };
      if (withC02) {
        event.observations = Array.from({ length: 10 }, (_, i) => [
          {
            type: 'PERSON',
            trackId: i + 1,
            boundingBox: {
              coordinateSpace: 'NORMALIZED_0_1',
              x1: 0.125 + 0.15 * (i % 5),
              y1: i < 5 ? 0.125 : 0.55,
              x2: 0.225 + 0.15 * (i % 5),
              y2: i < 5 ? 0.375 : 0.8,
            },
          },
          ...(i < 3
            ? ['HARD_HAT', 'SAFETY_VEST'].map((ppeItem) => ({
                type: 'PPE',
                trackId: i + 1,
                ppeItem,
                status: 'MISSING',
                ...(cameraScope
                  ? { scope: 'CAMERA' }
                  : {
                      regionId:
                        variant === 'region-v17'
                          ? fixture.ppeRegionId!.toUpperCase()
                          : fixture.ppeRegionId,
                      geometryVersion: variant === 'region-stale-v17' ? 2 : 1,
                    }),
              }))
            : []),
        ]).flat();
        if (uppercaseZone) {
          event.observations.push({
            type: 'ZONE_ENTRY',
            trackId: 1,
            regionId: fixture.ppeRegionId!.toUpperCase(),
            geometryVersion: 1,
            entryOrigin: 'INSIDE_ENTRY_UNOBSERVED',
          });
        }
        event.continuity.subjects = event.observations.flatMap((observation, index) =>
          observation.type === 'PERSON'
            ? [
                {
                  personObservationIndex: index,
                  segmentId: randomUUID(),
                  link: { kind: 'START', reason: 'INITIAL' },
                },
              ]
            : [],
        );
      }
      const headers = {
        authorization: 'Bearer ' + token,
        'x-worker-generation-secret': fixture.generation.secret,
        'content-type': 'application/json',
      };
      const makeEvidenceForm = () => {
        const form = new FormData();
        form.append('schemaVersion', '1.0.0');
        form.append('event', JSON.stringify(event));
        form.append('context', JSON.stringify(fixture.context));
        form.append(
          'frame',
          new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
          'frame.jpg',
        );
        return form;
      };
      const uploadEvidence = () =>
        fetch(prefix + '/tracked-parts/evidence', {
          method: 'POST',
          headers: {
            authorization: headers.authorization,
            'x-worker-generation-secret': headers['x-worker-generation-secret'],
          },
          body: makeEvidenceForm(),
        });
      if (variant === 'camera-v17' || variant === 'camera-upload-v17') {
        const uploaded = await uploadEvidence();
        assert.equal(uploaded.status, 200, await uploaded.clone().text());
        const stored = await uploaded.json();
        assert.equal(stored.kind, 'EVIDENCE_STORED');
        assert.equal(stored.eventId, event.eventId);
        assert.equal(stored.sha256, digest);
        assert.deepEqual(
          await readFile(
            join(evidenceRoot, `ai-frame-${event.eventId}-${stored.payloadHash}-${digest}.jpg`),
          ),
          bytes,
        );
        assert.deepEqual(
          await runtimeDb.query(
            'SELECT count(*)::int AS count FROM ai_observation_event WHERE event_id=$1',
            [event.eventId],
          ),
          [{ count: 0 }],
        );
      }
      if (variant === 'camera-upload-v17') {
        const storage = module.get(StorageService);
        const originalSave = storage.saveAiFrame.bind(storage);
        let savedDuringTransition = false;
        storage.saveAiFrame = async (content, expectedHash, scope) => {
          await originalSave(content, expectedHash, scope);
          savedDuringTransition = true;
          await provisionCameraWorkerGeneration(
            runtimeDb,
            fixture.cameraId,
            [fixture.cameraId],
            120000,
          );
        };
        try {
          const stale = await uploadEvidence();
          assert.equal(stale.status, 409, await stale.clone().text());
          assert.equal((await stale.json()).code, 'CONFLICT');
          assert.equal(savedDuringTransition, true, 'must reach storage before generation changes');
        } finally {
          storage.saveAiFrame = originalSave;
        }
        return;
      }
      const post = () =>
        fetch(prefix + '/tracked-parts', {
          method: 'POST',
          headers,
          body: JSON.stringify({ schemaVersion: '1.0.0', event, context: fixture.context }),
        });
      const first = await post();
      assert.equal(first.status, 200, await first.clone().text());
      const receipt = await first.json();
      assert.equal(receipt.kind, 'RAW_STORED');
      const resultPath =
        prefix +
        '/cameras/' +
        fixture.cameraId +
        '/generations/' +
        fixture.generation.workerGenerationId +
        '/sessions/' +
        fixture.generation.streamSessionId +
        '/tracked-frames/' +
        event.framePartition.frameId +
        '/result';
      if (variant === 'zone-disabled' || variant === 'zone-unissued' || invalidScope) {
        // Stop automatic retries, then invoke the same registered admission owner deterministically.
        await module.get(TrackedFrameRecovery).onModuleDestroy();
        await assert.rejects(
          module.get(TrackedFrameAdmission).process(
            runtimeDb,
            {
              cameraId: fixture.cameraId,
              generationId: fixture.generation.workerGenerationId,
              streamSessionId: fixture.generation.streamSessionId,
              frameId: event.framePartition.frameId,
            },
            fixture.generation.secret,
          ),
        );
        assert.equal((await fetch(resultPath, { headers })).status, 404);
        assert.deepEqual(
          await db.query(
            'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
            [event.eventId],
          ),
          [{ state: 'PENDING_PARTS' }],
        );
        for (const table of [
          'safety_episode',
          'safety_alert',
          'ai_subject_segment',
          'zone_entry_assessment_request',
          'zone_entry_assessment_job',
        ])
          assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
        return;
      }
      let sealed = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await fetch(resultPath, { headers });
        if (result.status === 200) {
          assert.equal((await result.json()).kind, 'ADMITTED_TRACKED_FRAME');
          sealed = true;
          break;
        }
        assert.equal(result.status, 404);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(sealed, 'Recovery did not seal the accepted frame');
      const retry = await post();
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), receipt);
      if (uppercaseZone) {
        const requests = await db.query(
          'SELECT region_id,person_observation_index FROM zone_entry_assessment_request',
        );
        assert.deepEqual(requests, [
          { region_id: fixture.ppeRegionId!.toLowerCase(), person_observation_index: 0 },
        ]);
        assert.deepEqual(await db.query('SELECT status FROM zone_entry_assessment_job'), [
          { status: 'PENDING' },
        ]);
      }

      if (variant === 'region-disabled-v17') {
        for (const table of ['safety_episode', 'safety_alert', 'safety_episode_recipient'])
          assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n, 0);
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n,
          10,
        );
        const login = await module.get(AuthService).login(officer, password, AuthClientType.WEB);
        const inbox = await fetch((await app.getUrl()) + '/api/v1/me/safety-episode-inbox/frames', {
          headers: { authorization: 'Bearer ' + login.accessToken },
        });
        assert.equal(inbox.status, 200);
        assert.equal((await inbox.json()).total, 0);
        return;
      }
      if (variant === 'camera-v17') {
        // A later policy change must not erase the capture-time finding or its image access.
        const manager = await module
          .get(AuthService)
          .login(managerId, password, AuthClientType.WEB);
        const changed = await fetch(
          (await app.getUrl()) +
            '/api/v1/sites/' +
            fixture.siteId +
            '/cameras/' +
            fixture.cameraId +
            '/ppe-policy',
          {
            method: 'PATCH',
            headers: {
              authorization: 'Bearer ' + manager.accessToken,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              commandId: randomUUID(),
              expectedConfigurationVersion: 2,
              policy: { mode: 'DISABLED', reason: 'Synthetic subsequent policy change' },
            }),
          },
        );
        assert.equal(changed.status, 200, await changed.clone().text());
        assert.equal((await changed.json()).configurationVersion, 3);
        const historical = await runtimeDb.query<Array<{ bundle_sha256: string }>>(
          'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=2',
          [fixture.cameraId],
        );
        assert.equal(historical[0]?.bundle_sha256, fixture.context.bundleSha256);
      }
      const [{ episodes, findings, recipients, legacy }] = await db.query(
        'SELECT (SELECT count(*)::int FROM safety_episode) episodes, ' +
          '(SELECT count(*)::int FROM safety_alert) findings, ' +
          '(SELECT count(*)::int FROM safety_episode_recipient) recipients, ' +
          '(SELECT count(*)::int FROM user_notification) legacy',
      );
      assert.deepEqual(
        { episodes, findings, recipients, legacy },
        {
          episodes: withC02 ? 3 : 1,
          findings: withC02 ? 3 * findingCount : findingCount,
          recipients: withC02 ? 3 : 1,
          legacy: 0,
        },
      );
      const login = await module.get(AuthService).login(officer, password, AuthClientType.WEB);
      const officerHeaders = { authorization: 'Bearer ' + login.accessToken };
      const api = (await app.getUrl()) + '/api/v1';
      const inbox = await fetch(api + '/me/safety-episode-inbox?limit=1', {
        headers: officerHeaders,
      });
      assert.equal(inbox.status, 200);
      const page = await inbox.json();
      assert.equal(page.total, withC02 ? 3 : 1);
      const row = page.items[0];
      assert.equal(row.unread, true);
      assert.equal(row.episode.findingCount, findingCount);
      assert.equal(row.episode.subject.kind, 'TRACKED');
      const grouped = await fetch(
        api +
          '/me/safety-episode-inbox/frames?siteId=' +
          fixture.siteId +
          '&cameraId=' +
          fixture.cameraId,
        { headers: officerHeaders },
      );
      assert.equal(grouped.status, 200);
      const frames = await grouped.json();
      assert.equal(frames.total, 1);
      assert.equal(frames.items[0].cases.length, withC02 ? 3 : 1);
      const frameCase = frames.items[0].cases.find(
        (item: { episodeId: string }) => item.episodeId === row.episode.id,
      );
      assert.ok(frameCase);
      assert.equal(frameCase.episodeId, row.episode.id);
      assert.equal(frameCase.findingCount, findingCount);
      assert.equal(frameCase.source.eventId, event.eventId);
      assert.ok((withC02 ? [0, 3, 6] : [0]).includes(frameCase.source.personObservationIndex));
      assert.equal(frameCase.source.evidenceIndex, 0);
      assert.equal(frameCase.source.sha256, createHash('sha256').update(bytes).digest('hex'));
      if (uppercaseZone) {
        const zoneCase = frames.items[0].cases.find(
          (item: typeof frameCase) => item.source.personObservationIndex === 0,
        );
        assert.ok(zoneCase);
        assert.equal(zoneCase.zoneEntries.length, 1);
        assert.equal(zoneCase.zoneEntries[0].status, 'PENDING');
        assert.equal(zoneCase.zoneEntries[0].reasonCode, null);
        assert.equal(zoneCase.zoneEntries[0].provenance, null);
        for (const sibling of frames.items[0].cases) {
          if (sibling.episodeId !== zoneCase.episodeId) assert.deepEqual(sibling.zoneEntries, []);
        }
      } else assert.deepEqual(frameCase.zoneEntries, []);
      const detailPath = api + '/sites/' + fixture.siteId + '/safety-episodes/' + row.episode.id;
      const detailResponse = await fetch(detailPath + '/tracked', { headers: officerHeaders });
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.findings.length, findingCount);
      assert.ok(
        detail.findings.some(
          (finding: { alertId: string }) => finding.alertId === frameCase.source.alertId,
        ),
      );
      for (const finding of detail.findings) {
        const media = await fetch(
          detailPath +
            '/findings/' +
            finding.alertId +
            '/events/' +
            event.eventId +
            '/frame?personObservationIndex=' +
            frameCase.source.personObservationIndex +
            '&evidenceIndex=0',
          { headers: officerHeaders },
        );
        assert.equal(media.status, 200, await media.clone().text());
        assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
      }
      if (variant === 'camera-v17') {
        const findingUrl = `${api}/sites/${fixture.siteId}/safety-alerts/${frameCase.source.alertId}`;
        const finding = await fetch(findingUrl, { headers: officerHeaders });
        assert.equal(finding.status, 200, await finding.clone().text());
        assert.deepEqual((await finding.json()).detections[0].evidence, [
          { index: 0, kind: 'FRAME', available: true },
        ]);
        const photoUrl = `${findingUrl}/detections/${event.eventId}/evidence/0`;
        const photo = await fetch(photoUrl, { headers: officerHeaders });
        assert.equal(photo.status, 200, await photo.clone().text());
        assert.equal(photo.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(Buffer.from(await photo.arrayBuffer()), bytes);
        assert.equal((await fetch(photoUrl)).status, 401);
        assert.equal(
          (await fetch(photoUrl.replace(fixture.siteId, randomUUID()), { headers: officerHeaders }))
            .status,
          403,
        );
      }
      if (withC02) {
        const target = frames.items[0].cases.find(
          (item: { source: { personObservationIndex: number } }) =>
            item.source.personObservationIndex === 3,
        );
        assert.ok(target);
        const root = api + '/sites/' + fixture.siteId + '/safety-identification-requests';
        const previewInput = {
          episodeId: target.episodeId,
          alertId: target.source.alertId,
          eventId: event.eventId,
          personObservationIndex: 3,
          evidenceIndex: 0,
          masks: [],
        };
        const send = async (path: string, auth: string, body: unknown, status: number) => {
          const response = await fetch(root + path, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + auth, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          assert.equal(response.status, status, await response.clone().text());
          return response;
        };
        await send(
          '/evidence-preview',
          login.accessToken,
          { ...previewInput, personObservationIndex: 0 },
          404,
        );
        const preview = await send('/evidence-preview', login.accessToken, previewInput, 200);
        assert.equal(preview.headers.get('x-smartsite-frame-sha256'), digest);
        const crop = Buffer.from(await preview.arrayBuffer());
        const { data, info } = await sharp(crop).raw().toBuffer({ resolveWithObject: true });
        assert.ok(info.width < 120 && info.height < 80);
        const center =
          (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
        assert.ok(
          data[center + 1]! > 150 && data[center]! < 100 && data[center + 2]! < 100,
          'crop must show second, green subject',
        );
        const created = await (
          await send(
            '',
            login.accessToken,
            {
              commandId: randomUUID(),
              episodeId: target.episodeId,
              assignedTo: managerId,
              reason: 'Identify exact second flagged subject',
              evidenceRefs: [],
              evidenceApproval: {
                preview: previewInput,
                frameSha256: digest,
                sha256: createHash('sha256').update(crop).digest('hex'),
              },
            },
            201,
          )
        ).json();
        const request = created.request;
        assert.equal(request.episodeId, target.episodeId);
        assert.equal(request.subject.kind, 'TRACKED');
        assert.equal(request.evidenceAvailability.status, 'AVAILABLE');
        const manager = await module
          .get(AuthService)
          .login(managerId, password, AuthClientType.WEB);
        const managerHeaders = { authorization: 'Bearer ' + manager.accessToken };
        const published = await fetch(
          root + '/' + request.id + '/evidence/' + request.evidenceRefs[0],
          { headers: managerHeaders },
        );
        assert.equal(published.status, 200, await published.clone().text());
        assert.equal(published.headers.get('x-smartsite-frame-sha256'), null);
        assert.equal(
          published.headers.get('x-smartsite-content-sha256'),
          createHash('sha256').update(crop).digest('hex'),
        );
        assert.ok(Number(published.headers.get('x-smartsite-evidence-ttl-ms')) > 0);
        assert.equal(published.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(Buffer.from(await published.arrayBuffer()), crop);
        assert.equal(
          (
            await fetch(api + '/me/safety-episode-inbox/frames?siteId=' + fixture.siteId, {
              headers: managerHeaders,
            })
          ).status,
          403,
        );
        const rawPath =
          api +
          '/sites/' +
          fixture.siteId +
          '/safety-episodes/' +
          target.episodeId +
          '/findings/' +
          target.source.alertId +
          '/events/' +
          event.eventId +
          '/frame?personObservationIndex=3&evidenceIndex=0';
        assert.equal((await fetch(rawPath, { headers: managerHeaders })).status, 403);
        await send('/evidence-preview', manager.accessToken, previewInput, 403);
        const proposal = await (
          await send(
            '/' + request.id + '/respond',
            manager.accessToken,
            {
              commandId: randomUUID(),
              expectedVersion: request.version,
              outcome: 'UNRESOLVED',
              workerId: null,
              contractorId: null,
              evidenceRefs: [],
              reason: 'No verified identity for the observed subject',
            },
            201,
          )
        ).json();
        const closed = await (
          await send(
            '/' + request.id + '/review',
            login.accessToken,
            {
              commandId: randomUUID(),
              expectedVersion: proposal.request.version,
              decision: 'ACCEPT',
              reason: 'Retain unresolved identity without granting access',
            },
            201,
          )
        ).json();
        assert.equal(closed.request.status, 'CLOSED');
        assert.equal(closed.request.result.workerId, null);
        assert.equal(closed.request.result.contractorId, null);
        assert.deepEqual(
          await db.query(
            'SELECT count(*)::int AS unread FROM safety_episode_recipient WHERE seen_revision=0',
          ),
          [{ unread: 3 }],
        );
      }
    } finally {
      if (app) await app.close();
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await owned.dispose();
    }
  });
