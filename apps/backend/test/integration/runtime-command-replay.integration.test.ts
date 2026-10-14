import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  parseObservationIdentityContextResponse,
  parseObservationIdentityDecisionPage,
  parseObservationIdentityMutationResponse,
} from '@smartsite/contracts/management';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { syntheticJpeg } from '../support/synthetic-jpeg.js';

test(
  'actual main replays an exact observation command after committed response loss and process restart',
  { timeout: 45_000 },
  async (t) => {
    const databaseUrl = new URL(resolveTestDatabaseUrl());
    assert.equal(databaseUrl.port, '5433', 'Dedicated test database only');
    const isolated = createIsolatedTestDatabase({ legacy: true });
    const db = isolated.dataSource;
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'smartsite-runtime-replay-'));
    const children: { process: ChildProcess; exited: Promise<void> }[] = [];
    let logs = '';
    const secrets: string[] = [];
    const stop = async (owned: (typeof children)[number]) => {
      if (owned.process.exitCode === null && owned.process.signalCode === null)
        owned.process.kill();
      await Promise.race([
        owned.exited,
        delay(5_000, undefined, { ref: false }).then(() => {
          throw new Error('Owned API child did not exit');
        }),
      ]);
    };
    t.after(async () => {
      // Never dispose the schema before every directly-owned child is terminal.
      // Windows kill is forced cleanup, not graceful SIGTERM/drain acceptance.
      for (const owned of children) await stop(owned);
      await isolated.dispose();
      assert.equal(
        secrets.some((value) => logs.includes(value)),
        false,
        'No private inputs in logs',
      );
      // Keep synthetic media under the configured test TEMP for evidence inspection.
    });
    await isolated.initialize();
    const schema = db.driver.schema;
    assert.ok(schema && /^isolated_test_[a-f0-9]{32}$/.test(schema));
    assert.equal((await db.query('SELECT current_schema() AS schema'))[0].schema, schema);
    databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
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
      DATABASE_URL: databaseUrl.toString(),
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
    const reviewerInitial = `Initial-${randomBytes(16).toString('hex')}!`;
    const reviewerChanged = `Changed-${randomBytes(16).toString('hex')}!`;
    secrets.push(
      initial,
      changed,
      reviewerInitial,
      reviewerChanged,
      env.DATABASE_URL,
      databaseUrl.password,
      env.AUTH_JWT_SECRET,
      env.SMARTSITE_AI_SERVICE_TOKEN,
    );
    const adminName = `replay-admin-${randomBytes(6).toString('hex')}`;
    logs += execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../../src/scripts/bootstrap-admin.js', import.meta.url))],
      {
        env: {
          ...env,
          BOOTSTRAP_ADMIN_USERNAME: adminName,
          BOOTSTRAP_ADMIN_DISPLAY_NAME: 'Synthetic replay Admin',
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
      options: { method?: string; body?: unknown; token?: string } = {},
    ) {
      const response = await fetch(`${base}${route}`, {
        method: options.method ?? 'GET',
        signal: AbortSignal.timeout(5_000),
        headers: {
          Origin: origin,
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      assert.equal(response.status, expected, `${options.method ?? 'GET'} ${route}`);
      const text = await response.text();
      return text ? JSON.parse(text) : undefined;
    }
    async function start() {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../../src/main.js', import.meta.url))],
        { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
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
      for (let attempt = 0; attempt < 60; attempt++) {
        assert.equal(child.exitCode, null, 'Main must not exit during startup');
        try {
          await request('/health/ready');
          return owned;
        } catch {
          await delay(100);
        }
      }
      throw new Error('Actual main readiness deadline exceeded');
    }
    const first = await start();
    async function login(username: string, password: string) {
      const result = await request('/auth/login', 200, {
        method: 'POST',
        body: { username, password, clientType: 'WEB' },
      });
      secrets.push(result.accessToken);
      return result.accessToken as string;
    }
    const changePassword = (token: string, currentPassword: string, newPassword: string) =>
      request('/auth/change-password', 204, {
        method: 'POST',
        token,
        body: { currentPassword, newPassword },
      });
    let admin = await login(adminName, initial);
    await changePassword(admin, initial, changed);
    admin = await login(adminName, changed);
    const create = (route: string, body: unknown) =>
      request(route, 201, { method: 'POST', body, token: admin });
    const site = await create('/sites', { code: adminName, name: 'Synthetic replay Site' });
    const reviewerName = `replay-so-${randomBytes(6).toString('hex')}`;
    const reviewer = await create('/users', {
      username: reviewerName,
      displayName: 'Synthetic replay Safety',
      temporaryPassword: reviewerInitial,
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site.id }],
    });
    let safety = await login(reviewerName, reviewerInitial);
    await changePassword(safety, reviewerInitial, reviewerChanged);
    safety = await login(reviewerName, reviewerChanged);
    const worker = await create(`/sites/${site.id}/workers`, {
      externalId: 'SYNTHETIC-REPLAY',
      displayName: 'Synthetic review reference',
    });
    const camera = await create(`/sites/${site.id}/cameras`, {
      code: 'REPLAY',
      externalId: adminName,
      name: 'Synthetic metadata Camera',
    });
    const zone = await create(`/sites/${site.id}/zones`, {
      code: 'REPLAY',
      name: 'Synthetic replay Zone',
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
    const eventId = randomUUID(),
      streamSessionId = randomUUID();
    await writeFile(join(evidenceRoot, `${streamSessionId}_1_${eventId}.jpg`), syntheticJpeg);
    const event = {
      eventId,
      schemaVersion: '1.0.0',
      cameraExternalId: camera.externalId,
      streamSessionId,
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 64, height: 64 },
      observations: [
        ...[7, 8].map((trackId, i) => ({
          type: 'PERSON',
          trackId,
          confidence: 0.95,
          boundingBox: {
            x1: i ? 0.55 : 0.05,
            y1: 0.1,
            x2: i ? 0.95 : 0.45,
            y2: 0.9,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        })),
        {
          type: 'PPE',
          trackId: 7,
          ppeItem: 'HARD_HAT',
          status: 'MISSING',
          regionId: region.id,
          geometryVersion: region.version,
          confidence: 0.9,
        },
      ],
      evidence: [{ kind: 'FRAME', uri: `local://evidence/${streamSessionId}/1/${eventId}.jpg` }],
    };
    // Technical ingestion fixture only: no camera/model/Face invocation or real identity claim.
    const ingested = await request('/integrations/ai/events', 202, {
      method: 'POST',
      body: event,
      token: env.SMARTSITE_AI_SERVICE_TOKEN,
    });
    assert.equal(ingested.status, 'PROCESSED');
    assert.equal(ingested.alertIds.length, 1);
    const path = `/sites/${site.id}/safety-alerts/${ingested.alertIds[0]}/detections/${eventId}/identity-subjects`;
    const commandPath = `${path}/0/decisions`;
    const command = {
      commandId: randomUUID(),
      expectedRevision: 0,
      expectedEventHash: computeCanonicalPayloadHash(event),
      action: 'RESOLVE',
      reason: 'Synthetic exact observation retry.',
      workerId: worker.id,
      evidenceIndex: 0,
      expectedEvidenceSha256: createHash('sha256').update(syntheticJpeg).digest('hex'),
    };
    let responseCount = 0;
    let acknowledge!: (data: unknown) => void;
    let rejectAcknowledge!: (error: Error) => void;
    const committedResponse = new Promise<unknown>((resolve, reject) => {
      acknowledge = resolve;
      rejectAcknowledge = reject;
    });
    const proxy = createHttpServer((incoming, response) => {
      const upstream = httpRequest(
        `${base}${commandPath}`,
        {
          method: 'POST',
          headers: {
            Origin: origin,
            Authorization: `Bearer ${safety}`,
            'Content-Type': 'application/json',
          },
        },
        (result) => {
          const chunks: Buffer[] = [];
          result.on('data', (chunk: Buffer) => chunks.push(chunk));
          result.on('error', rejectAcknowledge);
          result.on('end', () => {
            responseCount++;
            if (result.statusCode !== 201)
              rejectAcknowledge(new Error('Upstream command did not commit successfully'));
            else acknowledge(JSON.parse(Buffer.concat(chunks).toString()));
            // Intentionally discard the committed response before sending any HTTP headers.
            response.destroy();
          });
        },
      );
      upstream.setTimeout(5_000, () =>
        upstream.destroy(new Error('Upstream response deadline exceeded')),
      );
      upstream.on('error', (error) => {
        rejectAcknowledge(error);
        response.destroy();
      });
      incoming.pipe(upstream);
    });
    t.after(async () => {
      if (proxy.listening)
        await new Promise<void>((resolve, reject) =>
          proxy.close((error) => (error ? reject(error) : resolve())),
        );
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const proxyAddress = proxy.address();
    assert.ok(proxyAddress && typeof proxyAddress !== 'string');
    const [, discardedResponse] = await Promise.all([
      assert.rejects(
        fetch(`http://127.0.0.1:${proxyAddress.port}`, {
          method: 'POST',
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(8_000),
        }),
        TypeError,
      ),
      committedResponse,
    ]);
    const original = parseObservationIdentityMutationResponse(discardedResponse);
    assert.ok(original);
    assert.equal(responseCount, 1);
    assert.equal(original.replayed, false);
    assert.equal(original.recordedDecision.id, command.commandId);
    assert.equal(original.recordedDecision.actorUserId, reviewer.id);
    assert.equal(original.recordedDecision.subjectRef.personObservationIndex, 0);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM observation_identity_decision WHERE id=$1', [
          command.commandId,
        ])
      )[0].n,
      1,
    );
    await new Promise<void>((resolve, reject) =>
      proxy.close((error) => (error ? reject(error) : resolve())),
    );
    await stop(first);
    const second = await start();
    assert.notEqual(second.process.pid, first.process.pid);
    const replay = parseObservationIdentityMutationResponse(
      await request(commandPath, 201, { method: 'POST', token: safety, body: command }),
    );
    assert.ok(replay);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.recordedDecision, original.recordedDecision);
    assert.equal(replay.latestRevision, 1);
    await request(commandPath, 409, {
      method: 'POST',
      token: safety,
      body: { ...command, reason: 'Changed body must never replay.' },
    });
    const history = parseObservationIdentityDecisionPage(
      await request(commandPath, 200, { token: safety }),
    );
    assert.ok(history);
    assert.equal(history.total, 1);
    assert.deepEqual(history.items[0], original.recordedDecision);
    const context = parseObservationIdentityContextResponse(
      await request(path, 200, { token: safety }),
    );
    assert.ok(context);
    assert.equal(context.subjects[0]!.revision, 1);
    assert.equal(context.subjects[0]!.latestManualDecision!.id, command.commandId);
    assert.equal(context.subjects[1]!.revision, 0);
    assert.equal(context.subjects[1]!.latestManualDecision, null);
    const [stored] = await db.query(
      'SELECT payload_hash,raw_payload FROM ai_observation_event WHERE event_id=$1',
      [eventId],
    );
    assert.equal(stored.payload_hash, command.expectedEventHash);
    assert.deepEqual(stored.raw_payload, event);
  },
);
