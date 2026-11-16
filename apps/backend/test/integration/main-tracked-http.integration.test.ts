import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

for (const variant of ['ppe-only', 'zone-uppercase', 'zone-unissued', 'zone-disabled'] as const)
  test(`registered v1.6 worker HTTP intake preserves ${variant} handling`, async () => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let app: NestExpressApplication | undefined;
    const saved = new Map<string, string | undefined>();
    try {
      await owned.initialize();
      await db.transaction(async (manager) => {
        for (const migration of [
          new WorkerEventAdmission1795046400002(),
          new TrackedSubjectStorage1795046400003(),
          new TrackedPendingRecoveryIndex1795046400004(),
          new TrackedWireGenerationFence1795046400008(),
        ])
          await migration.up(manager.queryRunner!);
      });
      const fixture = await seedTrackedFrameFixture(db, ['HARD_HAT', 'SAFETY_VEST']);
      const routeEpoch = randomUUID();
      await db.query(
        "UPDATE camera_worker_generation SET observation_route_mode='EPISODE_TRACKED',tracking_route_epoch=$2,tracked_wire_version='1.6.0' WHERE id=$1",
        [fixture.generation.workerGenerationId, routeEpoch],
      );
      const officer = randomUUID();
      const password = 'Synthetic_tracked_officer_123';
      const passwordHash = await hashPassword(password);
      const evidenceRoot = await mkdtemp(join(tmpdir(), 'tracked-http-evidence-'));
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic officer',$2)",
        [officer, passwordHash],
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
        [randomUUID(), officer, fixture.siteId],
      );
      const token = randomUUID() + randomUUID();
      const env = {
        NODE_ENV: 'test',
        EVIDENCE_LOCAL_ROOT: evidenceRoot,
        SMARTSITE_AI_SERVICE_TOKEN: token,
        AI_CONFIGURATION_CAMERA_IDS: fixture.cameraId,
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: db.driver.schema!,
        SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v16',
        AI_TRACKED_FRAME_RUNTIME_ENABLED: 'true',
        MF06_ENQUEUE_ENABLED:
          variant === 'zone-uppercase' || variant === 'zone-unissued' ? 'true' : 'false',
        ...(variant === 'zone-uppercase' || variant === 'zone-unissued'
          ? { MF06_ENQUEUE_MAX_OUTSTANDING: '8' }
          : {}),
        AI_TRACKED_FRAME_RUNTIME_POLICY: JSON.stringify({
          profile: {
            wireVersion: '1.6.0',
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
      const base = fixture.event();
      const bytes = await sharp({
        create: { width: 120, height: 80, channels: 3, background: '#456789' },
      })
        .jpeg()
        .toBuffer();
      const digest = createHash('sha256').update(bytes).digest('hex');
      await writeFile(
        join(evidenceRoot, base.streamSessionId + '_0_' + base.eventId + '.jpg'),
        bytes,
        { flag: 'wx' },
      );
      const event = {
        ...base,
        schemaVersion: '1.6.0',
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
          ...(variant !== 'ppe-only'
            ? [
                {
                  type: 'ZONE_ENTRY',
                  trackId: 1,
                  regionId:
                    variant === 'zone-unissued'
                      ? randomUUID()
                      : variant === 'zone-uppercase'
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
      const headers = {
        authorization: 'Bearer ' + token,
        'x-worker-generation-secret': fixture.generation.secret,
        'content-type': 'application/json',
      };
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
      if (variant === 'zone-disabled' || variant === 'zone-unissued') {
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
      if (variant === 'zone-uppercase') {
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
      const retry = await post();
      assert.equal(retry.status, 200);
      assert.deepEqual(await retry.json(), receipt);
      const [{ episodes, findings, recipients, legacy }] = await db.query(
        'SELECT (SELECT count(*)::int FROM safety_episode) episodes, ' +
          '(SELECT count(*)::int FROM safety_alert) findings, ' +
          '(SELECT count(*)::int FROM safety_episode_recipient) recipients, ' +
          '(SELECT count(*)::int FROM user_notification) legacy',
      );
      assert.deepEqual(
        { episodes, findings, recipients, legacy },
        {
          episodes: 1,
          findings: 2,
          recipients: 1,
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
      assert.equal(page.total, 1);
      const row = page.items[0];
      assert.equal(row.unread, true);
      assert.equal(row.episode.findingCount, 2);
      assert.equal(row.episode.subject.kind, 'TRACKED');
      const detailPath = api + '/sites/' + fixture.siteId + '/safety-episodes/' + row.episode.id;
      const detailResponse = await fetch(detailPath + '/tracked', { headers: officerHeaders });
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.findings.length, 2);
      for (const finding of detail.findings) {
        const media = await fetch(
          detailPath +
            '/findings/' +
            finding.alertId +
            '/events/' +
            event.eventId +
            '/frame?personObservationIndex=0&evidenceIndex=0',
          { headers: officerHeaders },
        );
        assert.equal(media.status, 200, await media.clone().text());
        assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
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
