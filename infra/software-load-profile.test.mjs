import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  validateProfile,
  verifyOwnedContainer,
  summarizeSamples,
  runLoadProfile,
  observeRuntimeCommand,
} from './software-load-profile.mjs';
const site = randomUUID(),
  zone = randomUUID();
const actor = (id = randomUUID()) => ({
  id,
  token: `synthetic-private-${id}`,
  cookie: `smartsite_refresh=private-${id}`,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
});
const profile = (baseUrl = 'http://127.0.0.1:19191/api/v1', extra = {}) => ({
  baseUrl,
  origin: 'http://127.0.0.1:5173',
  durationMs: 160,
  warmupMs: 0,
  thinkMs: 10,
  timeoutMs: 100,
  maxBodyBytes: 1024,
  actors: [actor()],
  routes: [
    {
      name: 'zones',
      kind: 'metadata',
      method: 'GET',
      path: `/sites/${site}/zones?limit=20&offset=0`,
      response: 'PAGE',
    },
  ],
  ...extra,
});
async function server(t, handler) {
  const s = createServer(handler);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => {
    s.closeAllConnections();
    return new Promise((resolve) => s.close(resolve));
  });
  return `http://127.0.0.1:${s.address().port}/api/v1`;
}
function respond(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
function auth(req, res, actors) {
  if (req.url === '/api/v1/auth/me') {
    const a = actors.find((a) => req.headers.authorization === `Bearer ${a.token}`);
    respond(res, a ? 200 : 401, a ? { id: a.id, isActive: true, mustChangePassword: false } : {});
    return true;
  }
  return false;
}

test('rejects remote, credentialed, protected-port and query-bearing load targets', () => {
  for (const baseUrl of [
    'https://example.com/api/v1',
    'http://user:secret@127.0.0.1:19191/api/v1',
    'http://127.0.0.1:5181/api/v1',
    'http://127.0.0.1:5434/api/v1',
    'http://127.0.0.1:19191/api/v1?token=secret',
  ])
    assert.throws(() => validateProfile(profile(baseUrl)), /load profile/i);
});
test('rejects duplicate actors, unsafe routes, excessive budgets and non-name mutations', () => {
  const a = actor();
  for (const extra of [
    { actors: [a, a] },
    { durationMs: 7_200_001 },
    {
      routes: [
        {
          name: 'unsafe',
          kind: 'metadata',
          method: 'GET',
          path: '/integrations/ai/events',
          response: 'PAGE',
        },
      ],
    },
    {
      routes: [
        {
          name: 'write',
          kind: 'write',
          method: 'PATCH',
          path: `/sites/${site}/zones/${zone}`,
          body: { requiredPpe: [] },
          response: 'OBJECT',
        },
      ],
    },
  ])
    assert.throws(() => validateProfile(profile(undefined, extra)), /load profile/i);
});
test('accepts bounded existing metadata and exact name-only Zone mutation', () => {
  const p = validateProfile(
    profile(undefined, {
      routes: [
        {
          name: 'rename',
          kind: 'write',
          method: 'PATCH',
          path: `/sites/${site}/zones/${zone}`,
          body: { name: 'Synthetic load Zone' },
          response: 'OBJECT',
        },
      ],
    }),
  );
  assert.equal(p.actors.length, 1);
  assert.equal(p.routes[0].body.name, 'Synthetic load Zone');
});
const owned = (extra = {}) => ({
  Id: 'a'.repeat(64),
  Image: `sha256:${'b'.repeat(64)}`,
  State: { Running: true, StartedAt: '2026-10-13T12:00:00.000000000Z' },
  Config: {
    User: 'node',
    Labels: { 'smartsite.owner': 'root', 'smartsite.task': 'software-load' },
    Env: [
      'PORT=3000',
      'DATABASE_URL=postgresql://smartsite_test:private@host.docker.internal:5433/smartsite_test?options=-c%20search_path%3Disolated_test_' +
        'c'.repeat(32),
      'MF06_ENQUEUE_ENABLED=false',
      'AI_PREVIEW_SOURCES_JSON={}',
    ],
  },
  HostConfig: {
    ReadonlyRootfs: true,
    PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '19191' }] },
  },
  ...extra,
});
const receipt = {
  containerId: 'a'.repeat(64),
  image: `sha256:${'b'.repeat(64)}`,
  startedAt: '2026-10-13T12:00:00.000000000Z',
  schema: 'isolated_test_' + 'c'.repeat(32),
};
test('owned target rejects recycled ID, wrong schema, wildcard port and enabled processing', () => {
  for (const change of [
    (v) => (v.Id = 'd'.repeat(64)),
    (v) => (v.Config.Env[1] = v.Config.Env[1].replace('5433', '5434')),
    (v) => (v.HostConfig.PortBindings['3000/tcp'][0].HostIp = '0.0.0.0'),
    (v) => (v.Config.Env[2] = 'MF06_ENQUEUE_ENABLED=true'),
  ]) {
    const v = owned();
    change(v);
    assert.throws(() => verifyOwnedContainer(profile(), receipt, v), /owned load target/i);
  }
  assert.equal(verifyOwnedContainer(profile(), receipt, owned()).containerId, receipt.containerId);
});
test('latency/error summary cannot pass on all throttled or unsuccessful attempts', () => {
  const samples = [
    { name: 'zones', kind: 'metadata', durationMs: 5, status: 429, outcome: 'throttled' },
    { name: 'zones', kind: 'metadata', durationMs: 10, status: 500, outcome: 'unexpected' },
    { name: 'zones', kind: 'metadata', durationMs: 100, status: 0, outcome: 'timeout' },
  ];
  const r = summarizeSamples(samples);
  assert.equal(r.total, 3);
  assert.equal(r.successful, 0);
  assert.equal(r.unexpected5xx, 1);
  assert.equal(r.timeouts, 1);
  assert.equal(r.throttled, 1);
  assert.equal(r.latencyBudgetsSatisfied, false);
  assert.equal(r.transportHealthy, false);
});
test('successful nearest-rank percentiles and unsuccessful attempts are reported separately', () => {
  const r = summarizeSamples([
    { name: 'zones', kind: 'metadata', durationMs: 10, status: 200, outcome: 'success' },
    { name: 'zones', kind: 'metadata', durationMs: 30, status: 200, outcome: 'success' },
    { name: 'zones', kind: 'metadata', durationMs: 900, status: 200, outcome: 'success' },
    { name: 'zones', kind: 'metadata', durationMs: 2, status: 429, outcome: 'throttled' },
  ]);
  assert.equal(r.routes[0].successfulLatency.p95Ms, 900);
  assert.equal(r.routes[0].successfulLatency.p99Ms, 900);
  assert.equal(r.routes[0].allAttemptLatency.p50Ms, 10);
  assert.equal(r.latencyBudgetsSatisfied, false);
  assert.equal(r.fullNfrAcceptance, false);
});
test('real HTTP loop maintains one in-flight request per actor and reports authenticated distinct actors', async (t) => {
  const actors = Array.from({ length: 4 }, () => actor());
  let inFlight = 0,
    peak = 0;
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    inFlight++;
    peak = Math.max(peak, inFlight);
    setTimeout(() => {
      inFlight--;
      respond(res, 200, { items: [{ id: zone, siteId: site }], total: 1 });
    }, 12);
  });
  const p = profile(base, { actors, durationMs: 200, timeoutMs: 80 });
  const r = await runLoadProfile(p);
  assert.equal(r.authenticatedActors, 4);
  assert.ok(peak <= 4);
  assert.ok(peak >= 2);
  assert.ok(r.measurement.successful >= 4);
  assert.equal(r.fullNfrAcceptance, false);
  const text = JSON.stringify(r);
  for (const a of actors) {
    assert.ok(!text.includes(a.token));
    assert.ok(!text.includes(a.cookie));
  }
  assert.ok(!text.includes(base));
});
test('auth preflight prevents measurement with a token for the wrong actor', async (t) => {
  const a = actor();
  let measurements = 0;
  const base = await server(t, (req, res) => {
    if (req.url.endsWith('/auth/me'))
      respond(res, 200, { id: randomUUID(), isActive: true, mustChangePassword: false });
    else {
      measurements++;
      respond(res, 200, { items: [], total: 0 });
    }
  });
  await assert.rejects(runLoadProfile(profile(base, { actors: [a] })), /actor authentication/i);
  assert.equal(measurements, 0);
});
test('real timeout and oversized body do not become successful fast samples', async (t) => {
  const actors = [actor()];
  let n = 0;
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    n++;
    if (n % 2) respond(res, 200, { items: ['x'.repeat(3000)], total: 1 });
    else setTimeout(() => respond(res, 200, { items: [], total: 0 }), 80);
  });
  const r = await runLoadProfile(profile(base, { actors, durationMs: 220, timeoutMs: 30 }));
  assert.ok(r.measurement.bodyFailures >= 1);
  assert.ok(r.measurement.timeouts >= 1);
  assert.equal(r.measurement.successful, 0);
  assert.equal(r.measurement.transportHealthy, false);
});
test('429 honors Retry-After without retrying mutation in a tight loop', async (t) => {
  const actors = [actor()];
  let calls = 0;
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    calls++;
    respond(res, 429, {}, { 'retry-after': '1' });
  });
  const r = await runLoadProfile(profile(base, { actors, durationMs: 180 }));
  assert.equal(calls, 1);
  assert.equal(r.measurement.throttled, 1);
  assert.equal(r.measurement.latencyBudgetsSatisfied, false);
});
test('refresh uses WEB cookie and Origin; new token stays out of the report', async (t) => {
  const a = actor();
  a.expiresAt = new Date(Date.now() + 60_000).toISOString();
  let refreshed = 0;
  const base = await server(t, (req, res) => {
    if (req.url === '/api/v1/auth/refresh') {
      assert.equal(req.headers.cookie, a.cookie);
      assert.equal(req.headers.origin, 'http://127.0.0.1:5173');
      let bytes = '';
      req.on('data', (b) => (bytes += b));
      req.on('end', () => {
        assert.deepEqual(JSON.parse(bytes), { clientType: 'WEB' });
        refreshed++;
        respond(
          res,
          200,
          {
            accessToken: 'new-private-token',
            accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
          { 'set-cookie': 'smartsite_refresh=new-private-cookie; HttpOnly' },
        );
      });
      return;
    }
    if (req.url.endsWith('/auth/me')) {
      respond(res, 200, { id: a.id, isActive: true, mustChangePassword: false });
      return;
    }
    assert.equal(req.headers.authorization, 'Bearer new-private-token');
    respond(res, 200, { items: [], total: 0 });
  });
  const r = await runLoadProfile(profile(base, { actors: [a] }));
  assert.equal(refreshed, 1);
  assert.equal(r.authRefreshes, 1);
  assert.ok(!JSON.stringify(r).includes('new-private'));
  assert.ok(r.measurement.successful > 0);
});
test('malformed successful page and caller cancellation cannot claim completed profile', async (t) => {
  const actors = [actor()];
  const controller = new AbortController();
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    respond(res, 200, { total: 0 });
  });
  setTimeout(() => controller.abort(), 70);
  const r = await runLoadProfile(profile(base, { actors, durationMs: 300 }), {
    signal: controller.signal,
  });
  assert.ok(r.measurement.bodyFailures > 0);
  assert.equal(r.completed, false);
  assert.equal(r.fullNfrAcceptance, false);
});

test('an empty or wrong record cannot become a successful detail or rename sample', async (t) => {
  const actors = [actor()];
  let n = 0;
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    n++;
    respond(res, 200, n % 2 ? {} : { id: randomUUID(), siteId: site, name: 'wrong record' });
  });
  const r = await runLoadProfile(
    profile(base, {
      actors,
      routes: [
        {
          name: 'zone_detail',
          kind: 'detail',
          method: 'GET',
          path: `/sites/${site}/zones/${zone}`,
          response: 'OBJECT',
        },
      ],
    }),
  );
  assert.equal(r.measurement.successful, 0);
  assert.ok(r.measurement.bodyFailures > 0);
});

test('ambiguous refresh failure is not retried and cannot begin measurement', async (t) => {
  const a = actor();
  a.expiresAt = new Date(Date.now() + 60_000).toISOString();
  let refreshes = 0,
    measurements = 0;
  const base = await server(t, (req, res) => {
    if (req.url.endsWith('/auth/refresh')) {
      refreshes++;
      respond(res, 500, {});
    } else {
      measurements++;
      respond(res, 200, { items: [], total: 0 });
    }
  });
  await assert.rejects(runLoadProfile(profile(base, { actors: [a] })), /no ambiguous retry/);
  assert.equal(refreshes, 1);
  assert.equal(measurements, 0);
});

test('wrong-camera Region page cannot be counted as successful scoped metadata', async (t) => {
  const actors = [actor()],
    camera = randomUUID();
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    respond(res, 200, { items: [{ id: randomUUID(), cameraId: randomUUID() }], total: 1 });
  });
  const r = await runLoadProfile(
    profile(base, {
      actors,
      routes: [
        {
          name: 'regions',
          kind: 'metadata',
          method: 'GET',
          path: `/sites/${site}/cameras/${camera}/regions?limit=20&offset=0`,
          response: 'PAGE',
        },
      ],
    }),
  );
  assert.equal(r.measurement.successful, 0);
  assert.ok(r.measurement.bodyFailures > 0);
});

test('progress snapshots remain internally consistent while asynchronous observer IO runs', async (t) => {
  const actors = Array.from({ length: 3 }, () => actor());
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    setTimeout(() => respond(res, 200, { items: [], total: 0 }), 2);
  });
  const snapshots = [];
  await runLoadProfile(profile(base, { actors, durationMs: 15500 }), {
    onProgress: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      snapshots.push(snapshot);
    },
  });
  assert.ok(snapshots.length > 0);
  for (const snapshot of snapshots)
    for (const route of snapshot.measurement.routes) {
      assert.equal(
        Object.values(route.statusCounts).reduce((sum, n) => sum + n, 0),
        route.attempts,
      );
    }
});

test('a slow runtime observation does not block requests or create client timeout samples', async (t) => {
  const actors = [actor()];
  const base = await server(t, (req, res) => {
    if (auth(req, res, actors)) return;
    setTimeout(() => respond(res, 200, { items: [], total: 0 }), 10);
  });
  const pending = runLoadProfile(profile(base, { actors, durationMs: 260, timeoutMs: 80 }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  const output = await observeRuntimeCommand(process.execPath, [
    '-e',
    'setTimeout(()=>console.log("observed"),300)',
  ]);
  assert.equal(output.trim(), 'observed');
  const r = await pending;
  assert.equal(r.measurement.timeouts, 0);
  assert.ok(r.measurement.successful >= 5);
});

test('failed runtime observation omits child private stderr from its error', async () => {
  await assert.rejects(
    observeRuntimeCommand(process.execPath, [
      '-e',
      'console.error("FAKE_PRIVATE_OBSERVER_VALUE");process.exit(1)',
    ]),
    (error) =>
      error.message === 'OWNED_OBSERVATION_FAILED' &&
      !JSON.stringify(error).includes('FAKE_PRIVATE'),
  );
});
