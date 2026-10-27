import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { operatorSupervisorPorts } from '../../src/scripts/camera-worker-supervisor-adapter.js';
import {
  superviseCameraWorker,
  workerChildEnvironment,
} from '../../src/scripts/camera-worker-supervisor.js';
import { readCameraApplicationStatus } from '../../src/modules/cameras/camera-application-status.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { revokeCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { supervisorFakeWorker as workerProbe } from '../support/supervisor-fake-worker.js';

const execute = promisify(execFile);
const python = process.env.SUPERVISOR_TEST_PYTHON;

test(
  'trusted supervisor renews HTTP runtime ACKs and retains a real one-time worker outbox',
  { skip: !python, timeout: 60000 },
  async () => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let app: NestExpressApplication | undefined;
    try {
      await owned.initialize();
      assert.ok('schema' in db.options);
      const schema = String(db.options.schema);
      console.info(`SUPERVISOR_TEST_SCHEMA:${schema}`);
      assert.match(schema, /^isolated_test_[a-f0-9]{32}$/);
      const siteId = randomUUID(),
        cameraId = randomUUID();
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Supervisor fixture')",
        [siteId],
      );
      await db.query(
        "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Supervisor fixture')",
        [cameraId, siteId],
      );
      const dir = await mkdtemp(
        path.join(
          process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/runs' : tmpdir(),
          'g4-owned-',
        ),
      );
      const manifestFile = path.join(dir, 'unused-manifest.json');
      await writeFile(manifestFile, '{}');
      const outboxPath = path.join(dir, 'retained.sqlite3');
      const serviceToken = 'synthetic-supervisor-service-token-only';
      const config = new ConfigService<BackendEnvironment, true>(
        validateEnvironment({
          NODE_ENV: 'test',
          DATABASE_URL: resolveTestDatabaseUrl(),
          SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
          AI_CONFIGURATION_CAMERA_IDS: cameraId,
          MF06_ENQUEUE_ENABLED: 'false',
          MF06_ASSESSMENT_READ_ENABLED: 'false',
          STORAGE_LOCAL_ROOT: dir,
        }),
      );
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
        logger: false,
        bodyParser: false,
      });
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
      const acknowledge = (secret: string, body: unknown) =>
        fetch(`${origin}/api/v1/integrations/ai/cameras/${cameraId}/configuration-ack`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
            'x-worker-generation-secret': secret,
          },
          body: JSON.stringify(body),
        });
      const env = {
        ...process.env,
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: schema,
        AI_CONFIGURATION_CAMERA_IDS: cameraId,
      };
      const ports = await operatorSupervisorPorts(
        { pythonExecutable: python!, manifestFile, workingDirectory: dir, workerEnvironment: {} },
        env,
      );
      const options = {
        cameraId,
        allowedCameraIds: [cameraId],
        credentialDirectory: dir,
        outboxPath,
        databaseIdentity: `127.0.0.1:5433/smartsite_test/${schema}`,
        leaseMs: 60000,
        maximumStarts: 2,
      };
      const credentials: { workerGenerationId: string; streamSessionId: string; secret: string }[] =
        [];
      const acknowledgements: Record<string, unknown>[] = [];
      const outputs: string[] = [];
      const pythonProofs: { claims: number; pending: number; eventId: string }[] = [];
      const result = await superviseCameraWorker(
        options,
        {
          ...ports,
          backoff: async () => {},
          launch: async (context) => {
            outputs.push(context.credentialFile);
            const credential = JSON.parse(await readFile(context.credentialFile, 'utf8'));
            const [current] = await db.query(
              'SELECT id,stream_session_id,credential_sha256 FROM camera_worker_generation WHERE camera_id=$1 AND is_current',
              [cameraId],
            );
            assert.equal(current.id, credential.workerGenerationId);
            assert.equal(current.stream_session_id, credential.streamSessionId);
            assert.equal(
              current.credential_sha256,
              createHash('sha256').update(credential.secret).digest('hex'),
            );
            credentials.push(credential);
            const version = credentials.length;
            await db.transaction(async (manager) => {
              await manager.query(
                'UPDATE camera_view_revision SET is_current=false,retired_at=clock_timestamp() WHERE camera_id=$1 AND is_current',
                [cameraId],
              );
              await manager.query(
                `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at) VALUES($1,$2,$3,$4,'LIVE',64,64,'UNCONFIRMED',true,clock_timestamp())`,
                [cameraId, version, siteId, credential.streamSessionId],
              );
              await manager
                .getRepository(CameraEntity)
                .update({ id: cameraId }, { configurationVersion: version });
              const camera = await manager
                .getRepository(CameraEntity)
                .findOneByOrFail({ id: cameraId });
              await recordCameraConfigurationBundle(
                manager,
                camera,
                {
                  schemaVersion: '1.0.0',
                  configurationVersion: version,
                  cameraExternalId: cameraId,
                  regions: [],
                },
                new ZoneConfigurationService(db, new SiteConfigurationService(db)),
              );
            });
            const [bundle] = await db.query(
              'SELECT bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 AND configuration_version=$2',
              [cameraId, version],
            );
            const beforeFrame = await readCameraApplicationStatus(db, siteId, cameraId, 60000);
            assert.equal(beforeFrame.applicationState, 'UNCONFIRMED');
            assert.equal(beforeFrame.reasonCode, 'NO_APPLICATION_RECEIPT');
            if (version === 2)
              assert.equal(
                (await acknowledge(credentials[0]!.secret, acknowledgements[0])).status,
                409,
              );
            const run = await execute(
              python!,
              ['-I', '-B', '-c', workerProbe, context.credentialFile, context.outboxPath],
              {
                windowsHide: true,
                env: workerChildEnvironment(process.env, {
                  SMARTSITE_AI_BACKEND_SERVICE_TOKEN: serviceToken,
                  SMARTSITE_AI_BACKEND_INGESTION_URL: origin,
                }),
                timeout: 10000,
                maxBuffer: 8192,
              },
            );
            const proof = JSON.parse(run.stdout);
            assert.equal(proof.pending, 1);
            assert.equal(proof.claims, version);
            assert.equal(proof.preFrameAckCount, 0);
            assert.equal(proof.httpStatus, 200);
            assert.equal(proof.ack.workerGenerationId, credential.workerGenerationId);
            assert.equal(proof.ack.streamSessionId, credential.streamSessionId);
            assert.equal(proof.ack.configurationVersion, version);
            assert.equal(proof.ack.bundleSha256, bundle.bundle_sha256);
            assert.equal(proof.ack.viewRevision, version);
            acknowledgements.push(proof.ack);
            const application = await readCameraApplicationStatus(db, siteId, cameraId, 60000);
            assert.equal(application.applicationState, 'LOADED');
            assert.equal(application.viewValidity, 'UNCONFIRMED');
            pythonProofs.push(proof);
            // The helper exits cleanly; this fake port models a worker failure after its ACK.
            return {
              exited: Promise.resolve({ code: 1, termination: 'EXITED' as const }),
              stop: async () => {
                throw Error('fake worker already exited');
              },
            };
          },
        },
        new AbortController().signal,
      );
      assert.equal(result.starts, 2);
      assert.equal(result.status, 'EXHAUSTED');
      assert.equal(new Set(outputs).size, 2);
      assert.notEqual(credentials[0]!.streamSessionId, credentials[1]!.streamSessionId);
      assert.equal(pythonProofs[0]!.eventId, pythonProofs[1]!.eventId);
      const [receipts] = await db.query(
        'SELECT count(*)::int AS count FROM camera_configuration_application_receipt WHERE camera_id=$1',
        [cameraId],
      );
      assert.equal(receipts.count, 2);
      await revokeCameraWorkerGeneration(
        db,
        cameraId,
        [cameraId],
        credentials[1]!.workerGenerationId,
      );
      assert.equal((await acknowledge(credentials[1]!.secret, acknowledgements[1])).status, 409);
      assert.equal(
        (await readCameraApplicationStatus(db, siteId, cameraId, 60000)).applicationState,
        'STALE',
      );
      await db.query("UPDATE camera SET status='INACTIVE' WHERE id=$1", [cameraId]);
      await assert.rejects(
        superviseCameraWorker(
          { ...options, maximumStarts: 1 },
          ports,
          new AbortController().signal,
        ),
        /operator reconciliation/,
      );
      const [generations] = await db.query(
        'SELECT count(*)::int AS count FROM camera_worker_generation WHERE camera_id=$1',
        [cameraId],
      );
      assert.equal(generations.count, 2);
      console.info(
        'SUPERVISOR_PG_PASS:two committed generations/two HTTP runtime receipts/old+revoked HTTP ACK denied/inactive issuance denied/retained SQLite pending event',
      );
    } finally {
      try {
        await app?.close();
      } finally {
        await owned.dispose();
      }
    }
  },
);
