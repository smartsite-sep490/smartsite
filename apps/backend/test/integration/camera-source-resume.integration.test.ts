import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../src/config/environment.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import type { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraSourceService } from '../../src/modules/cameras/camera-source.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
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
