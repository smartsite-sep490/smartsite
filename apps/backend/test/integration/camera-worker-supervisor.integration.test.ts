import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';
import { operatorSupervisorPorts } from '../../src/scripts/camera-worker-supervisor-adapter.js';
import {
  superviseCameraWorker,
  workerChildEnvironment,
} from '../../src/scripts/camera-worker-supervisor.js';
import { recordCameraConfigurationAcknowledgement } from '../../src/modules/cameras/camera-configuration-acknowledgement.js';
import { recordCameraConfigurationBundle } from '../../src/modules/cameras/camera-configuration-bundles.js';
import { revokeCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const execute = promisify(execFile);
const status = (value: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === value;
const python = process.env.SUPERVISOR_TEST_PYTHON;

test(
  'trusted supervisor uses committed generations and retains a real one-time worker outbox',
  { skip: !python, timeout: 60000 },
  async () => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
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
            const body = {
              commandId: randomUUID(),
              workerGenerationId: credential.workerGenerationId,
              streamSessionId: credential.streamSessionId,
              configurationVersion: version,
              bundleSha256: bundle.bundle_sha256,
              viewRevision: version,
              outcome: 'LOADED',
            };
            await recordCameraConfigurationAcknowledgement(db, cameraId, credential.secret, body);
            acknowledgements.push(body);
            if (version === 2)
              await assert.rejects(
                recordCameraConfigurationAcknowledgement(
                  db,
                  cameraId,
                  credentials[0]!.secret,
                  acknowledgements[0],
                ),
                status(409),
              );
            const run = await execute(
              python!,
              ['-I', '-B', '-c', workerProbe, context.credentialFile, context.outboxPath],
              {
                windowsHide: true,
                env: workerChildEnvironment(process.env, {}),
                timeout: 5000,
                maxBuffer: 8192,
              },
            );
            const proof = JSON.parse(run.stdout);
            assert.equal(proof.pending, 1);
            assert.equal(proof.claims, version);
            pythonProofs.push(proof);
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
      await assert.rejects(
        recordCameraConfigurationAcknowledgement(
          db,
          cameraId,
          credentials[1]!.secret,
          acknowledgements[1],
        ),
        status(409),
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
        'SUPERVISOR_PG_PASS:two committed generations/two receipts/old+revoked ACK denied/inactive issuance denied/retained SQLite pending event',
      );
    } finally {
      await owned.dispose();
    }
  },
);

const workerProbe = String.raw`
import asyncio,json,sqlite3,sys
from pathlib import Path
from datetime import UTC,datetime
from uuid import UUID,uuid4
from smartsite_ai.integrations.worker_generation import load_worker_generation
from smartsite_ai.integrations.outbox import SqliteEventOutbox
from smartsite_ai.domain.observations import TechnicalObservationEvent
async def main():
 credential=Path(sys.argv[1]);outbox=Path(sys.argv[2]);raw=json.loads(credential.read_text())
 binding=load_worker_generation(credential,UUID(raw['cameraId']),now=datetime.now(UTC))
 queue=SqliteEventOutbox(outbox)
 await queue.claim_worker_session(UUID(binding.camera_id),UUID(binding.worker_generation_id),UUID(binding.stream_session_id))
 try:await queue.claim_worker_session(UUID(binding.camera_id),UUID(binding.worker_generation_id),UUID(binding.stream_session_id))
 except RuntimeError:pass
 else:raise AssertionError('duplicate generation claim accepted')
 record=outbox.with_suffix('.event.json')
 if not record.exists():
  event=TechnicalObservationEvent.create(event_id=str(uuid4()),camera_external_id='G4-FAKE',stream_session_id=binding.stream_session_id,captured_at=datetime.now(UTC).isoformat(timespec='milliseconds').replace('+00:00','Z'),frame_dimensions={'width':2,'height':2},observations=[{'type':'PERSON','trackId':1,'confidence':0.9,'boundingBox':{'x1':0.1,'y1':0.1,'x2':0.9,'y2':0.9,'coordinateSpace':'NORMALIZED_0_1'}}])
  await queue.enqueue(event)
  record.write_text(json.dumps({'eventId':str(event.event_id)}))
 counts=await queue.counts()
 pending=await queue.ready()
 assert len(pending)==1 and str(pending[0].event.event_id)==json.loads(record.read_text())['eventId']
 with sqlite3.connect(outbox) as connection:claims=connection.execute('SELECT count(*) FROM worker_session_claim').fetchone()[0]
 print(json.dumps({'claims':claims,'pending':counts.pending,'eventId':json.loads(record.read_text())['eventId']}))
asyncio.run(main())
`;
