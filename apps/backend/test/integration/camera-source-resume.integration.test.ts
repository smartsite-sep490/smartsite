import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { BackendEnvironment } from '../../src/config/environment.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import type { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraSourceService } from '../../src/modules/cameras/camera-source.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { WorkerEventAdmission1795046400002 } from '../../src/database/migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPendingRecoveryIndex1795046400004 } from '../../src/database/migrations/1795046400004-TrackedPendingRecoveryIndex.js';
import { TrackedWireGenerationFence1795046400008 } from '../../src/database/migrations/1795046400008-TrackedWireGenerationFence.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { TrackedSourceGapResume } from '../../src/integrations/ai/tracked-source-gap-resume.js';
import { TrackedFrameRecovery } from '../../src/integrations/ai/tracked-frame-recovery.js';
import { TrackedPpeInboxProjection } from '../../src/modules/safety/alerts/tracked-ppe-inbox-projection.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';

test('source resume coordinates an accepted configuration without replacing source/view', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    async function setup(
      mode:
        | 'success'
        | 'unsupported'
        | 'revoked'
        | 'changed'
        | 'lost'
        | 'legacy404'
        | 'gate'
        | 'scope404' = 'success',
    ) {
      const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
      let permitted = true;
      const calls: string[] = [];
      let activeCommand: string | undefined;
      let activeBinding = {
        cameraId: f.cameraId,
        workerGenerationId: f.generation.workerGenerationId,
        streamSessionId: f.generation.streamSessionId,
      };
      let preparedBinding = { ...activeBinding };
      const completed = new Map<string, Record<string, unknown>>();
      const config = new ConfigService<BackendEnvironment, true>({
        NODE_ENV: 'test',
        SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-service-token',
        SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
        AI_CONFIGURATION_CAMERA_IDS: [f.cameraId],
        SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
          {
            id: 'edge',
            label: 'Synthetic host',
            siteIds: [f.siteId],
            origin: 'http://127.0.0.1:62035',
          },
        ]),
      });
      const auth = {
        authenticate: async () => {
          if (!permitted)
            throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
          return {
            user: {
              mustChangePassword: false,
              roleAssignments: [{ role: 'SITE_MANAGER', siteId: f.siteId }],
            },
          };
        },
      } as unknown as AuthService;
      const cameras = {
        get: async (siteId: string, cameraId: string) => {
          assert.equal(siteId, f.siteId);
          assert.equal(cameraId, f.cameraId);
          return {
            id: f.cameraId,
            siteId: f.siteId,
            externalId: f.cameraId,
            type: mode === 'gate' ? 'GATE' : 'ZONE',
          };
        },
      } as unknown as CameraConfigurationService;
      const command = {
        commandId: randomUUID(),
        expectedRevision: 4,
        expectedConfigurationVersion: 1,
      };
      const fetcher = (async (url, init) => {
        const path = new URL(String(url)).pathname;
        calls.push(path.split('/').at(-1)!);
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer synthetic-service-token',
        );
        if (path.endsWith('/capabilities'))
          return Response.json({
            schemaVersion: '1.0.0',
            hostId: 'edge',
            label: 'Synthetic host',
            sourceKinds: ['WEBCAM'],
            webcams: [{ id: 'usb0', label: 'USB' }],
            videos: [],
            browserCameraSupported: false,
            applySupported: true,
            configurationResumeSupported: mode !== 'unsupported',
            sourceRevision: 4,
          });
        const body = JSON.parse(String(init?.body));
        if (path.endsWith('/resume-status')) {
          if (mode === 'legacy404') return Response.json({ detail: 'Not Found' }, { status: 404 });
          if (mode === 'scope404')
            return Response.json({ code: 'SOURCE_SCOPE_NOT_FOUND' }, { status: 404 });
          if (!completed.has(body.commandId))
            return Response.json({ code: 'SOURCE_RESUME_NOT_FOUND' }, { status: 404 });
          if (activeCommand !== body.commandId)
            return Response.json({ code: 'SOURCE_RECONCILIATION_REQUIRED' }, { status: 409 });
          return Response.json(completed.get(body.commandId));
        }
        if (path.endsWith('/prepare-resume')) {
          assert.deepEqual(body.generationBinding, activeBinding);
          preparedBinding = { ...activeBinding };
          assert.deepEqual(body.configuration, {
            configurationVersion: 1,
            viewRevision: 1,
            bundleSha256: f.context.bundleSha256,
          });
          if (mode === 'revoked') permitted = false;
          if (mode === 'changed')
            await db.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [f.cameraId]);
          return Response.json({
            schemaVersion: '1.0.0',
            state: 'PREPARED',
            commandId: body.commandId,
            sourceRevision: 4,
            sourceKind: 'LIVE',
            currentGenerationId: activeBinding.workerGenerationId,
          });
        }
        assert.ok(path.endsWith('/commit-resume'));
        assert.ok(body.generation.secret);
        assert.notEqual(body.generation.workerGenerationId, f.generation.workerGenerationId);
        activeBinding = {
          cameraId: f.cameraId,
          workerGenerationId: body.generation.workerGenerationId,
          streamSessionId: body.generation.streamSessionId,
        };
        activeCommand = body.commandId;
        completed.set(body.commandId, {
          schemaVersion: '1.0.0',
          state: 'RUNNING',
          commandId: body.commandId,
          sourceRevision: 4,
          sourceKind: 'LIVE',
          generationBinding: preparedBinding,
          configuration: {
            configurationVersion: 1,
            viewRevision: 1,
            bundleSha256: f.context.bundleSha256,
          },
          newGenerationBinding: activeBinding,
        });
        if (mode === 'lost') return Response.json({ code: 'GATEWAY_TIMEOUT' }, { status: 504 });
        return Response.json({
          schemaVersion: '1.0.0',
          state: 'RUNNING',
          commandId: body.commandId,
          sourceRevision: 4,
          sourceKind: 'LIVE',
          currentGenerationId: body.generation.workerGenerationId,
        });
      }) as typeof fetch;
      return {
        ...f,
        calls,
        command,
        service: new CameraSourceService(config, auth, cameras, fetcher, db),
      };
    }
    await t.test(
      'new owner is committed, existing region geometry/view survive and response has no credential',
      async () => {
        const f = await setup();
        const before = await db.query(
          'SELECT to_jsonb(v) AS view FROM camera_view_revision v WHERE camera_id=$1',
          [f.cameraId],
        );
        const result = await f.service.resume(
          'synthetic-user-token',
          f.siteId,
          f.cameraId,
          'edge',
          f.command,
        );
        assert.equal(result.state, 'STARTED');
        assert.equal(result.configurationVersion, 1);
        assert.equal(result.viewRevision, 1);
        assert.equal(result.sourceRevision, 4);
        assert.equal(result.bundleSha256, f.context.bundleSha256);
        assert.deepEqual(f.calls, [
          'capabilities',
          'resume-status',
          'prepare-resume',
          'commit-resume',
        ]);
        assert.doesNotMatch(JSON.stringify(result), /secret|token/);
        assert.deepEqual(
          await db.query(
            'SELECT to_jsonb(v) AS view FROM camera_view_revision v WHERE camera_id=$1',
            [f.cameraId],
          ),
          before,
        );
        const [owner] = await db.query(
          'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
          [f.cameraId],
        );
        assert.equal(owner.id, result.currentGenerationId);
        const beforeRetry = await db.query(
          'SELECT id,is_current FROM camera_worker_generation WHERE camera_id=$1 ORDER BY id',
          [f.cameraId],
        );
        assert.deepEqual(
          await f.service.resume('synthetic-user-token', f.siteId, f.cameraId, 'edge', f.command),
          result,
        );
        assert.deepEqual(
          await db.query(
            'SELECT id,is_current FROM camera_worker_generation WHERE camera_id=$1 ORDER BY id',
            [f.cameraId],
          ),
          beforeRetry,
        );
        assert.equal(f.calls.filter((p) => p === 'commit-resume').length, 1);
      },
    );
    await t.test(
      'lost response replays committed status and superseded command never rotates again',
      async () => {
        const f = await setup('lost');
        await assert.rejects(
          f.service.resume('synthetic-user-token', f.siteId, f.cameraId, 'edge', f.command),
          (e) => e instanceof PublicHttpException && e.getStatus() === 504,
        );
        const first = await f.service.resume(
          'synthetic-user-token',
          f.siteId,
          f.cameraId,
          'edge',
          f.command,
        );
        assert.equal(first.state, 'STARTED');
        assert.equal(f.calls.filter((p) => p === 'commit-resume').length, 1);
        const next = { ...f.command, commandId: randomUUID() };
        await assert.rejects(
          f.service.resume('synthetic-user-token', f.siteId, f.cameraId, 'edge', next),
          (e) => e instanceof PublicHttpException && e.getStatus() === 504,
        );
        const beforeOldRetry = await db.query(
          'SELECT id,is_current FROM camera_worker_generation WHERE camera_id=$1 ORDER BY id',
          [f.cameraId],
        );
        await assert.rejects(
          f.service.resume('synthetic-user-token', f.siteId, f.cameraId, 'edge', f.command),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.deepEqual(
          await db.query(
            'SELECT id,is_current FROM camera_worker_generation WHERE camera_id=$1 ORDER BY id',
            [f.cameraId],
          ),
          beforeOldRetry,
        );
        assert.equal(f.calls.filter((p) => p === 'commit-resume').length, 2);
      },
    );
    for (const [mode, status] of [
      ['unsupported', 503],
      ['gate', 409],
      ['revoked', 403],
      ['changed', 409],
      ['legacy404', 503],
      ['scope404', 503],
    ] as const)
      await t.test(mode + ' fails before remote commit without a new owner', async () => {
        const f = await setup(mode);
        await assert.rejects(
          f.service.resume('synthetic-user-token', f.siteId, f.cameraId, 'edge', f.command),
          (e) => e instanceof PublicHttpException && e.getStatus() === status,
        );
        assert.ok(!f.calls.includes('commit-resume'));
        assert.deepEqual(
          (
            await db.query(
              'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
              [f.cameraId],
            )
          ).map((r: { id: string }) => r.id),
          [f.generation.workerGenerationId],
        );
      });
  } finally {
    await owned.dispose();
  }
});

test('resumeAfterSourceGap transitions active heads/pending via canonical renewal and enforces route/config invariants on PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
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

    async function setupScenario(
      options: {
        claimTracked?: boolean;
        routeOverride?: 'LEGACY' | null;
        hostIdForSite?: string;
        changeConfigAtPrepare?: boolean;
        capabilitiesMode?:
          | 'valid'
          | 'wrong-host'
          | 'unsupported'
          | 'missing-revision'
          | 'network-error'
          | 'invalid-payload';
        afterIssueHook?: (context: {
          cameraId: string;
          envStore: Map<string, unknown>;
          issued: { workerGenerationId: string; streamSessionId: string };
        }) => Promise<void>;
      } = {},
    ) {
      const f = await seedTrackedFrameFixture(db, ['HARD_HAT']);
      const routeEpoch = '00000000-0000-4000-8000-000000000001';
      const officer = randomUUID();
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic officer','synthetic-non-login-hash',true,false)",
        [officer],
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
        [randomUUID(), officer, f.siteId],
      );

      const authService = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
        profileSha256: 'a'.repeat(64),
        allowedCameraIds: [f.cameraId],
        clockToleranceMs: 5000,
        routeEpoch,
      });
      const store = new TrackedFramePrototypeStore(authService, {
        pendingTtlMs: 30000,
        maxPendingFrames: 16,
        maxPendingParts: 32,
        maxPendingPayloadBytes: 100000,
      });
      const inbox = new TrackedPpeInboxProjection(db, { maxRecipients: 8 });
      const admission = new TrackedFrameAdmission(
        authService,
        {
          firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
          maxCaptureGapMs: 10000,
          maxSourceSequenceGap: '1',
          maxSegmentRows: 32,
        },
        {
          async project(manager, frame) {
            await inbox.projectFrame(manager, {
              siteId: frame.scope.siteId,
              cameraId: frame.scope.cameraId,
              scopeSha256: frame.scope.scopeSha256,
              coordinatorEventId: frame.coordinatorEventId,
            });
          },
        },
      );

      const segmentId = randomUUID();
      let sealedEventId: string | undefined;
      let stagedPartEventId: string | undefined;
      let gapCoordinatorEventId: string | undefined;
      let gapFrameId: string | undefined;

      if (options.claimTracked !== false) {
        const base = f.event();
        const firstPart1 = {
          ...base,
          framePartition: { ...base.framePartition, partIndex: 1, partCount: 2 },
          observations: [
            { type: 'PERSON', trackId: 1 },
            {
              type: 'PPE',
              trackId: 1,
              ppeItem: 'HARD_HAT',
              status: 'MISSING',
              regionId: f.ppeRegionId!,
              geometryVersion: 1,
            },
          ],
          continuity: {
            ...base.continuity,
            subjects: [
              {
                personObservationIndex: 0,
                segmentId,
                link: { kind: 'START', reason: 'INITIAL' },
              },
            ],
          },
        };
        const firstPart0 = {
          ...firstPart1,
          eventId: randomUUID(),
          observations: [],
          framePartition: { ...firstPart1.framePartition, partIndex: 0 },
          continuity: { ...firstPart1.continuity, subjects: [] },
        };
        sealedEventId = firstPart0.eventId;
        await store.store(db, firstPart1, f.context, f.generation.secret);
        await store.store(db, firstPart0, f.context, f.generation.secret);
        assert.equal(
          (
            await admission.process(
              db,
              {
                cameraId: f.cameraId,
                generationId: f.generation.workerGenerationId,
                streamSessionId: f.generation.streamSessionId,
                frameId: firstPart1.framePartition.frameId,
              },
              f.generation.secret,
            )
          ).kind,
          'SEALED',
        );

        const gapCoord = f.event(0, 1, '2');
        const staged = f.event(1, 2, '3');
        gapCoordinatorEventId = gapCoord.eventId;
        gapFrameId = gapCoord.framePartition.frameId;
        stagedPartEventId = staged.eventId;
        await store.store(db, gapCoord, f.context, f.generation.secret);
        await store.store(db, staged, f.context, f.generation.secret);

        const recovery = await admission.recoverCurrent(db, f.cameraId, 8);
        assert.ok(
          recovery.some(
            (r) =>
              r.frameId === gapFrameId &&
              r.kind === 'PENDING_PREDECESSOR' &&
              r.reason === 'SOURCE_GAP',
          ),
        );
      } else if (options.routeOverride === 'LEGACY') {
        await db.query(
          "UPDATE camera_worker_generation SET observation_route_mode='LEGACY' WHERE id=$1",
          [f.generation.workerGenerationId],
        );
      }

      const policy = {
        profile: {
          wireVersion: '1.7.0',
          routeEpoch,
          profileSha256: 'a'.repeat(64),
          allowedCameraIds: [f.cameraId],
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
        recovery: {
          intervalMs: 50,
          maxFramesPerCamera: 8,
          automaticResume: { hostId: 'local-ai', minPersistentMs: 2000, maxStarts: 3 },
        },
        maxRecipients: 8,
      };
      const envStore = new Map<string, unknown>([
        ['NODE_ENV', 'test'],
        ['SMARTSITE_AI_SERVICE_TOKEN', 'a'.repeat(32)],
        ['AI_TRACKED_FRAME_RUNTIME_ENABLED', true],
        ['SMARTSITE_AI_SOURCE_APPLY_ENABLED', true],
        ['AI_CONFIGURATION_CAMERA_IDS', [f.cameraId]],
        ['AI_TRACKED_FRAME_RUNTIME_POLICY', policy],
        [
          'SMARTSITE_AI_SOURCE_HOSTS',
          JSON.stringify([
            {
              id: 'local-ai',
              label: 'Local host',
              siteIds: [options.hostIdForSite ?? f.siteId],
              origin: 'http://127.0.0.1:62035',
            },
          ]),
        ],
      ]);
      const config = {
        get(key: string) {
          return envStore.get(key);
        },
      } as unknown as ConfigService<BackendEnvironment, true>;
      const auth = {
        authenticate: async () => {
          throw new Error('internal recovery must not call user token auth');
        },
      } as unknown as AuthService;
      const cameras = {
        get: async (siteId: string, cameraId: string) => {
          assert.equal(siteId, f.siteId);
          assert.equal(cameraId, f.cameraId);
          return { id: f.cameraId, siteId: f.siteId, externalId: f.cameraId, type: 'ZONE' };
        },
      } as unknown as CameraConfigurationService;

      const calls: string[] = [];
      let routeSeenAtCommit: string | null | undefined;
      let commitBodyGeneration: { workerGenerationId: string; streamSessionId: string } | undefined;
      const fetcher = (async (url, init) => {
        const path = new URL(String(url)).pathname;
        calls.push(path.split('/').at(-1)!);
        if (path.endsWith('/capabilities')) {
          const mode = options.capabilitiesMode ?? 'valid';
          if (mode === 'network-error') throw new Error('ECONNREFUSED synthetic');
          if (mode === 'invalid-payload') return Response.json({ bad: true });
          return Response.json({
            schemaVersion: '1.0.0',
            hostId: mode === 'wrong-host' ? 'other-host' : 'local-ai',
            label: 'Local host',
            sourceKinds: ['WEBCAM'],
            webcams: [{ id: 'usb0', label: 'USB' }],
            videos: [],
            browserCameraSupported: false,
            applySupported: true,
            ...(mode === 'unsupported'
              ? { configurationResumeSupported: false }
              : { configurationResumeSupported: true }),
            ...(mode === 'missing-revision' ? {} : { sourceRevision: 4 }),
          });
        }
        const body = JSON.parse(String(init?.body));
        if (path.endsWith('/resume-status'))
          return Response.json({ code: 'SOURCE_RESUME_NOT_FOUND' }, { status: 404 });
        if (path.endsWith('/prepare-resume')) {
          assert.deepEqual(body.generationBinding, {
            cameraId: f.cameraId,
            workerGenerationId: f.generation.workerGenerationId,
            streamSessionId: f.generation.streamSessionId,
          });
          assert.deepEqual(body.configuration, {
            configurationVersion: 1,
            viewRevision: 1,
            bundleSha256: f.context.bundleSha256,
          });
          if (options.changeConfigAtPrepare)
            await db.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [f.cameraId]);
          return Response.json({
            schemaVersion: '1.0.0',
            state: 'PREPARED',
            commandId: body.commandId,
            sourceRevision: 4,
            sourceKind: 'LIVE',
            currentGenerationId: f.generation.workerGenerationId,
          });
        }
        assert.ok(path.endsWith('/commit-resume'));
        commitBodyGeneration = body.generation;
        const [issuedRow] = await db.query<
          Array<{
            id: string;
            stream_session_id: string;
            is_current: boolean;
            observation_route_mode: string | null;
          }>
        >(
          'SELECT id,stream_session_id,is_current,observation_route_mode FROM camera_worker_generation WHERE id=$1',
          [body.generation.workerGenerationId],
        );
        assert.ok(issuedRow);
        assert.equal(issuedRow.is_current, true);
        assert.equal(issuedRow.stream_session_id, body.generation.streamSessionId);
        routeSeenAtCommit = issuedRow.observation_route_mode;
        return Response.json({
          schemaVersion: '1.0.0',
          state: 'RUNNING',
          commandId: body.commandId,
          sourceRevision: 4,
          sourceKind: 'LIVE',
          currentGenerationId: body.generation.workerGenerationId,
        });
      }) as typeof fetch;

      let interceptedDb = db;
      if (options.afterIssueHook) {
        const hook = options.afterIssueHook;
        interceptedDb = Object.create(db, {
          transaction: {
            async value(...args: unknown[]) {
              const result = await (
                db.transaction as (...txArgs: unknown[]) => Promise<unknown>
              ).apply(db, args);
              if (
                result &&
                typeof result === 'object' &&
                'workerGenerationId' in result &&
                'streamSessionId' in result
              ) {
                await hook({
                  cameraId: f.cameraId,
                  envStore,
                  issued: result as { workerGenerationId: string; streamSessionId: string },
                });
              }
              return result;
            },
          },
        });
      }

      return {
        ...f,
        admission,
        segmentId,
        sealedEventId,
        stagedPartEventId,
        gapCoordinatorEventId,
        gapFrameId,
        calls,
        envStore,
        routeSeenAtCommit: () => routeSeenAtCommit,
        commitBodyGeneration: () => commitBodyGeneration,
        service: new CameraSourceService(config, auth, cameras, fetcher, interceptedDb),
      };
    }

    await t.test(
      'canonical renewal transitions active heads/pending, accepts fresh NULL route before commit, and preserves evidence',
      async () => {
        const f = await setupScenario();
        const gapKey = {
          cameraId: f.cameraId,
          generationId: f.generation.workerGenerationId,
          streamSessionId: f.generation.streamSessionId,
          frameId: f.gapFrameId!,
        };
        let recheckCalls = 0;
        const result = await f.service.resumeAfterSourceGap(gapKey, async () => {
          recheckCalls++;
          return f.admission.recheckSourceGap(db, gapKey);
        });

        assert.equal(result.state, 'STARTED');
        assert.equal(result.sourceRevision, 4);
        assert.equal(result.configurationVersion, 1);
        assert.equal(result.viewRevision, 1);
        assert.equal(result.bundleSha256, f.context.bundleSha256);
        assert.notEqual(result.currentGenerationId, f.generation.workerGenerationId);
        assert.deepEqual(f.calls, [
          'capabilities',
          'capabilities',
          'resume-status',
          'prepare-resume',
          'commit-resume',
        ]);
        // Must accept the newly issued generation with observation_route_mode=NULL before commit.
        assert.equal(f.routeSeenAtCommit(), null);
        assert.equal(f.commitBodyGeneration()?.workerGenerationId, result.currentGenerationId);
        // Must only invoke gapStillCurrent before issuance (initial + resumeWithAuthority + 2 pre-issue checks).
        assert.equal(recheckCalls, 4);
        assert.doesNotMatch(JSON.stringify(result), /secret|token/);

        const [oldGen] = await db.query(
          'SELECT is_current,superseded_at FROM camera_worker_generation WHERE id=$1',
          [f.generation.workerGenerationId],
        );
        assert.equal(oldGen.is_current, false);
        assert.ok(oldGen.superseded_at instanceof Date);

        const [retiredSegment] = await db.query(
          'SELECT state,retirement_reason,retirement_provenance FROM ai_subject_segment WHERE segment_id=$1',
          [f.segmentId],
        );
        assert.equal(retiredSegment.state, 'RETIRED');
        assert.equal(retiredSegment.retirement_reason, 'SOURCE_TRANSITION');
        assert.equal(
          retiredSegment.retirement_provenance.supersedingGenerationId,
          result.currentGenerationId,
        );

        const [episode] = await db.query(
          'SELECT collection_state FROM safety_episode WHERE camera_id=$1',
          [f.cameraId],
        );
        assert.equal(episode.collection_state, 'SEALED');

        const [staged] = await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [f.stagedPartEventId!],
        );
        assert.equal(staged.state, 'PART_EXPIRED');

        const [gapCoord] = await db.query(
          'SELECT tracking_frame_state AS state,tracking_frame_result AS result FROM ai_observation_event WHERE event_id=$1',
          [f.gapCoordinatorEventId!],
        );
        assert.equal(gapCoord.state, 'REVIEW_ONLY');
        assert.equal(gapCoord.result.reason, 'TRUSTED_SOURCE_TRANSITION');

        const [sealed] = await db.query(
          'SELECT tracking_frame_state AS state FROM ai_observation_event WHERE event_id=$1',
          [f.sealedEventId!],
        );
        assert.equal(sealed.state, 'SEALED');
      },
    );

    await t.test('old NULL and LEGACY generations are denied on initial owner query', async () => {
      for (const routeOverride of [null, 'LEGACY'] as const) {
        const f = await setupScenario({ claimTracked: false, routeOverride });
        await assert.rejects(
          f.service.resumeAfterSourceGap(
            {
              cameraId: f.cameraId,
              generationId: f.generation.workerGenerationId,
              streamSessionId: f.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.deepEqual(f.calls, []);
        const [current] = await db.query(
          'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
          [f.cameraId],
        );
        assert.equal(current.id, f.generation.workerGenerationId);
      }
    });

    await t.test(
      'missing site host, stale gap, and config change before prepare deny without commit',
      async () => {
        const noHost = await setupScenario({ hostIdForSite: randomUUID() });
        await assert.rejects(
          noHost.service.resumeAfterSourceGap(
            {
              cameraId: noHost.cameraId,
              generationId: noHost.generation.workerGenerationId,
              streamSessionId: noHost.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 503,
        );
        assert.deepEqual(noHost.calls, []);

        const staleGap = await setupScenario();
        await assert.rejects(
          staleGap.service.resumeAfterSourceGap(
            {
              cameraId: staleGap.cameraId,
              generationId: staleGap.generation.workerGenerationId,
              streamSessionId: staleGap.generation.streamSessionId,
            },
            async () => false,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.deepEqual(staleGap.calls, []);

        const changedPrepare = await setupScenario({ changeConfigAtPrepare: true });
        await assert.rejects(
          changedPrepare.service.resumeAfterSourceGap(
            {
              cameraId: changedPrepare.cameraId,
              generationId: changedPrepare.generation.workerGenerationId,
              streamSessionId: changedPrepare.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.ok(!changedPrepare.calls.includes('commit-resume'));
        const [unchangedOwner] = await db.query(
          'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
          [changedPrepare.cameraId],
        );
        assert.equal(unchangedOwner.id, changedPrepare.generation.workerGenerationId);

        for (const capabilitiesMode of [
          'wrong-host',
          'unsupported',
          'missing-revision',
          'network-error',
          'invalid-payload',
        ] as const) {
          const capScenario = await setupScenario({ capabilitiesMode });
          await assert.rejects(
            capScenario.service.resumeAfterSourceGap(
              {
                cameraId: capScenario.cameraId,
                generationId: capScenario.generation.workerGenerationId,
                streamSessionId: capScenario.generation.streamSessionId,
              },
              async () => true,
            ),
            (e) => e instanceof PublicHttpException && e.getStatus() === 503,
          );
          assert.deepEqual(capScenario.calls, ['capabilities']);
          const [sameOwner] = await db.query(
            'SELECT id FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
            [capScenario.cameraId],
          );
          assert.equal(sameOwner.id, capScenario.generation.workerGenerationId);
        }
      },
    );

    await t.test(
      'configuration or route change between renewal and commit denies before remote commit',
      async () => {
        const configChanged = await setupScenario({
          afterIssueHook: async ({ cameraId }) => {
            await db.query('UPDATE camera SET configuration_version=2 WHERE id=$1', [cameraId]);
          },
        });
        await assert.rejects(
          configChanged.service.resumeAfterSourceGap(
            {
              cameraId: configChanged.cameraId,
              generationId: configChanged.generation.workerGenerationId,
              streamSessionId: configChanged.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.ok(!configChanged.calls.includes('commit-resume'));

        const routeTampered = await setupScenario({
          afterIssueHook: async ({ issued }) => {
            await db.query(
              "UPDATE camera_worker_generation SET observation_route_mode='LEGACY' WHERE id=$1",
              [issued.workerGenerationId],
            );
          },
        });
        await assert.rejects(
          routeTampered.service.resumeAfterSourceGap(
            {
              cameraId: routeTampered.cameraId,
              generationId: routeTampered.generation.workerGenerationId,
              streamSessionId: routeTampered.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.ok(!routeTampered.calls.includes('commit-resume'));

        const disabledBeforeCommit = await setupScenario({
          afterIssueHook: async ({ envStore }) => {
            envStore.set('SMARTSITE_AI_SOURCE_APPLY_ENABLED', false);
          },
        });
        await assert.rejects(
          disabledBeforeCommit.service.resumeAfterSourceGap(
            {
              cameraId: disabledBeforeCommit.cameraId,
              generationId: disabledBeforeCommit.generation.workerGenerationId,
              streamSessionId: disabledBeforeCommit.generation.streamSessionId,
            },
            async () => true,
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 503,
        );
        assert.ok(!disabledBeforeCommit.calls.includes('commit-resume'));
      },
    );

    await t.test(
      'AppModule wires TrackedSourceGapResume into TrackedFrameRuntimeModule only when automaticResume is configured',
      async () => {
        const f = await setupScenario({ claimTracked: false });
        const saved = new Map<string, string | undefined>();
        const baseEnv = {
          NODE_ENV: 'test',
          SMARTSITE_AI_SERVICE_TOKEN: 'b'.repeat(32),
          AI_CONFIGURATION_CAMERA_IDS: f.cameraId,
          DATABASE_URL: resolveTestDatabaseUrl(),
          DATABASE_SCHEMA: db.driver.schema!,
          SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v16',
          AI_TRACKED_FRAME_RUNTIME_ENABLED: 'true',
          AI_TRACKED_FRAME_RUNTIME_POLICY: JSON.stringify({
            profile: {
              wireVersion: '1.6.0',
              routeEpoch: '00000000-0000-4000-8000-000000000001',
              profileSha256: 'a'.repeat(64),
              allowedCameraIds: [f.cameraId],
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
            recovery: {
              intervalMs: 50,
              maxFramesPerCamera: 8,
              automaticResume: { hostId: 'local-ai', minPersistentMs: 2000, maxStarts: 3 },
            },
            maxRecipients: 8,
          }),
        };
        try {
          for (const [k, v] of Object.entries(baseEnv)) {
            saved.set(k, process.env[k]);
            process.env[k] = v;
          }
          const { AppModule } = await import(
            new URL('../../src/app.module.js?gap-resume-enabled', import.meta.url).href
          );
          const cfg = createTestConfig(baseEnv);
          const mod = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(ConfigService)
            .useValue(cfg)
            .overrideProvider(PARAMS_PROVIDER_TOKEN)
            .useValue(createLoggerParams(cfg, { write: () => undefined }))
            .compile();
          try {
            assert.ok(mod.get(TrackedSourceGapResume) instanceof TrackedSourceGapResume);
            assert.ok(mod.get(TrackedFrameRecovery) instanceof TrackedFrameRecovery);
            assert.ok(mod.get(CameraSourceService) instanceof CameraSourceService);
          } finally {
            await mod.close();
          }

          const omittedEnv = {
            ...baseEnv,
            AI_TRACKED_FRAME_RUNTIME_POLICY: JSON.stringify({
              ...JSON.parse(baseEnv.AI_TRACKED_FRAME_RUNTIME_POLICY),
              recovery: { intervalMs: 50, maxFramesPerCamera: 8 },
            }),
          };
          for (const [k, v] of Object.entries(omittedEnv)) process.env[k] = v;
          const { AppModule: AppModuleDisabled } = await import(
            new URL('../../src/app.module.js?gap-resume-disabled', import.meta.url).href
          );
          const cfg2 = createTestConfig(omittedEnv);
          const mod2 = await Test.createTestingModule({ imports: [AppModuleDisabled] })
            .overrideProvider(ConfigService)
            .useValue(cfg2)
            .overrideProvider(PARAMS_PROVIDER_TOKEN)
            .useValue(createLoggerParams(cfg2, { write: () => undefined }))
            .compile();
          try {
            assert.throws(() => mod2.get(TrackedSourceGapResume));
            assert.ok(mod2.get(TrackedFrameRecovery) instanceof TrackedFrameRecovery);
          } finally {
            await mod2.close();
          }
        } finally {
          for (const [k, v] of saved.entries()) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
          }
        }
      },
    );
  } finally {
    await owned.dispose();
  }
});
