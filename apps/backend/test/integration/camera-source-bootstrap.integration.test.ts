import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../src/config/environment.js';
import type { AuthService } from '../../src/modules/auth/auth.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { CameraEventAdmissionService } from '../../src/modules/cameras/camera-event-admission.service.js';
import { CameraSourceService } from '../../src/modules/cameras/camera-source.service.js';
import {
  bootstrapCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { TrackedFrameAdmission } from '../../src/integrations/ai/tracked-frame-admission.js';
import { TrackedFramePrototypeStore } from '../../src/integrations/ai/tracked-frame-storage.js';
import { TrackedPartAuthenticator } from '../../src/integrations/ai/tracked-part-authentication.js';
import { TrackedPpeInboxProjection } from '../../src/modules/safety/alerts/tracked-ppe-inbox-projection.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

interface HarnessOptions {
  role?: UserRole;
  cameraType?: 'ZONE' | 'GATE';
  cameraStatus?: 'ACTIVE' | 'INACTIVE';
  allowCamera?: boolean;
  targetSiteId?: string;
  hostId?: string;
  revokeAfterPrepare?: boolean;
  failCommitStatus?: number;
  prepareDelayMs?: number;
  commitRevision?: number;
  prepareState?: (commandId: string) => Record<string, unknown>;
}

test('first-source bootstrap in PostgreSQL 5433 issues unowned owner once and enforces all guards', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();

    async function setup(options: HarnessOptions = {}) {
      const siteId = randomUUID();
      const requestSiteId = options.targetSiteId ?? siteId;
      const cameraId = randomUUID();
      const externalId = 'cam-bootstrap-' + cameraId.slice(0, 8);
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Bootstrap Test Site')",
        [siteId],
      );
      if (requestSiteId !== siteId) {
        await db.query(
          "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Foreign Request Site')",
          [requestSiteId],
        );
      }
      let gateId: string | null = null;
      if (options.cameraType === 'GATE') {
        gateId = randomUUID();
        await db.query(
          "INSERT INTO gate(id,site_id,code,name) VALUES($1,$2,$1::uuid::text,'Bootstrap Test Gate')",
          [gateId, siteId],
        );
      }
      await db.query(
        'INSERT INTO camera(type,status,id,site_id,gate_id,external_id,code,name) VALUES($1,$2,$3,$4,$5,$6,$6,$7)',
        [
          options.cameraType ?? 'ZONE',
          options.cameraStatus ?? 'ACTIVE',
          cameraId,
          siteId,
          gateId,
          externalId,
          'Bootstrap Test Camera',
        ],
      );

      let permitted = true;
      let prepareCalls = 0;
      let commitCalls = 0;
      let committedGeneration: {
        workerGenerationId: string;
        streamSessionId: string;
        secret: string;
        expiresAt: string;
      } | null = null;
      const calls: string[] = [];

      const config = new ConfigService<BackendEnvironment, true>({
        NODE_ENV: 'test',
        SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-bootstrap-service-token',
        SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
        AI_CONFIGURATION_CAMERA_IDS: options.allowCamera === false ? [] : [cameraId],
        SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
          {
            id: 'edge',
            label: 'Synthetic Edge Host',
            siteIds: [siteId, requestSiteId],
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
              roleAssignments: [
                { role: options.role ?? UserRole.SITE_MANAGER, siteId: requestSiteId },
              ],
            },
          };
        },
      } as unknown as AuthService;
      const sites = new SiteConfigurationService(db);
      const zones = new ZoneConfigurationService(db, sites);
      const cameras = new CameraConfigurationService(db, zones, sites);

      const fetcher = (async (url, init) => {
        const pathname = new URL(String(url)).pathname;
        const suffix = pathname.split('/').at(-1)!;
        calls.push(suffix);
        assert.equal(
          new Headers(init?.headers).get('Authorization'),
          'Bearer synthetic-bootstrap-service-token',
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        if (suffix === 'prepare') {
          prepareCalls++;
          if (options.prepareDelayMs) await delay(options.prepareDelayMs);
          if (options.revokeAfterPrepare) permitted = false;
          if (options.prepareState)
            return Response.json(options.prepareState(String(body.commandId)));
          if (committedGeneration) {
            return Response.json({
              schemaVersion: '1.0.0',
              state: 'RUNNING',
              commandId: body.commandId,
              sourceRevision: 1,
              sourceKind: 'LIVE',
              currentGenerationId: committedGeneration.workerGenerationId,
            });
          }
          return Response.json({
            schemaVersion: '1.1.0',
            state: 'PREPARED',
            commandId: body.commandId,
            sourceRevision: 0,
            sourceKind: 'LIVE',
            currentGenerationId: null,
          });
        }
        assert.equal(suffix, 'commit');
        commitCalls++;
        const generation = body.generation as typeof committedGeneration;
        assert.ok(
          generation && typeof generation.secret === 'string' && generation.secret.length === 43,
        );
        if (options.failCommitStatus) {
          return Response.json({ code: 'COMMIT_FAILED' }, { status: options.failCommitStatus });
        }
        committedGeneration = generation;
        return Response.json({
          schemaVersion: '1.0.0',
          state: 'RUNNING',
          commandId: body.commandId,
          sourceRevision: options.commitRevision ?? 1,
          sourceKind: 'LIVE',
          currentGenerationId: generation.workerGenerationId,
        });
      }) as typeof fetch;

      const rows = () =>
        db.query<
          Array<{
            id: string;
            stream_session_id: string;
            is_current: boolean;
            superseded_at: Date | null;
            revoked_at: Date | null;
          }>
        >(
          'SELECT id,stream_session_id,is_current,superseded_at,revoked_at FROM camera_worker_generation WHERE camera_id=$1 ORDER BY issued_at,id',
          [cameraId],
        );

      return {
        siteId,
        requestSiteId,
        cameraId,
        externalId,
        service: new CameraSourceService(config, auth, cameras, fetcher, db),
        calls,
        rows,
        counts: () => ({ prepareCalls, commitCalls }),
        committedGeneration: () => committedGeneration,
      };
    }

    await t.test(
      'fresh unowned ACTIVE ZONE camera issues once, leaks no secret, and RUNNING retry issues nothing',
      async () => {
        const f = await setup();
        assert.equal((await f.rows()).length, 0);
        const command = {
          commandId: randomUUID(),
          receiptId: randomUUID(),
          expectedRevision: 0,
        };

        const first = await f.service.apply(
          'synthetic-user-token',
          f.siteId,
          f.cameraId,
          'edge',
          command,
        );
        assert.equal(first.state, 'RUNNING');
        assert.equal(first.commandId, command.commandId);
        assert.equal(first.sourceRevision, 1);
        assert.equal(first.sourceKind, 'LIVE');
        assert.doesNotMatch(JSON.stringify(first), /secret|token/);

        const issued = await f.rows();
        assert.equal(issued.length, 1);
        assert.equal(issued[0]!.id, first.currentGenerationId);
        assert.equal(issued[0]!.is_current, true);
        assert.equal(issued[0]!.superseded_at, null);
        assert.equal(issued[0]!.revoked_at, null);

        const retry = await f.service.apply(
          'synthetic-user-token',
          f.siteId,
          f.cameraId,
          'edge',
          command,
        );
        assert.deepEqual(retry, first);
        assert.equal((await f.rows()).length, 1);
        assert.deepEqual(f.counts(), { prepareCalls: 2, commitCalls: 1 });
      },
    );

    for (const variant of ['current', 'expired', 'revoked'] as const) {
      await t.test(
        `unowned apply denies ${variant} unsuperseded owner without replacement`,
        async () => {
          const f = await setup();
          const existing = await bootstrapCameraWorkerGeneration(
            db,
            f.cameraId,
            [f.cameraId],
            variant === 'expired' ? 1000 : 60000,
          );
          if (variant === 'expired') {
            await delay(Math.max(0, Date.parse(existing.expiresAt) - Date.now() + 100));
          } else if (variant === 'revoked') {
            await revokeCameraWorkerGeneration(
              db,
              f.cameraId,
              [f.cameraId],
              existing.workerGenerationId,
            );
          }
          const before = await f.rows();
          await assert.rejects(
            f.service.apply('synthetic-user-token', f.siteId, f.cameraId, 'edge', {
              commandId: randomUUID(),
              receiptId: randomUUID(),
              expectedRevision: 0,
            }),
            (e) => e instanceof PublicHttpException && e.getStatus() === 409,
          );
          assert.equal(f.counts().commitCalls, 0);
          assert.deepEqual(await f.rows(), before);
        },
      );
    }

    await t.test(
      'revoked authority after prepare and failed commit remain fail closed without replacement',
      async () => {
        const revoked = await setup({ revokeAfterPrepare: true });
        await assert.rejects(
          revoked.service.apply('synthetic-user-token', revoked.siteId, revoked.cameraId, 'edge', {
            commandId: randomUUID(),
            receiptId: randomUUID(),
            expectedRevision: 0,
          }),
          (e) => e instanceof PublicHttpException && e.getStatus() === 403,
        );
        assert.equal((await revoked.rows()).length, 0);
        assert.equal(revoked.counts().commitCalls, 0);

        const failedCommit = await setup({ failCommitStatus: 504 });
        await assert.rejects(
          failedCommit.service.apply(
            'synthetic-user-token',
            failedCommit.siteId,
            failedCommit.cameraId,
            'edge',
            {
              commandId: randomUUID(),
              receiptId: randomUUID(),
              expectedRevision: 0,
            },
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 504,
        );
        const retained = await failedCommit.rows();
        assert.equal(retained.length, 1);

        await assert.rejects(
          failedCommit.service.apply(
            'synthetic-user-token',
            failedCommit.siteId,
            failedCommit.cameraId,
            'edge',
            {
              commandId: randomUUID(),
              receiptId: randomUUID(),
              expectedRevision: 0,
            },
          ),
          (e) => e instanceof PublicHttpException && e.getStatus() === 409,
        );
        assert.deepEqual(await failedCommit.rows(), retained);
      },
    );

    await t.test(
      'cross-Site, allowlist, host allowlist, GATE, INACTIVE, and role boundaries remain unchanged',
      async () => {
        const cases: Array<{
          name: string;
          opts: HarnessOptions;
          hostId?: string;
          status: number;
        }> = [
          {
            name: 'cross-Site',
            opts: { targetSiteId: randomUUID() },
            status: 404,
          },
          {
            name: 'camera outside allowlist',
            opts: { allowCamera: false },
            status: 404,
          },
          {
            name: 'unknown host',
            opts: {},
            hostId: 'foreign-host',
            status: 404,
          },
          {
            name: 'non-manager role',
            opts: { role: UserRole.SAFETY_OFFICER },
            status: 403,
          },
          {
            name: 'GATE camera',
            opts: { cameraType: 'GATE' },
            status: 409,
          },
          {
            name: 'INACTIVE camera',
            opts: { cameraStatus: 'INACTIVE' },
            status: 409,
          },
        ];

        for (const item of cases) {
          const f = await setup(item.opts);
          await assert.rejects(
            f.service.apply(
              'synthetic-user-token',
              f.requestSiteId,
              f.cameraId,
              item.hostId ?? 'edge',
              {
                commandId: randomUUID(),
                receiptId: randomUUID(),
                expectedRevision: 0,
              },
            ),
            (e) => e instanceof PublicHttpException && e.getStatus() === item.status,
            item.name,
          );
          assert.equal((await f.rows()).length, 0, `${item.name} must create zero generations`);
          assert.equal(f.counts().commitCalls, 0, `${item.name} must not commit`);
        }
      },
    );

    await t.test(
      'existing owned v1.0 renewal still supersedes old owner and retires current views',
      async () => {
        const existingIdRef: { id?: string } = {};
        const f = await setup({
          commitRevision: 2,
          prepareState: (commandId) => ({
            schemaVersion: '1.0.0',
            state: 'PREPARED',
            commandId,
            sourceRevision: 1,
            sourceKind: 'LIVE',
            currentGenerationId: existingIdRef.id!,
          }),
        });
        const initial = await bootstrapCameraWorkerGeneration(db, f.cameraId, [f.cameraId], 60000);
        existingIdRef.id = initial.workerGenerationId;
        await db.query(
          `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
           VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
          [f.cameraId, f.siteId, initial.streamSessionId],
        );

        const renewed = await f.service.apply(
          'synthetic-user-token',
          f.siteId,
          f.cameraId,
          'edge',
          {
            commandId: randomUUID(),
            receiptId: randomUUID(),
            expectedRevision: 1,
          },
        );
        assert.notEqual(renewed.currentGenerationId, initial.workerGenerationId);
        assert.equal(renewed.sourceRevision, 2);

        const [retiredView] = await db.query<
          Array<{ is_current: boolean; retired_at: Date | null }>
        >(
          'SELECT is_current,retired_at FROM camera_view_revision WHERE camera_id=$1 AND revision=1',
          [f.cameraId],
        );
        assert.equal(retiredView!.is_current, false);
        assert.ok(retiredView!.retired_at instanceof Date);
      },
    );

    await t.test(
      'stale revision, v1.0 null owner, v1.1 nonzero/RUNNING/REPLAY/extra fields never issue',
      async () => {
        for (const [label, expectedRevision, makePrepared] of [
          [
            'stale nonzero revision',
            0,
            (commandId: string) => ({
              schemaVersion: '1.1.0',
              state: 'PREPARED',
              commandId,
              sourceRevision: 1,
              sourceKind: 'LIVE',
              currentGenerationId: null,
            }),
          ],
          [
            'v1.0 null owner',
            0,
            (commandId: string) => ({
              schemaVersion: '1.0.0',
              state: 'PREPARED',
              commandId,
              sourceRevision: 0,
              sourceKind: 'LIVE',
              currentGenerationId: null,
            }),
          ],
          [
            'v1.1 RUNNING variant',
            0,
            (commandId: string) => ({
              schemaVersion: '1.1.0',
              state: 'RUNNING',
              commandId,
              sourceRevision: 0,
              sourceKind: 'LIVE',
              currentGenerationId: null,
            }),
          ],
          [
            'v1.1 RUNNING with real uuid',
            0,
            (commandId: string) => ({
              schemaVersion: '1.1.0',
              state: 'RUNNING',
              commandId,
              sourceRevision: 1,
              sourceKind: 'LIVE',
              currentGenerationId: randomUUID(),
            }),
          ],
          [
            'v1.1 REPLAY sourceKind',
            0,
            (commandId: string) => ({
              schemaVersion: '1.1.0',
              state: 'PREPARED',
              commandId,
              sourceRevision: 0,
              sourceKind: 'REPLAY',
              currentGenerationId: null,
            }),
          ],
          [
            'v1.1 extra field',
            0,
            (commandId: string) => ({
              schemaVersion: '1.1.0',
              state: 'PREPARED',
              commandId,
              sourceRevision: 0,
              sourceKind: 'LIVE',
              currentGenerationId: null,
              permission: 'BOOTSTRAP',
            }),
          ],
        ] as const) {
          const f = await setup({ prepareState: makePrepared });
          await assert.rejects(
            f.service.apply('synthetic-user-token', f.siteId, f.cameraId, 'edge', {
              commandId: randomUUID(),
              receiptId: randomUUID(),
              expectedRevision,
            }),
            label,
          );
          assert.equal((await f.rows()).length, 0, label);
          assert.equal(f.counts().commitCalls, 0, label);
        }
      },
    );

    await t.test(
      'concurrent unowned apply calls yield one winner under advisory lock without double issuance',
      async () => {
        const f = await setup({ prepareDelayMs: 50 });
        const results = await Promise.allSettled([
          f.service.apply('synthetic-user-token', f.siteId, f.cameraId, 'edge', {
            commandId: randomUUID(),
            receiptId: randomUUID(),
            expectedRevision: 0,
          }),
          f.service.apply('synthetic-user-token', f.siteId, f.cameraId, 'edge', {
            commandId: randomUUID(),
            receiptId: randomUUID(),
            expectedRevision: 0,
          }),
        ]);
        const fulfilled = results.filter((r) => r.status === 'fulfilled');
        const rejected = results.filter((r) => r.status === 'rejected');
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        const loser = rejected[0]!.reason;
        assert.ok(loser instanceof PublicHttpException && loser.getStatus() === 409);
        assert.equal((await f.rows()).length, 1);
        assert.equal(f.counts().commitCalls, 1);
      },
    );
  } finally {
    await owned.dispose();
  }
});

test('bootstrapped NULL-route generation claims EPISODE_TRACKED epoch and 1.7.0 wire via existing authenticated DB triggers', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  let cli: DataSource | undefined;
  try {
    await owned.initialize();
    cli = new DataSource(
      buildMigrationOptions(
        { DATABASE_URL: resolveTestDatabaseUrl() },
        { profile: 'tracked-v17-identification-ppe', schema: db.driver.schema! },
      ),
    );
    await cli.initialize();
    await cli.runMigrations();

    const siteId = randomUUID();
    const cameraId = randomUUID();
    const routeEpoch = '00000000-0000-4000-8000-000000000017';
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Tracked Bootstrap Site')",
      [siteId],
    );
    await db.query(
      "INSERT INTO camera(type,status,id,site_id,external_id,code,name) VALUES('ZONE','ACTIVE',$1,$2,$1::uuid::text,$1::uuid::text,'Tracked Bootstrap Camera')",
      [cameraId, siteId],
    );

    const captured: {
      generation?: {
        workerGenerationId: string;
        streamSessionId: string;
        secret: string;
        expiresAt: string;
      };
    } = {};
    const config = new ConfigService<BackendEnvironment, true>({
      NODE_ENV: 'test',
      SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-tracked-bootstrap-token',
      SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
      AI_CONFIGURATION_CAMERA_IDS: [cameraId],
      SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
        {
          id: 'edge',
          label: 'Synthetic Tracked Host',
          siteIds: [siteId],
          origin: 'http://127.0.0.1:62035',
        },
      ]),
    });
    const auth = {
      authenticate: async () => ({
        user: {
          mustChangePassword: false,
          roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
        },
      }),
    } as unknown as AuthService;
    const sites = new SiteConfigurationService(db);
    const zones = new ZoneConfigurationService(db, sites);
    const cameras = new CameraConfigurationService(db, zones, sites);
    const fetcher = (async (url, init) => {
      const suffix = new URL(String(url)).pathname.split('/').at(-1)!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (suffix === 'prepare') {
        return Response.json({
          schemaVersion: '1.1.0',
          state: 'PREPARED',
          commandId: body.commandId,
          sourceRevision: 0,
          sourceKind: 'LIVE',
          currentGenerationId: null,
        });
      }
      const generation = body.generation as NonNullable<typeof captured.generation>;
      captured.generation = generation;
      return Response.json({
        schemaVersion: '1.0.0',
        state: 'RUNNING',
        commandId: body.commandId,
        sourceRevision: 1,
        sourceKind: 'LIVE',
        currentGenerationId: generation.workerGenerationId,
      });
    }) as typeof fetch;

    const service = new CameraSourceService(config, auth, cameras, fetcher, db);
    const applied = await service.apply('synthetic-user-token', siteId, cameraId, 'edge', {
      commandId: randomUUID(),
      receiptId: randomUUID(),
      expectedRevision: 0,
    });
    const issued = captured.generation;
    assert.ok(issued);
    assert.equal(applied.currentGenerationId, issued.workerGenerationId);

    const [unclaimed] = await db.query<
      Array<{
        observation_route_mode: string | null;
        tracking_route_epoch: string | null;
        tracked_wire_version: string | null;
      }>
    >(
      'SELECT observation_route_mode,tracking_route_epoch,tracked_wire_version FROM camera_worker_generation WHERE id=$1',
      [issued.workerGenerationId],
    );
    assert.deepEqual(unclaimed, {
      observation_route_mode: null,
      tracking_route_epoch: null,
      tracked_wire_version: null,
    });

    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
       VALUES($1,1,$2,$3,'LIVE',120,80,'UNCONFIRMED',true,clock_timestamp())`,
      [cameraId, siteId, issued.streamSessionId],
    );
    await db.transaction(async (manager) => {
      await recordCameraConfigurationBundle(
        manager,
        await manager.getRepository(CameraEntity).findOneByOrFail({ id: cameraId }),
        {
          schemaVersion: '1.0.0',
          configurationVersion: 1,
          cameraExternalId: cameraId,
          regions: [],
        },
        zones,
      );
    });
    const bundleRows = await db.query<Array<{ bundle_sha256: string }>>(
      'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=1',
      [cameraId],
    );
    const bundleSha256 = bundleRows[0]!.bundle_sha256;
    const receiptCommandId = randomUUID();
    await recordCameraConfigurationAcknowledgement(db, cameraId, issued.secret, {
      commandId: receiptCommandId,
      workerGenerationId: issued.workerGenerationId,
      streamSessionId: issued.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      outcome: 'LOADED',
    });

    const authenticator = new TrackedPartAuthenticator(new CameraEventAdmissionService(), {
      wireVersion: '1.7.0',
      routeEpoch,
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [cameraId],
      clockToleranceMs: 5000,
    });
    const store = new TrackedFramePrototypeStore(authenticator, {
      pendingTtlMs: 30000,
      maxPendingFrames: 8,
      maxPendingParts: 16,
      maxPendingPayloadBytes: 100000,
    });
    const inbox = new TrackedPpeInboxProjection(db, { maxRecipients: 8 });
    const admission = new TrackedFrameAdmission(
      authenticator,
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

    const frameId = randomUUID();
    const context = {
      schemaVersion: '1.0.0',
      cameraId,
      workerGenerationId: issued.workerGenerationId,
      streamSessionId: issued.streamSessionId,
      configurationVersion: 1,
      bundleSha256,
      viewRevision: 1,
      receiptCommandId,
      sourceKind: 'LIVE',
    };
    const event = {
      schemaVersion: '1.7.0',
      eventId: randomUUID(),
      cameraExternalId: cameraId,
      streamSessionId: issued.streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 120, height: 80 },
      framePartition: { frameId, sequenceNumber: '0', partIndex: 0, partCount: 1 },
      observations: [],
      evidence: [],
      continuity: {
        schemaVersion: '1.0.0',
        profileSha256: 'a'.repeat(64),
        coverage: { status: 'COMPLETE' },
        subjects: [],
        retiredSegments: [],
      },
    };
    await store.store(db, event, context, issued.secret);
    const sealed = await admission.process(
      db,
      {
        cameraId,
        generationId: issued.workerGenerationId,
        streamSessionId: issued.streamSessionId,
        frameId,
      },
      issued.secret,
    );
    assert.equal(sealed.kind, 'SEALED');

    const [claimed] = await db.query<
      Array<{
        observation_route_mode: string | null;
        tracking_route_epoch: string | null;
        tracked_wire_version: string | null;
      }>
    >(
      'SELECT observation_route_mode,tracking_route_epoch,tracked_wire_version FROM camera_worker_generation WHERE id=$1',
      [issued.workerGenerationId],
    );
    assert.deepEqual(claimed, {
      observation_route_mode: 'EPISODE_TRACKED',
      tracking_route_epoch: routeEpoch,
      tracked_wire_version: '1.7.0',
    });
    assert.deepEqual(await admission.readCurrentScope(db, cameraId), {
      cameraId,
      generationId: issued.workerGenerationId,
      streamSessionId: issued.streamSessionId,
    });

    // Legacy emission without tracking_scope_sha256 must fail closed on the claimed EPISODE_TRACKED session.
    await assert.rejects(
      db.query(
        `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,received_at,raw_payload,processing_status)
         VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp(),'{"schemaVersion":"1.0.0"}'::jsonb,'PROCESSED')`,
        [randomUUID(), 'b'.repeat(64), cameraId, cameraId, issued.streamSessionId],
      ),
      /immutable/i,
    );
  } finally {
    if (cli?.isInitialized) await cli.destroy();
    await owned.dispose();
  }
});
