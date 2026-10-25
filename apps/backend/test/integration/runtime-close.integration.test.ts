import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { reviewedReleaseMigrationNames } from '../support/reviewed-release-graph.js';

test(
  'actual compiled main native app.close drains an admitted release transaction before pool shutdown',
  { timeout: 40_000 },
  async (t) => {
    const url = new URL(resolveTestDatabaseUrl());
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '5433');
    assert.equal(url.pathname, '/smartsite_test');
    assert.equal(url.username, 'smartsite_test');
    const isolated = createIsolatedTestDatabase();
    const db = isolated.dataSource;
    const owned: { child?: ChildProcess; exited?: Promise<void>; pending?: Promise<Response> } = {};
    let logs = '';
    const secrets: string[] = [];
    const held = db.createQueryRunner();
    const controls = new Map<string, unknown>();
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'smartsite-runtime-close-'));
    t.after(async () => {
      if (held.isTransactionActive) await held.rollbackTransaction();
      if (!held.isReleased) await held.release();
      await owned.pending?.catch(() => {});
      if (owned.child && owned.child.exitCode === null && owned.child.signalCode === null)
        owned.child.kill();
      if (owned.exited)
        await Promise.race([
          owned.exited,
          delay(5_000, undefined, { ref: false }).then(() => {
            throw new Error('Owned fixture child still live; schema retained');
          }),
        ]);
      await isolated.dispose();
      assert.equal(
        secrets.some((value) => logs.includes(value)),
        false,
      );
      // Retain the owned synthetic evidence directory; no current demo is touched.
    });
    await isolated.initialize();
    const schema = db.driver.schema;
    assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
    assert.equal((await db.query('SELECT current_schema() AS schema'))[0].schema, schema);
    url.searchParams.set('options', `-c search_path=${schema}`);
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
      DATABASE_URL: url.toString(),
      DATABASE_TIMEOUT_MS: '2000',
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
      SMARTSITE_AI_SERVICE_TOKEN: randomBytes(32).toString('hex'),
      SMARTSITE_AI_PREVIEW_SOURCES: '{}',
      EVIDENCE_LOCAL_ROOT: evidenceRoot,
      CORS_ORIGINS: origin,
      LOG_FORMAT: 'json',
      LOG_LEVEL: 'info',
    };
    const initial = `Initial-${randomBytes(16).toString('hex')}!`;
    const changed = `Changed-${randomBytes(16).toString('hex')}!`;
    secrets.push(
      initial,
      changed,
      url.toString(),
      url.password,
      env.AUTH_JWT_SECRET,
      env.SMARTSITE_AI_SERVICE_TOKEN,
    );
    const username = `close-admin-${randomBytes(6).toString('hex')}`;
    logs += execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../src/scripts/bootstrap-admin.js', import.meta.url))],
      {
        env: {
          ...env,
          BOOTSTRAP_ADMIN_USERNAME: username,
          BOOTSTRAP_ADMIN_DISPLAY_NAME: 'Synthetic drain Admin',
          BOOTSTRAP_ADMIN_PASSWORD: initial,
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../support/runtime-close.fixture.js', import.meta.url))],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    owned.child = child;
    child.stdout!.on('data', (data) => {
      logs += data.toString();
    });
    child.stderr!.on('data', (data) => {
      logs += data.toString();
    });
    child.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        typeof message.type === 'string'
      )
        controls.set(message.type, message);
    });
    const exited = new Promise<void>((resolve, reject) => {
      child!.once('exit', () => resolve());
      child!.once('error', reject);
    });
    owned.exited = exited;
    async function control(type: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (controls.has(type)) return controls.get(type);
        assert.equal(child!.exitCode, null, `Child exited before ${type}`);
        assert.equal(child!.signalCode, null, `Child terminated before ${type}`);
        await delay(50);
      }
      throw new Error(`Fixture did not reach ${type}`);
    }
    const base = `http://127.0.0.1:${port}/api/v1`;
    async function request(route: string, method = 'GET', body?: unknown, token?: string) {
      return fetch(`${base}${route}`, {
        method,
        signal: AbortSignal.timeout(10_000),
        headers: {
          Origin: origin,
          Connection: 'close',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    assert.deepEqual(await control('READY'), {
      type: 'READY',
      entrypoint: 'main.ts',
      registeredMigrations: reviewedReleaseMigrationNames(db.options.migrations).length,
      productionConfig: true,
    });
    const login = await request('/auth/login', 'POST', {
      username,
      password: initial,
      clientType: 'WEB',
    });
    assert.equal(login.status, 200);
    let token: string = (await login.json()).accessToken;
    secrets.push(token);
    const change = await request(
      '/auth/change-password',
      'POST',
      { currentPassword: initial, newPassword: changed },
      token,
    );
    assert.equal(change.status, 204);
    const relogin = await request('/auth/login', 'POST', {
      username,
      password: changed,
      clientType: 'WEB',
    });
    assert.equal(relogin.status, 200);
    token = (await relogin.json()).accessToken;
    secrets.push(token);
    const siteResponse = await request(
      '/sites',
      'POST',
      { code: 'DRAIN-SITE', name: 'Synthetic drain Site' },
      token,
    );
    assert.equal(siteResponse.status, 201);
    const site = await siteResponse.json();
    // Main requires an exact-Site Manager for Zone writes; Admin alone is not enough.
    const [{ id: actorId }] = await db.query('SELECT id FROM app_user WHERE username=$1', [
      username,
    ]);
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES(gen_random_uuid(),$1,'SITE_MANAGER',$2)",
      [actorId, site.id],
    );
    await held.connect();
    await held.startTransaction();
    await held.query('LOCK TABLE zone IN ACCESS EXCLUSIVE MODE');
    const pending = request(
      `/sites/${site.id}/zones`,
      'POST',
      {
        code: 'ADMITTED',
        name: 'Admitted transaction',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: [],
      },
      token,
    );
    owned.pending = pending;
    // Attach failure handling immediately; the response stays pending until lock release.
    void pending.catch(() => {});
    let blockedPid = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await db.query(
        "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%zone%' AND state='active'",
      );
      if (rows.length === 1) {
        blockedPid = rows[0].pid;
        break;
      }
      await delay(25);
    }
    assert.ok(blockedPid, 'Actual admitted Zone transaction must reach the held SQL boundary');
    const [{ count: commandsBefore }] = await db.query(
      "SELECT count(*)::int AS count FROM authorization_history_command WHERE operation='ZONE_CREATE'",
    );
    assert.equal(commandsBefore, 0, 'Other connections cannot see the uncommitted command');
    child.send('BEGIN_DRAIN');
    assert.deepEqual(await control('DRAINING'), { type: 'DRAINING', poolInitialized: true });
    const rejected = await request(
      `/sites/${site.id}/zones`,
      'POST',
      {
        code: 'REJECTED',
        name: 'Must not run',
        type: 'STANDARD',
        restrictionPolicy: 'NONE',
        requiredPpe: [],
      },
      token,
    );
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).code, 'SERVICE_UNAVAILABLE');
    assert.equal(rejected.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(rejected.headers.get('access-control-allow-origin'), origin);
    const started = performance.now();
    child.send('CLOSE');
    await delay(80);
    assert.equal(child.exitCode, null, 'app.close must wait for the admitted transaction');
    assert.equal(controls.has('CLOSED'), false);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1', [
          blockedPid,
        ])
      )[0].count,
      1,
      'Runtime DB connection remains while transaction is admitted',
    );
    await held.commitTransaction();
    await held.release();
    const admitted = await pending;
    assert.equal(admitted.status, 201);
    const zone = await admitted.json();
    assert.equal(zone.code, 'ADMITTED');
    const closed = await control('CLOSED');
    await exited;
    assert.deepEqual(closed, { type: 'CLOSED', poolInitialized: false, deadlineExceeded: false });
    assert.equal(child.exitCode, 0, 'Natural fixture exit; no forced termination');
    assert.equal(child.signalCode, null);
    assert.ok(performance.now() - started < 30_000);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid=$1', [
          blockedPid,
        ])
      )[0].count,
      0,
      'Runtime pool connection is closed after drain',
    );
    const rows = await db.query(
      "SELECT z.id, c.command_id, f.source_id, w.transaction_id=c.transaction_id AND f.transaction_id=c.transaction_id AS witnessed FROM zone z JOIN authorization_history_revision f ON f.source_id=z.id JOIN authorization_history_command c ON c.command_id=f.command_id JOIN authorization_history_commit_receipt w ON w.command_id=c.command_id WHERE z.site_id=$1 AND z.code='ADMITTED' AND c.operation='ZONE_CREATE'",
      [site.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, zone.id);
    assert.equal(rows[0].source_id, zone.id);
    assert.equal(rows[0].witnessed, true);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM zone WHERE site_id=$1 AND code='REJECTED'",
          [site.id],
        )
      )[0].count,
      0,
    );
    const portProbe = createServer();
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );
  },
);

test(
  'actual main startup failure resolves null, exits1 and omits private inputs',
  { timeout: 15_000 },
  async (t) => {
    const isolated = createIsolatedTestDatabase();
    await isolated.initialize();
    const database = new URL(resolveTestDatabaseUrl());
    const schema = isolated.dataSource.driver.schema;
    assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
    database.searchParams.set('options', `-c search_path=${schema}`);
    const secret = randomBytes(32).toString('hex');
    let logs = '';
    const messages: unknown[] = [];
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../support/runtime-startup-failure.fixture.js', import.meta.url))],
      {
        env: {
          ...Object.fromEntries(
            ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].flatMap((key) =>
              process.env[key] ? [[key, process.env[key]!]] : [],
            ),
          ),
          NODE_ENV: 'production',
          PORT: 'not-a-valid-port',
          DATABASE_URL: database.toString(),
          AUTH_JWT_SECRET: secret,
          SMARTSITE_AI_SERVICE_TOKEN: secret,
          SMARTSITE_AI_PREVIEW_SOURCES: '{}',
          CORS_ORIGINS: 'http://127.0.0.1:5173',
          LOG_FORMAT: 'json',
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    child.stdout!.on('data', (data) => {
      logs += data.toString();
    });
    child.stderr!.on('data', (data) => {
      logs += data.toString();
    });
    child.on('message', (message) => messages.push(message));
    const exited = new Promise<void>((resolve, reject) => {
      child.once('exit', () => resolve());
      child.once('error', reject);
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.race([
        exited,
        delay(5000, undefined, { ref: false }).then(() => {
          throw new Error('Owned startup-failure child still live');
        }),
      ]);
      await isolated.dispose();
    });
    await exited;
    assert.equal(child.exitCode, 1);
    assert.equal(child.signalCode, null);
    assert.deepEqual(messages, [{ type: 'STARTUP_FAILED', app: null, exitCode: 1 }]);
    assert.match(logs, /Backend failed to start/);
    for (const value of [secret, database.toString(), database.password])
      assert.equal(logs.includes(value), false, 'Private startup input in log');
    assert.equal((await isolated.dataSource.query('SELECT count(*)::int n FROM app_user'))[0].n, 0);
  },
);
