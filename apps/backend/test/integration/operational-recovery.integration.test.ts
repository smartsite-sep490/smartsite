import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import sharp from 'sharp';
import { DataSource } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { syntheticJpeg } from '../support/synthetic-jpeg.js';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import {
  loadMainRecoveryMigrations,
  seedCompletedRecoveryAssessment,
} from '../support/main-recovery-profile.js';

const pgBin = process.env.SMARTSITE_TEST_PG_BIN;
const mainSnapshot = process.env.SMARTSITE_TEST_MAIN_SNAPSHOT;
const sourceRepository = process.env.SMARTSITE_TEST_SOURCE_REPO;
const linuxImage = process.env.SMARTSITE_TEST_LINUX_RECOVERY_IMAGE;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function recoveryScenario(main37 = false, linux = false) {
  return async (t: TestContext) => {
    assert.ok(pgBin && isAbsolute(pgBin));
    const url = new URL(resolveTestDatabaseUrl());
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '5433');
    assert.equal(url.username, 'smartsite_test');
    assert.equal(url.pathname, '/smartsite_test');
    const executable = (name: string) =>
      join(pgBin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    assert.match(
      execFileSync(executable('pg_dump'), ['--version'], { encoding: 'utf8', windowsHide: true }),
      /PostgreSQL/,
    );
    const isolated = createIsolatedTestDatabase({ canonical: true });
    const db = isolated.dataSource;
    const ownSchema = db.options.type === 'postgres' ? db.options.schema : undefined;
    assert.ok(ownSchema && /^isolated_test_[a-f0-9]{32}$/.test(ownSchema));
    const apiConnectionTag = `recovery-api-${ownSchema.slice(-32)}`;
    const fixtureConnectionTag = `recovery-db-${ownSchema.slice(-32)}`;
    if (db.options.type === 'postgres')
      db.setOptions({ extra: { ...db.options.extra, application_name: fixtureConnectionTag } });
    if (main37) {
      assert.ok(sourceRepository && mainSnapshot);
      db.setOptions({
        migrations: await loadMainRecoveryMigrations(sourceRepository, mainSnapshot),
      });
    }
    const control = new DataSource({ type: 'postgres', url: url.toString() });
    const root = await mkdtemp(join(tmpdir(), 'smartsite-recovery-'));
    const linuxContainers: { name: string; id: string; exitCode?: number; elapsedMs?: number }[] =
      [];
    let currentContainer: (typeof linuxContainers)[number] | undefined;
    const docker = (args: string[]) =>
      execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    if (linux) {
      assert.match(linuxImage!, /^sha256:[a-f0-9]{64}$/);
      const image = JSON.parse(docker(['image', 'inspect', linuxImage!, '--format', '{{json .}}']));
      assert.equal(image.Id, linuxImage);
      assert.equal(image.Config.User, 'node');
      assert.deepEqual(image.Config.Cmd, ['node', 'qualified-dist/main.js']);
    }
    const sourceMedia = join(root, 'source-media');
    const backupMedia = join(root, 'backup-media');
    const restoredMedia = join(root, 'restored-media');
    for (const directory of [sourceMedia, backupMedia, restoredMedia]) await mkdir(directory);
    const children: { process: ChildProcess; exited: Promise<void> }[] = [];
    let logs = '';
    const secrets: string[] = [];
    async function stop(owned: (typeof children)[number]) {
      const container = linuxContainers[children.indexOf(owned)];
      if (linux) {
        assert.ok(container);
        let state = JSON.parse(docker(['inspect', container.name, '--format', '{{json .}}']));
        assert.equal(state.Id, container.id);
        assert.equal(state.Image, linuxImage);
        const started = Date.now();
        if (state.State.Running) docker(['kill', '--signal=SIGTERM', container.name]);
        for (let attempt = 0; state.State.Running && attempt < 320; attempt++) {
          await delay(100);
          state = JSON.parse(docker(['inspect', container.name, '--format', '{{json .}}']));
        }
        assert.equal(state.State.Running, false, 'Owned Linux runtime still live; schema retained');
        assert.equal(state.State.ExitCode, 0);
        assert.equal(state.State.OOMKilled, false);
        if (container.exitCode === undefined) {
          container.exitCode = state.State.ExitCode;
          container.elapsedMs = Date.now() - started;
          assert.ok(container.elapsedMs <= 30_000, 'Actual owned SIGTERM exceeds process target');
        }
        await owned.exited;
        return;
      }
      if (owned.process.exitCode === null && owned.process.signalCode === null)
        owned.process.kill();
      await Promise.race([
        owned.exited,
        delay(5_000, undefined, { ref: false }).then(() => {
          throw new Error('Owned API still live; schema retained');
        }),
      ]);
    }
    t.after(async () => {
      for (const child of children) await stop(child);
      if (control.isInitialized) await control.destroy();
      await isolated.dispose();
      assert.equal(
        secrets.some((value) => logs.includes(value)),
        false,
        'No secret inputs in logs',
      );
      // Retain all D-only synthetic media/dump/manifest artifacts, including corruption controls.
    });
    await isolated.initialize();
    if (linux)
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM migrations'))[0].n), 39);
    let missingRuntimeMigrations: string[] = [];
    if (main37) {
      assert.equal(
        Number((await db.query('SELECT count(*) AS n FROM migrations'))[0].n),
        37,
        'Recovery must exercise the approved MAIN35 + request0001 + immutable0004 schema',
      );
      const applied = new Set(
        (await db.query('SELECT name FROM migrations')).map((row: { name: string }) => row.name),
      );
      const registered = buildTypeOrmOptions({ DATABASE_URL: url.toString() }).migrations;
      assert.ok(Array.isArray(registered));
      missingRuntimeMigrations = registered
        .map((migration) => {
          assert.equal(typeof migration, 'function');
          return (migration as new () => { name: string }).prototype.constructor.name;
        })
        .filter((name) => !applied.has(name));
      assert.deepEqual(missingRuntimeMigrations, [
        'Mf06MainAuthorityJournal1791590400002',
        'SafetyFaceProvenance1791590400003',
      ]);
    }
    await control.initialize();
    const schema = db.driver.schema;
    assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
    assert.equal((await db.query('SELECT current_schema() AS schema'))[0].schema, schema);
    assert.equal(
      (await control.query("SELECT to_regclass('public.app_user') IS NULL AS absent"))[0].absent,
      true,
    );
    const runtimeUrl = new URL(url);
    runtimeUrl.searchParams.set('options', `-c search_path=${schema}`);
    runtimeUrl.searchParams.set('application_name', apiConnectionTag);
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const address = listener.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = 'http://127.0.0.1:5173';
    const env = {
      ...Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: runtimeUrl.toString(),
      DATABASE_TIMEOUT_MS: '2000',
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
      SMARTSITE_AI_SERVICE_TOKEN: randomBytes(32).toString('hex'),
      SMARTSITE_AI_PREVIEW_SOURCES: '{}',
      EVIDENCE_LOCAL_ROOT: sourceMedia,
      CORS_ORIGINS: origin,
      LOG_FORMAT: 'json',
      LOG_LEVEL: 'info',
      MF06_ASSESSMENT_READ_ENABLED: 'true',
      MF06_ENQUEUE_ENABLED: 'false',
    };
    const initial = `Initial-${randomBytes(16).toString('hex')}!`,
      changed = `Changed-${randomBytes(16).toString('hex')}!`;
    secrets.push(
      initial,
      changed,
      url.password,
      url.toString(),
      runtimeUrl.toString(),
      env.AUTH_JWT_SECRET,
      env.SMARTSITE_AI_SERVICE_TOKEN,
    );
    const username = `restore-${randomBytes(6).toString('hex')}`;
    logs += execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../src/scripts/bootstrap-admin.js', import.meta.url))],
      {
        env: {
          ...env,
          BOOTSTRAP_ADMIN_USERNAME: username,
          BOOTSTRAP_ADMIN_DISPLAY_NAME: 'Synthetic restore Admin',
          BOOTSTRAP_ADMIN_PASSWORD: initial,
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    const base = `http://127.0.0.1:${port}/api/v1`;
    async function request(
      route: string,
      expected = 200,
      body?: unknown,
      token?: string,
      method = body === undefined ? 'GET' : 'POST',
      cookie?: string,
    ) {
      if (linux) {
        assert.ok(currentContainer);
        // Internal API requests, never a browser-policy workaround. Private input only on stdin.
        const program = `const fs=require('node:fs');(async()=>{const i=JSON.parse(fs.readFileSync(0,'utf8'));const r=await fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1'+i.route,{method:i.method,headers:{Origin:i.origin,...(i.token?{Authorization:'Bearer '+i.token}:{}),...(i.cookie?{Cookie:i.cookie}:{}),...(i.body===undefined?{}:{'Content-Type':'application/json'})},body:i.body===undefined?undefined:JSON.stringify(i.body),signal:AbortSignal.timeout(5000)});console.log(JSON.stringify({status:r.status,headers:[...r.headers],bytes:Buffer.from(await r.arrayBuffer()).toString('base64')}));})().catch(()=>{process.exitCode=1;console.log('OWNED_HTTP_REQUEST_FAILED')});`;
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn(
            'docker',
            ['exec', '-i', currentContainer!.name, 'node', '-e', program],
            {
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          let stdout = '';
          child.stdout!.on('data', (data) => (stdout += data.toString()));
          child.stderr!.resume();
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0 ? resolve(stdout) : reject(new Error('Owned HTTP observer failed')),
          );
          child.stdin!.end(JSON.stringify({ route, method, body, token, origin, cookie }));
        });
        const wire = JSON.parse(output);
        assert.equal(wire.status, expected, `${method} ${route}`);
        return new Response(wire.bytes ? Buffer.from(wire.bytes, 'base64') : null, {
          status: wire.status,
          headers: wire.headers,
        });
      }
      const response = await fetch(`${base}${route}`, {
        method,
        signal: AbortSignal.timeout(5_000),
        headers: {
          Origin: origin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, expected, `${method} ${route}`);
      return response;
    }
    async function start(media: string) {
      if (linux) {
        const name = `smartsite-linux-recovery-${randomBytes(8).toString('hex')}`;
        const containerUrl = new URL(runtimeUrl);
        containerUrl.hostname = 'host.docker.internal';
        const envFile = join(root, `${name}.private.env`);
        const privateEnv = {
          // Keep the image's Linux PATH/entrypoint; native Windows environment is not portable.
          ...Object.fromEntries(
            Object.entries(env).filter(
              ([key]) => !['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].includes(key),
            ),
          ),
          DATABASE_URL: containerUrl.toString(),
          EVIDENCE_LOCAL_ROOT: '/var/lib/smartsite/evidence',
        };
        secrets.push(containerUrl.toString());
        await writeFile(
          envFile,
          Object.entries(privateEnv)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n') + '\n',
          { flag: 'wx' },
        );
        const id = docker([
          'create',
          '--pull=never',
          '--name',
          name,
          '--label',
          'smartsite.owner=root',
          '--label',
          'smartsite.task=mf05-mf06-software',
          '--read-only',
          '--user',
          'node',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--pids-limit',
          '128',
          '--memory',
          '384m',
          '--stop-timeout',
          '45',
          '--env-file',
          envFile,
          '--mount',
          `type=bind,source=${media},target=/var/lib/smartsite/evidence,readonly`,
          linuxImage!,
        ]).trim();
        const inspected = JSON.parse(docker(['inspect', name, '--format', '{{json .}}']));
        assert.equal(inspected.Id, id);
        assert.equal(inspected.Image, linuxImage);
        assert.equal(inspected.Config.User, 'node');
        assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
        assert.equal(Object.keys(inspected.HostConfig.PortBindings ?? {}).length, 0);
        assert.equal(inspected.Mounts.length, 1);
        assert.equal(inspected.Mounts[0].RW, false);
        currentContainer = { name, id };
        linuxContainers.push(currentContainer);
      }
      const child = spawn(
        linux ? 'docker' : process.execPath,
        linux
          ? ['start', '-a', currentContainer!.name]
          : [fileURLToPath(new URL('../../src/main.js', import.meta.url))],
        {
          env: { ...env, EVIDENCE_LOCAL_ROOT: media },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      const owned = {
        process: child,
        exited: new Promise<void>((resolve, reject) => {
          child.once('exit', () => resolve());
          child.once('error', reject);
        }),
      };
      children.push(owned);
      child.stdout!.on('data', (data) => {
        logs += data.toString();
      });
      child.stderr!.on('data', (data) => {
        logs += data.toString();
      });
      for (let i = 0; i < 60; i++) {
        assert.equal(child.exitCode, null, 'Main exited during startup');
        try {
          // This is an operational restore drill, not production adoption of MAIN.
          // Incomplete historical MAIN37 is unready for the canonical MAIN39 release.
          await request('/health/live');
          await request('/health/ready', main37 ? 503 : 200);
          return owned;
        } catch {
          await delay(100);
        }
      }
      throw new Error('Actual main liveness/readiness-boundary deadline exceeded');
    }
    const first = await start(sourceMedia);
    const login = async (password: string) => {
      const result = await (
        await request('/auth/login', 200, { username, password, clientType: 'WEB' })
      ).json();
      secrets.push(result.accessToken);
      return result.accessToken as string;
    };
    let token = await login(initial);
    await request(
      '/auth/change-password',
      204,
      { currentPassword: initial, newPassword: changed },
      token,
    );
    token = await login(changed);
    const create = async (route: string, body: unknown) =>
      (await request(route, 201, body, token)).json();
    const site = await create('/sites', { code: username, name: 'Synthetic recovery Site' });
    const otherSite = await create('/sites', {
      code: `${username}-other`,
      name: 'Synthetic other Site',
    });
    const camera = await create(`/sites/${site.id}/cameras`, {
      code: 'RESTORE',
      externalId: username,
      name: 'Synthetic metadata Camera',
    });
    const zone = await create(`/sites/${site.id}/zones`, {
      code: 'RESTORE',
      name: 'Synthetic recovery Zone',
      type: 'STANDARD',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT'],
    });
    const { region } = await create(`/sites/${site.id}/cameras/${camera.id}/regions`, {
      zoneId: zone.id,
      expectedConfigurationVersion: 1,
      polygon: {
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      },
    });
    const references: {
      eventId: string;
      alertId: string;
      path: string;
      filename: string;
      digest: string;
      payloadHash: string;
    }[] = [];
    for (let i = 0; i < 2; i++) {
      const eventId = randomUUID(),
        sessionId = randomUUID();
      const filename = `${sessionId}_1_${eventId}.jpg`;
      const image =
        i === 0
          ? syntheticJpeg
          : await sharp({
              create: {
                width: 64,
                height: 64,
                channels: 3,
                background: { r: 15, g: 100, b: 180 },
              },
            })
              .jpeg()
              .toBuffer();
      await writeFile(join(sourceMedia, filename), image);
      const event = {
        eventId,
        schemaVersion: '1.0.0',
        cameraExternalId: camera.externalId,
        streamSessionId: sessionId,
        capturedAt: new Date().toISOString(),
        frameDimensions: { width: 64, height: 64 },
        observations: [
          {
            type: 'PERSON',
            trackId: 7 + i,
            confidence: 0.95,
            boundingBox: {
              x1: 0.1,
              y1: 0.1,
              x2: 0.9,
              y2: 0.9,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
          {
            type: 'PPE',
            trackId: 7 + i,
            ppeItem: 'HARD_HAT',
            status: 'MISSING',
            regionId: region.id,
            geometryVersion: region.version,
            confidence: 0.9,
          },
          ...[
            {
              type: 'ZONE_ENTRY',
              trackId: 7 + i,
              confidence: 0.9,
              regionId: region.id,
              geometryVersion: region.version,
            },
          ],
        ],
        evidence: [{ kind: 'FRAME', uri: `local://evidence/${sessionId}/1/${eventId}.jpg` }],
      };
      // Synthetic transport fixture, no model/capture/Face/worker or human GT.
      const ingested = await (
        await request('/integrations/ai/events', 202, event, env.SMARTSITE_AI_SERVICE_TOKEN)
      ).json();
      assert.equal(ingested.status, 'PROCESSED');
      assert.equal(ingested.alertIds.length, 1);
      const path = `/sites/${site.id}/safety-alerts/${ingested.alertIds[0]}/detections/${eventId}/evidence/0`;
      const bytes = Buffer.from(await (await request(path, 200, undefined, token)).arrayBuffer());
      assert.deepEqual(bytes, image);
      references.push({
        eventId,
        alertId: ingested.alertIds[0],
        path,
        filename,
        digest: hash(bytes),
        payloadHash: computeCanonicalPayloadHash(event),
      });
    }
    let manual:
      | {
          route: string;
          command: Record<string, unknown>;
          original: unknown;
          safetyToken: string;
          cookie: string;
        }
      | undefined;
    if (linux) {
      const safetyUsername = `${username}-safety`;
      await create('/users', {
        username: safetyUsername,
        displayName: 'Synthetic recovery Safety Officer',
        temporaryPassword: initial,
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }],
      });
      const safetyLogin = await request('/auth/login', 200, {
        username: safetyUsername,
        password: initial,
        clientType: 'WEB',
      });
      const temporaryToken = (await safetyLogin.json()).accessToken;
      secrets.push(temporaryToken);
      await request(
        '/auth/change-password',
        204,
        { currentPassword: initial, newPassword: changed },
        temporaryToken,
      );
      const safetySession = await request('/auth/login', 200, {
        username: safetyUsername,
        password: changed,
        clientType: 'WEB',
      });
      const safetyToken = (await safetySession.json()).accessToken;
      const cookie = safetySession.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie, 'WEB session must provide its refresh cookie');
      secrets.push(cookie);
      secrets.push(safetyToken);
      const worker = await create(`/sites/${site.id}/workers`, {
        externalId: 'SYNTHETIC-RESTORE-WORKER',
        displayName: 'Synthetic manual reference only',
      });
      const event = references[0]!;
      const route = `/sites/${site.id}/safety-alerts/${event.alertId}/detections/${event.eventId}/identity-subjects/0/decisions`;
      const command = {
        commandId: randomUUID(),
        expectedRevision: 0,
        expectedEventHash: event.payloadHash,
        action: 'RESOLVE',
        reason: 'Synthetic recovery exact-subject decision control.',
        workerId: worker.id,
        evidenceIndex: 0,
        expectedEvidenceSha256: event.digest,
      };
      await request(route, 403, command, token);
      const original = await (await request(route, 201, command, safetyToken)).json();
      assert.equal(original.replayed, false);
      assert.equal(original.latestRevision, 1);
      manual = { route, command, original: original.recordedDecision, safetyToken, cookie };
    }
    const completed = await seedCompletedRecoveryAssessment(db, {
      siteId: site.id,
      zoneId: zone.id,
      cameraId: camera.id,
      regionId: region.id,
      eventId: references[0]!.eventId,
    });
    assert.ok(
      Number(
        (
          await control.query(
            'SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1',
            [apiConnectionTag],
          )
        )[0].n,
      ) > 0,
      'Actual runtime connections carry the owned fixture tag',
    );
    assert.equal(
      (await db.query('SHOW application_name'))[0].application_name,
      fixtureConnectionTag,
    );
    // Verified quiesce of every fixture writer: direct API child terminal before DB/media snapshot.
    await stop(first);
    assert.notEqual(first.process.exitCode === null && first.process.signalCode === null, true);
    let active = 1;
    for (let attempt = 0; attempt < 20; attempt++) {
      active = Number(
        (
          await control.query(
            "SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND application_name=ANY($1::text[]) AND pid<>pg_backend_pid() AND state<>'idle'",
            [[apiConnectionTag, fixtureConnectionTag]],
          )
        )[0].n,
      );
      if (!active) break;
      await delay(100);
    }
    assert.equal(
      active,
      0,
      'Only owned fixture connections must be quiescent; unrelated website activity is not a writer',
    );
    async function inventory() {
      const tables: { table_name: string }[] = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",
        [schema],
      );
      const contents = [];
      for (const { table_name: name } of tables) {
        assert.match(name, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
        const rows = await db.query(
          `SELECT to_jsonb(r)::text AS value FROM "${schema}"."${name}" r ORDER BY to_jsonb(r)::text`,
        );
        contents.push({ name, count: rows.length, digest: hash(JSON.stringify(rows)) });
      }
      const constraints = await db.query(
        'SELECT c.relname, con.conname, con.contype, con.convalidated, con.condeferrable, con.condeferred, con.connoinherit, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY c.relname,con.conname',
        [schema],
      );
      // PostgreSQL can fold array casts when dump DDL is reparsed. Canonicalize
      // CHECK expressions through that same parser on an owned TEMP clone;
      // no regex equivalence, ignored constraint or source-schema mutation.
      const normalizer = db.createQueryRunner();
      await normalizer.connect();
      try {
        for (const constraint of constraints) {
          if (constraint.contype !== 'c') continue;
          assert.match(constraint.relname, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
          const temporary = `restore_check_${randomUUID().replaceAll('-', '')}`;
          await normalizer.query(
            `CREATE TEMP TABLE "${temporary}" (LIKE "${schema}"."${constraint.relname}")`,
          );
          try {
            await normalizer.query(
              `ALTER TABLE pg_temp."${temporary}" ADD CONSTRAINT normalization_probe ${constraint.definition}`,
            );
            const [parsed] = await normalizer.query(
              "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname='normalization_probe'",
              [`pg_temp.${temporary}`],
            );
            assert.ok(parsed?.definition);
            constraint.definition = parsed.definition;
          } finally {
            await normalizer.query(`DROP TABLE pg_temp."${temporary}"`);
          }
        }
      } finally {
        await normalizer.release();
      }
      const indexes = await db.query(
        'SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=$1 ORDER BY tablename,indexname',
        [schema],
      );
      const sequences = [];
      const names: { sequencename: string }[] = await db.query(
        'SELECT sequencename FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename',
        [schema],
      );
      for (const { sequencename: name } of names) {
        assert.match(name, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
        sequences.push({
          name,
          ...(await db.query(`SELECT last_value,is_called FROM "${schema}"."${name}"`))[0],
        });
      }
      const functions = await db.query(
        `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
                pg_get_functiondef(p.oid) AS definition,p.prosecdef,p.proconfig,p.provolatile
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname=$1 AND p.prokind='f' ORDER BY p.proname,arguments`,
        [schema],
      );
      const columns = await db.query(
        // Logical restore removes dropped-column slots. Preserve visible order,
        // names/types/defaults/flags rather than requiring obsolete physical attnum gaps.
        `SELECT c.relname,row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum)::int AS ordinal,
                a.attname,format_type(a.atttypid,a.atttypmod) AS type,
                a.attnotnull,a.attidentity,a.attgenerated,
                pg_get_expr(d.adbin,d.adrelid) AS default_expression
         FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
         WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
         ORDER BY c.relname,a.attnum`,
        [schema],
      );
      const triggers = await db.query(
        `SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
         FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
         JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,
        [schema],
      );
      return { contents, constraints, indexes, sequences, functions, triggers, columns };
    }
    const before = await inventory();
    assert.ok(before.contents.length > 20, 'Full owned schema, not a selected-table backup');
    const dump = join(root, 'database.dump');
    const pgEnv = { ...env, PGPASSWORD: decodeURIComponent(url.password) };
    const pgArgs = [
      '-h',
      '127.0.0.1',
      '-p',
      '5433',
      '-U',
      'smartsite_test',
      '-d',
      'smartsite_test',
    ];
    execFileSync(
      executable('pg_dump'),
      [...pgArgs, '--schema', schema, '--format=custom', '--file', dump, '--no-owner', '--no-acl'],
      { env: pgEnv, windowsHide: true, timeout: 10_000 },
    );
    const manifest = {
      schema,
      dumpSha256: hash(await readFile(dump)),
      tables: before.contents,
      media: references.map(({ filename, digest }) => ({ filename, digest })),
      quiescence: 'ALL_OWNED_SYNTHETIC_WRITERS_TERMINAL_NOT_PRODUCTION_ATTESTATION',
    };
    assert.equal(new Set(manifest.media.map((item) => item.filename)).size, 2);
    for (const item of manifest.media) {
      await copyFile(join(sourceMedia, item.filename), join(backupMedia, item.filename));
      await copyFile(join(backupMedia, item.filename), join(restoredMedia, item.filename));
    }
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    async function verifyMedia(directory: string) {
      assert.deepEqual(
        (await readdir(directory)).sort(),
        manifest.media.map((item) => item.filename).sort(),
      );
      for (const item of manifest.media) {
        const bytes = await readFile(join(directory, item.filename));
        assert.equal(hash(bytes), item.digest, 'Every media digest must match');
        const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        assert.equal(decoded.info.width, 64);
        assert.equal(decoded.info.height, 64);
      }
    }
    const missingMedia = join(root, 'missing-media');
    await mkdir(missingMedia);
    await copyFile(
      join(backupMedia, manifest.media[0]!.filename),
      join(missingMedia, manifest.media[0]!.filename),
    );
    await assert.rejects(verifyMedia(missingMedia), assert.AssertionError);
    const corruptMedia = join(root, 'corrupt-media');
    await mkdir(corruptMedia);
    for (const item of manifest.media)
      await copyFile(join(backupMedia, item.filename), join(corruptMedia, item.filename));
    const corrupted = Buffer.from(syntheticJpeg);
    const corruptIndex = Math.floor(corrupted.length / 2);
    corrupted[corruptIndex] = corrupted[corruptIndex]! ^ 1;
    await writeFile(join(corruptMedia, manifest.media[0]!.filename), corrupted);
    await assert.rejects(verifyMedia(corruptMedia), assert.AssertionError);
    await verifyMedia(restoredMedia);
    await db.destroy();
    // Only this freshly created owned fixture schema is replaced; no production/public namespace.
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    assert.equal(
      (
        await control.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1', [
          schema,
        ])
      )[0].n,
      0,
    );
    assert.equal(hash(await readFile(dump)), manifest.dumpSha256);
    // pg_restore --schema selects contained objects but omits the SCHEMA TOC entry.
    // Provision only this exact, verified-absent owned fixture namespace first.
    await control.query(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      executable('pg_restore'),
      [
        ...pgArgs,
        '--schema',
        schema,
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        dump,
      ],
      { env: pgEnv, windowsHide: true, timeout: 10_000 },
    );
    await db.initialize();
    assert.deepEqual(
      await inventory(),
      before,
      'Every restored owned table row, constraint and index matches',
    );
    if (completed) {
      assert.equal(before.contents.find((table) => table.name === 'mf06_assessment')?.count, 1);
      assert.equal(
        before.contents.find((table) => table.name === 'mf06_authority_artifact')?.count,
        1,
      );
      const [job] = await db.query(
        'SELECT status,head_revision,lease_token,lease_expires_at FROM mf06_assessment_job WHERE request_id=$1',
        [completed.requestId],
      );
      assert.deepEqual(job, {
        status: 'SUCCEEDED',
        head_revision: 3,
        lease_token: null,
        lease_expires_at: null,
      });
      await assert.rejects(
        db.query(
          `INSERT INTO mf06_assessment
         (assessment_id,request_id,command_id,command_hash,site_id,event_id,binding_hash,
          outcome,reason_code,evaluator_version,provenance,authority_artifact_id,
          claim_head_revision,claim_lease_token,assessed_at)
         SELECT $1,request_id,$2,command_hash,site_id,event_id,binding_hash,outcome,
                reason_code,evaluator_version,provenance,authority_artifact_id,
                claim_head_revision,claim_lease_token,assessed_at
         FROM mf06_assessment WHERE assessment_id=$3`,
          [randomUUID(), randomUUID(), completed.assessmentId],
        ),
        (error: unknown) => (error as { code?: string }).code === '23514',
        'A completed historical assessment cannot be recreated by ordinary row INSERT',
      );
      for (const [table, key, id] of [
        ['mf06_assessment', 'assessment_id', completed.assessmentId],
        ['mf06_authority_artifact', 'artifact_id', completed.artifactId],
      ]) {
        await assert.rejects(
          db.query(`UPDATE ${table} SET ${key}=${key} WHERE ${key}=$1`, [id]),
          (error: unknown) => (error as { code?: string }).code === '23514',
        );
      }
      await assert.rejects(
        db.query('UPDATE mf06_assessment_job SET status=$2 WHERE request_id=$1', [
          completed.requestId,
          'PENDING',
        ]),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
      assert.deepEqual(
        await inventory(),
        before,
        'Rejected history mutations leave every stored value unchanged',
      );
    }
    const second = await start(restoredMedia);
    assert.notEqual(second.process.pid, first.process.pid);
    token = await login(changed);
    if (manual) {
      const replay = await (
        await request(manual.route, 201, manual.command, manual.safetyToken)
      ).json();
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.recordedDecision, manual.original);
      assert.equal(replay.latestRevision, 1);
      await request(
        manual.route,
        409,
        { ...manual.command, reason: 'Changed body cannot reuse restored command.' },
        manual.safetyToken,
      );
      const history = await (
        await request(manual.route, 200, undefined, manual.safetyToken)
      ).json();
      assert.equal(history.total, 1);
      assert.deepEqual(history.items, [manual.original]);
      await request(manual.route, 401);
      await request(
        manual.route.replace(site.id, otherSite.id),
        403,
        undefined,
        manual.safetyToken,
      );
      const privateBytes = await request(references[0]!.path, 200, undefined, manual.safetyToken);
      assert.equal(hash(Buffer.from(await privateBytes.arrayBuffer())), references[0]!.digest);
      await request(
        '/auth/logout',
        204,
        { clientType: 'WEB' },
        manual.safetyToken,
        'POST',
        manual.cookie,
      );
      await request(manual.route, 401, undefined, manual.safetyToken);
    }
    if (completed) {
      const route = `/sites/${site.id}/mf06-assessments/${completed.assessmentId}`;
      // Stored synthetic history must remain hidden, never relabeled to make a read pass.
      await request(route, 404, undefined, token);
      const response = await request(`/sites/${site.id}/mf06-assessments`, 200, undefined, token);
      const page = await response.json();
      assert.deepEqual(page.items, []);
      assert.equal(page.total, 0);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      await request(route, 401);
      await request(
        route.replace(`/sites/${site.id}/`, `/sites/${otherSite.id}/`),
        404,
        undefined,
        token,
      );
    }
    for (const item of references) {
      const response = await request(item.path, 200, undefined, token);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), item.digest);
      await request(item.path, 401);
      await request(
        item.path.replace(`/sites/${site.id}/`, `/sites/${otherSite.id}/`),
        404,
        undefined,
        token,
      );
      const [stored] = await db.query(
        'SELECT payload_hash,raw_payload FROM ai_observation_event WHERE event_id=$1',
        [item.eventId],
      );
      assert.equal(stored.payload_hash, item.payloadHash);
      assert.equal(computeCanonicalPayloadHash(stored.raw_payload), item.payloadHash);
    }
    await request(`/sites/${site.id}/cameras/${camera.id}`, 200, undefined, token);
    await stop(second);
    await writeFile(
      join(root, 'result.json'),
      JSON.stringify(
        {
          status: 'SYNTHETIC_QUIESCED_DB_MEDIA_RESTORE_VERIFIED_NOT_PRODUCTION_ACCEPTED',
          schemaTables: before.contents.length,
          mediaFiles: manifest.media.length,
          dumpSha256: manifest.dumpSha256,
          missingMediaRefused: true,
          corruptMediaRefused: true,
          allRowsConstraintsIndexesMatched: true,
          privateAuthenticatedReadsMatched: true,
          AIWorkers: false,
          forcedWindowsQuiesceNotGraceful: !linux && process.platform === 'win32',
          actualLinuxContainers: linuxContainers,
          linuxImage: linux ? linuxImage : null,
          profile: main37 ? 'PINNED_MAIN35_PLUS_0001_0004' : 'CANONICAL_MAIN39',
          completedMf06HistoryPreserved: !!completed,
          syntheticHistorySuppressed: !!completed,
          functionsTriggersMatched: true,
          columnTypesDefaultsAndFlagsMatched: true,
          restoredManualCommandReplayExact: !!manual,
          restoredManualHistoryTotal: manual ? 1 : null,
          restoredSyntheticSafetyScopeAndLogoutVerified: !!manual,
          actualMainReady: !main37,
          missingRuntimeMigrations,
        },
        null,
        2,
      ),
    );
    console.log(
      `Owned recovery fixture: ${before.contents.length} tables, ${manifest.media.length} media; missing/corrupt controls refused; private reads exact.`,
    );
    console.log(`Owned recovery artifacts: ${root}`);
  };
}

test(
  'quiesced owned PostgreSQL dump and every fixture evidence file restore exact records and private reads',
  { timeout: 60_000, skip: pgBin ? false : 'Explicit PostgreSQL client binary directory required' },
  recoveryScenario(),
);
test(
  'qualified MAIN37 recovery preserves completed MF06 history, guards and every private media file',
  {
    timeout: 60_000,
    skip:
      pgBin && mainSnapshot && sourceRepository
        ? false
        : 'Explicit PostgreSQL clients and pinned MAIN migration snapshot/source required',
  },
  recoveryScenario(true),
);
test(
  'owned Linux canonical MAIN39 DB and all evidence files restore into actual production main',
  {
    timeout: 180_000,
    skip:
      pgBin && linuxImage
        ? false
        : 'Explicit PostgreSQL clients and owned Linux image digest required',
  },
  recoveryScenario(false, true),
);
