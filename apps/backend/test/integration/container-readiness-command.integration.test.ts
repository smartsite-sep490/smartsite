import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

for (const configuredPort of [false, true])
  test(
    'image healthcheck rejects live/unready main and recovers with ' +
      (configuredPort ? 'configured port' : 'default image port'),
    { timeout: 45_000 },
    async (t) => {
      const databaseUrl = new URL(resolveTestDatabaseUrl());
      assert.equal(databaseUrl.hostname, '127.0.0.1');
      assert.equal(databaseUrl.port, '5433');
      const repo = process.env.SMARTSITE_TEST_SOURCE_REPO;
      assert.ok(repo, 'Existing source root required to execute the actual Dockerfile command');
      const dockerfile = readFileSync(repo + '/infra/docker/backend.Dockerfile', 'utf8');
      const healthcheck = dockerfile.match(/^HEALTHCHECK[^\r\n]+ CMD node -e "([^"\r\n]+)"$/m);
      assert.ok(healthcheck);
      assert.equal(typeof healthcheck[1], 'string');
      if (!healthcheck[1]) throw new Error('Missing image health command');
      // Execute the checked-in Node program verbatim, without invoking a shell.
      const command = ['node', '-e', healthcheck[1]];
      // Refuse an occupied default port; configured mode uses a fresh native port.
      // The actual runtime and verbatim image command receive the same PORT setting.
      const portGuard = createServer();
      await new Promise<void>((resolve, reject) => {
        portGuard.once('error', reject);
        portGuard.listen(configuredPort ? 0 : 3000, '0.0.0.0', resolve);
      });
      const address = portGuard.address();
      assert.ok(address && typeof address !== 'string');
      const port = address.port;
      await new Promise<void>((resolve, reject) =>
        portGuard.close((error) => (error ? reject(error) : resolve())),
      );
      const isolated = createIsolatedTestDatabase({ canonical: true }),
        db = isolated.dataSource;
      const owned: { child?: ChildProcess; exit?: Promise<void> } = {};
      let logs = '';
      t.after(async () => {
        const child = owned.child;
        if (child && child.exitCode === null && child.signalCode === null) child.kill();
        if (owned.exit)
          await Promise.race([
            owned.exit,
            delay(5000, undefined, { ref: false }).then(() => {
              throw new Error('Owned main did not exit');
            }),
          ]);
        // Windows cleanup is forced; this test does not certify container SIGTERM drain.
        await isolated.dispose();
        for (const secret of [databaseUrl.password, databaseUrl.href])
          assert(!logs.includes(secret));
      });
      await isolated.initialize();
      const schema = db.driver.schema;
      assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
      databaseUrl.searchParams.set('options', '-c search_path=' + schema);
      const env = {
        ...Object.fromEntries(
          ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'].flatMap((key) =>
            process.env[key] ? [[key, process.env[key]!]] : [],
          ),
        ),
        NODE_ENV: 'production',
        ...(configuredPort ? { PORT: String(port) } : {}),
        DATABASE_URL: databaseUrl.href,
        DATABASE_TIMEOUT_MS: '2000',
        AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
        SMARTSITE_AI_SERVICE_TOKEN: randomBytes(32).toString('hex'),
        SMARTSITE_AI_PREVIEW_SOURCES: '{}',
        MF06_ENQUEUE_ENABLED: 'false',
        MF06_ASSESSMENT_READ_ENABLED: 'false',
        CORS_ORIGINS: 'http://127.0.0.1:5173',
        LOG_FORMAT: 'json',
        LOG_LEVEL: 'info',
      };
      const child = (owned.child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../../src/main.js', import.meta.url))],
        {
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ));
      child.stdout!.on('data', (data) => {
        logs += data.toString();
      });
      child.stderr!.on('data', (data) => {
        logs += data.toString();
      });
      owned.exit = new Promise<void>((resolve, reject) => {
        child.once('exit', () => resolve());
        child.once('error', reject);
      });
      const read = (path: string) =>
        fetch('http://127.0.0.1:' + port + '/api/v1/health/' + path, {
          signal: AbortSignal.timeout(2000),
        });
      let started = false;
      // Match the image's 15s startup grace on a cold/shared desktop.
      const startupDeadline = Date.now() + 15_000;
      while (Date.now() < startupDeadline && !started) {
        assert.equal(child.exitCode, null, 'Owned main exited before readiness');
        try {
          started = (await read('ready')).status === 200;
        } catch {
          /* listener not ready yet */
        }
        if (!started) await delay(100);
      }
      assert.equal(started, true);
      const check = () => {
        const result = spawnSync(process.execPath, command.slice(1), {
          env,
          windowsHide: true,
          encoding: 'utf8',
          timeout: 5000,
        });
        assert.equal(result.error, undefined);
        return result.status;
      };
      assert.equal(check(), 0, 'Migrated release should pass its actual image command');
      await db.query(`ALTER TABLE "${schema}".migrations RENAME TO fixture_hidden_migrations`);
      try {
        assert.equal((await read('live')).status, 200, 'Process liveness remains separate');
        const response = await read('ready');
        assert.equal(response.status, 503);
        assert.equal(((await response.json()) as { code: string }).code, 'DATABASE_UNAVAILABLE');
        assert.equal(
          check(),
          1,
          'Web dependency must not pass while required migration history is unavailable',
        );
      } finally {
        await db.query(`ALTER TABLE "${schema}".fixture_hidden_migrations RENAME TO migrations`);
      }
      assert.equal((await read('ready')).status, 200);
      assert.equal(check(), 0, 'Command recovers after storage readiness recovers');
      for (const secret of [env.AUTH_JWT_SECRET, env.SMARTSITE_AI_SERVICE_TOKEN])
        assert(!logs.includes(secret));
    },
  );
