import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test(
  'actual compiled main uses production configuration and real isolated PostgreSQL without provider overrides',
  { timeout: 30_000 },
  async (t) => {
    const databaseUrl = new URL(resolveTestDatabaseUrl());
    assert.equal(databaseUrl.port, '5433', 'Dedicated local test port only');
    const isolated = createIsolatedTestDatabase({ canonical: true });
    const db = isolated.dataSource;
    const owned: { child?: ChildProcess; exit?: Promise<void> } = {};
    let logs = '';
    const secrets: string[] = [];
    t.after(async () => {
      const child = owned.child;
      const childExit = owned.exit;
      if (child && child.exitCode === null && child.signalCode === null) {
        // Exact directly-owned process handle only. On Windows this is forced cleanup,
        // not Linux SIGTERM, Nest graceful shutdown or production drain acceptance.
        child.kill();
      }
      if (childExit)
        await Promise.race([
          childExit,
          delay(5_000, undefined, { ref: false }).then(() => {
            throw new Error('Owned main did not exit');
          }),
        ]);
      // Never drop the owned schema if the runtime has not actually exited.
      await isolated.dispose();
      assert.equal(
        secrets.some((secret) => logs.includes(secret)),
        false,
        'Private inputs must not be logged',
      );
    });
    await isolated.initialize();
    const schema = db.driver.schema;
    assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
    assert.equal((await db.query('SELECT current_schema() AS schema'))[0].schema, schema);
    databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
    const addressServer = createServer();
    await new Promise<void>((resolve, reject) => {
      addressServer.once('error', reject);
      addressServer.listen(0, '127.0.0.1', resolve);
    });
    const address = addressServer.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      addressServer.close((error) => (error ? reject(error) : resolve())),
    );
    const origin = 'http://127.0.0.1:5173';
    const initialPassword = `Initial-${randomBytes(16).toString('hex')}!`;
    const changedPassword = `Changed-${randomBytes(16).toString('hex')}!`;
    const env = {
      ...Object.fromEntries(
        ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].flatMap((key) =>
          process.env[key] ? [[key, process.env[key]!]] : [],
        ),
      ),
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: databaseUrl.toString(),
      DATABASE_TIMEOUT_MS: '2000',
      AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
      SMARTSITE_AI_SERVICE_TOKEN: randomBytes(32).toString('hex'),
      SMARTSITE_AI_PREVIEW_SOURCES: '{}',
      CORS_ORIGINS: origin,
      LOG_FORMAT: 'json',
      LOG_LEVEL: 'info',
    };
    secrets.push(
      initialPassword,
      changedPassword,
      databaseUrl.password,
      env.DATABASE_URL,
      env.AUTH_JWT_SECRET,
      env.SMARTSITE_AI_SERVICE_TOKEN,
    );
    const username = `runtime-${randomBytes(8).toString('hex')}`;
    await t.test(
      'existing bootstrap CLI creates only the initial Admin and refuses overwriting it',
      () => {
        const bootstrap = fileURLToPath(
          new URL('../../src/scripts/bootstrap-admin.js', import.meta.url),
        );
        const bootstrapEnv = {
          ...env,
          BOOTSTRAP_ADMIN_USERNAME: username,
          BOOTSTRAP_ADMIN_DISPLAY_NAME: 'Synthetic runtime Admin',
          BOOTSTRAP_ADMIN_PASSWORD: initialPassword,
        };
        logs += execFileSync(process.execPath, [bootstrap], {
          env: bootstrapEnv,
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
        });
        assert.throws(
          () =>
            execFileSync(process.execPath, [bootstrap], {
              env: bootstrapEnv,
              windowsHide: true,
              timeout: 10_000,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            }),
          (error: unknown) => {
            const failure = error as { status?: number; stdout?: string; stderr?: string };
            assert.equal(failure.status, 1);
            logs += failure.stdout ?? '';
            logs += failure.stderr ?? '';
            return true;
          },
        );
      },
    );
    const main = fileURLToPath(new URL('../../src/main.js', import.meta.url));
    const child = spawn(process.execPath, [main], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    owned.child = child;
    child.stdout!.on('data', (data) => {
      logs += data.toString();
    });
    child.stderr!.on('data', (data) => {
      logs += data.toString();
    });
    owned.exit = new Promise<void>((resolve, reject) => {
      child!.once('exit', () => resolve());
      child!.once('error', reject);
    });
    const base = `http://127.0.0.1:${port}/api/v1`;
    async function request(
      route: string,
      expected: number,
      options: { method?: string; body?: unknown; token?: string; cookie?: string } = {},
    ) {
      const response = await fetch(`${base}${route}`, {
        method: options.method ?? 'GET',
        signal: AbortSignal.timeout(5_000),
        headers: {
          Origin: origin,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      assert.equal(response.status, expected, `${options.method ?? 'GET'} ${route}`);
      const text = await response.text();
      assert.ok(text.length < 100_000);
      return { response, data: text ? JSON.parse(text) : undefined };
    }
    await t.test(
      'actual main starts ready with existing release migrations and production headers',
      async () => {
        let ready = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          assert.equal(child!.exitCode, null, 'Main exited before readiness');
          try {
            const result = await request('/health/ready', 200);
            assert.equal(result.data.database, 'up');
            ready = true;
            break;
          } catch {
            await delay(100);
          }
        }
        assert.equal(ready, true);
        const result = await request('/health/live', 200);
        assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(result.response.headers.get('access-control-allow-origin'), origin);
      },
    );
    await t.test(
      'release migration history loss makes actual main unready without stopping liveness or recreating history',
      async () => {
        const [migration] = await db.query(
          'SELECT id, timestamp, name FROM migrations ORDER BY id DESC LIMIT 1',
        );
        assert.ok(migration);
        await db.query('DELETE FROM migrations WHERE id=$1', [migration.id]);
        try {
          const ready = await request('/health/ready', 503);
          assert.equal(ready.data.code, 'DATABASE_UNAVAILABLE');
          await request('/health/live', 200);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM migrations WHERE id=$1', [
                migration.id,
              ])
            )[0].n,
            0,
          );
        } finally {
          await db.query('INSERT INTO migrations(id, timestamp, name) VALUES ($1,$2,$3)', [
            migration.id,
            migration.timestamp,
            migration.name,
          ]);
        }
        await request('/health/ready', 200);
      },
    );
    let token: string;
    let cookie: string;
    await t.test(
      'existing WEB login requires password change, revokes the old token, and issues secure cookie attributes',
      async () => {
        await request('/sites', 401);
        await request('/auth/login', 400, { method: 'POST', body: {} });
        const first = await request('/auth/login', 200, {
          method: 'POST',
          body: { username, password: initialPassword, clientType: 'WEB' },
        });
        const oldToken = first.data.accessToken;
        secrets.push(oldToken);
        await request('/sites', 403, { token: oldToken });
        await request('/auth/change-password', 204, {
          method: 'POST',
          token: oldToken,
          body: { currentPassword: initialPassword, newPassword: changedPassword },
        });
        await request('/auth/me', 401, { token: oldToken });
        const login = await request('/auth/login', 200, {
          method: 'POST',
          body: { username, password: changedPassword, clientType: 'WEB' },
        });
        token = login.data.accessToken;
        assert.equal(login.data.refreshToken, undefined);
        const setCookie = login.response.headers.get('set-cookie');
        assert.ok(
          setCookie &&
            /; HttpOnly/i.test(setCookie) &&
            /; Secure/i.test(setCookie) &&
            /; SameSite=Strict/i.test(setCookie),
        );
        cookie = setCookie.split(';')[0]!;
        secrets.push(token, cookie, cookie.slice(cookie.indexOf('=') + 1));
      },
    );
    let siteId: string;
    await t.test(
      'guarded Site, Camera, Zone and Region APIs persist configuration and enforce expected revision',
      async () => {
        const site = await request('/sites', 201, {
          method: 'POST',
          token,
          body: { code: username, name: 'Synthetic runtime Site' },
        });
        siteId = site.data.id;
        const camera = await request(`/sites/${siteId}/cameras`, 201, {
          method: 'POST',
          token,
          body: { code: 'CAM', externalId: username, name: 'Synthetic metadata Camera' },
        });
        const zone = await request(`/sites/${siteId}/zones`, 201, {
          method: 'POST',
          token,
          body: {
            code: 'ZONE',
            name: 'Synthetic Zone',
            type: 'STANDARD',
            restrictionPolicy: 'NONE',
            requiredPpe: ['GLOVES'],
          },
        });
        const route = `/sites/${siteId}/cameras/${camera.data.id}/regions`;
        const body = {
          zoneId: zone.data.id,
          expectedConfigurationVersion: 1,
          polygon: {
            coordinates: [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
          },
        };
        const region = await request(route, 201, { method: 'POST', token, body });
        assert.equal(region.data.region.zoneId, zone.data.id);
        await request(route, 409, { method: 'POST', token, body });
        await request(`/sites/${siteId}/zones/${zone.data.id}`, 200, {
          method: 'PATCH',
          token,
          body: { name: 'Renamed runtime Zone' },
        });
        const stored = await db.query('SELECT name FROM zone WHERE id=$1 AND site_id=$2', [
          zone.data.id,
          siteId,
        ]);
        assert.equal(stored[0].name, 'Renamed runtime Zone');
      },
    );
    await t.test(
      'actual WEB logout revokes access to persisted configuration without deleting it',
      async () => {
        await request('/auth/logout', 204, { method: 'POST', cookie, body: { clientType: 'WEB' } });
        await request(`/sites/${siteId}/zones`, 401, { token });
        assert.equal(
          (await db.query('SELECT count(*)::int AS n FROM site WHERE id=$1', [siteId]))[0].n,
          1,
        );
      },
    );
  },
);
