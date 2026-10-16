import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const metadata = new RegExp(
  `^/sites(?:/${uuid}(?:/(?:zones|cameras)(?:/${uuid}(?:/regions)?)?|/safety-alerts(?:/${uuid})?|/mf06-assessments(?:/${uuid})?)?)?$`,
);
const rename = new RegExp(`^/sites/${uuid}/zones/${uuid}$`);
function fail(message = 'Invalid software load profile') {
  throw new Error(message);
}
function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
export function validateProfile(input) {
  const p = structuredClone(input);
  let url;
  try {
    url = new URL(p.baseUrl);
  } catch {
    fail();
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/v1' ||
    !integer(Number(url.port), 1024, 65535) ||
    [5181, 5433, 5434].includes(Number(url.port))
  )
    fail();
  if (
    p.origin !== 'http://127.0.0.1:5173' ||
    !integer(p.durationMs, 1, 7_200_000) ||
    !integer(p.warmupMs, 0, 300_000) ||
    !integer(p.thinkMs, 1, 60_000) ||
    !integer(p.timeoutMs, 1, 10_000) ||
    !integer(p.maxBodyBytes, 64, 131_072)
  )
    fail();
  if (!Array.isArray(p.actors) || p.actors.length < 1 || p.actors.length > 20) fail();
  const ids = new Set(),
    tokens = new Set();
  for (const a of p.actors) {
    if (
      !new RegExp(`^${uuid}$`).test(a.id) ||
      typeof a.token !== 'string' ||
      !a.token ||
      a.token.length > 4096 ||
      /[\s\r\n]/.test(a.token) ||
      typeof a.cookie !== 'string' ||
      !/^smartsite_refresh=[A-Za-z0-9._-]+$/.test(a.cookie) ||
      a.cookie.length > 4096 ||
      !Number.isFinite(Date.parse(a.expiresAt)) ||
      ids.has(a.id) ||
      tokens.has(a.token)
    )
      fail();
    ids.add(a.id);
    tokens.add(a.token);
  }
  if (!Array.isArray(p.routes) || p.routes.length < 1 || p.routes.length > 32) fail();
  const names = new Set();
  for (const r of p.routes) {
    if (
      !/^[a-z][a-z0-9_-]{0,31}$/.test(r.name) ||
      names.has(r.name) ||
      !['metadata', 'detail', 'write'].includes(r.kind) ||
      !['PAGE', 'OBJECT'].includes(r.response) ||
      typeof r.path !== 'string' ||
      r.path.includes('%') ||
      r.path.includes('#')
    )
      fail();
    names.add(r.name);
    const [path, query] = r.path.split('?');
    if (r.path.split('?').length > 2) fail();
    if (r.method === 'GET') {
      if (!metadata.test(path) || r.body !== undefined || r.kind === 'write') fail();
      if (query !== undefined) {
        const seen = new Set();
        for (const [key, value] of new URLSearchParams(query)) {
          if (
            !['limit', 'offset'].includes(key) ||
            seen.has(key) ||
            !/^\d+$/.test(value) ||
            !integer(Number(value), key === 'limit' ? 1 : 0, key === 'limit' ? 100 : 100_000)
          )
            fail();
          seen.add(key);
        }
      }
    } else if (r.method === 'PATCH') {
      if (
        !rename.test(path) ||
        query !== undefined ||
        r.kind !== 'write' ||
        r.response !== 'OBJECT' ||
        !r.body ||
        Object.keys(r.body).length !== 1 ||
        typeof r.body.name !== 'string' ||
        !r.body.name.trim() ||
        [...r.body.name].length > 100
      )
        fail();
    } else fail();
  }
  return p;
}

/** CLI ownership preflight. Never accept a default schema or a recycled container name. */
export function verifyOwnedContainer(input, receipt, state) {
  const p = validateProfile(input),
    bad = () => fail('Invalid owned load target');
  if (
    !receipt ||
    !/^[a-f0-9]{64}$/.test(receipt.containerId) ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.image) ||
    !/^isolated_test_[a-f0-9]{32}$/.test(receipt.schema)
  )
    bad();
  if (
    state.Id !== receipt.containerId ||
    state.Image !== receipt.image ||
    !state.State?.Running ||
    state.State.StartedAt !== receipt.startedAt ||
    state.Config?.User !== 'node' ||
    !state.HostConfig?.ReadonlyRootfs ||
    state.Config.Labels?.['smartsite.owner'] !== 'root' ||
    state.Config.Labels?.['smartsite.task'] !== 'software-load'
  )
    bad();
  const env = Object.fromEntries(
    state.Config.Env.map((value) => {
      const i = value.indexOf('=');
      return [value.slice(0, i), value.slice(i + 1)];
    }),
  );
  let db;
  try {
    db = new URL(env.DATABASE_URL);
  } catch {
    bad();
  }
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    db.hostname !== 'host.docker.internal' ||
    db.port !== '5433' ||
    db.username !== 'smartsite_test' ||
    db.pathname !== '/smartsite_test' ||
    db.searchParams.get('options') !== `-c search_path=${receipt.schema}` ||
    env.MF06_ENQUEUE_ENABLED !== 'false' ||
    env.AI_PREVIEW_SOURCES_JSON !== '{}'
  )
    bad();
  const bindings = Object.values(state.HostConfig.PortBindings ?? {}).flat();
  const binding = state.HostConfig.PortBindings?.[`${env.PORT}/tcp`];
  if (
    bindings.length !== 1 ||
    binding?.length !== 1 ||
    binding[0].HostIp !== '127.0.0.1' ||
    binding[0].HostPort !== new URL(p.baseUrl).port
  )
    bad();
  return {
    containerId: state.Id,
    image: state.Image,
    startedAt: state.State.StartedAt,
    schema: receipt.schema,
    loopbackPublished: true,
    enqueueAndPreviewConfiguredOff: true,
  };
}

// Millisecond histograms are fixed-size: request count never grows the retained sample array.
function accumulator() {
  return {
    total: 0,
    successful: 0,
    throttled: 0,
    timeouts: 0,
    networkFailures: 0,
    bodyFailures: 0,
    unexpected5xx: 0,
    unexpected: 0,
    cancelled: 0,
    routes: new Map(),
  };
}
function add(a, s) {
  let r = a.routes.get(s.name);
  if (!r) {
    r = {
      name: s.name,
      kind: s.kind,
      attempts: 0,
      successful: 0,
      statusCounts: {},
      all: new Uint32Array(10_001),
      success: new Uint32Array(10_001),
    };
    a.routes.set(s.name, r);
  }
  const bucket = Math.min(10_000, Math.max(0, Math.ceil(s.durationMs)));
  r.all[bucket]++;
  r.attempts++;
  r.statusCounts[s.status] = (r.statusCounts[s.status] ?? 0) + 1;
  a.total++;
  if (s.outcome === 'success') {
    a.successful++;
    r.successful++;
    r.success[bucket]++;
  } else if (s.outcome === 'throttled') a.throttled++;
  else if (s.outcome === 'timeout') a.timeouts++;
  else if (s.outcome === 'network') a.networkFailures++;
  else if (s.outcome === 'body') a.bodyFailures++;
  else if (s.outcome === 'cancelled') a.cancelled++;
  else {
    a.unexpected++;
    if (s.status >= 500 && s.status <= 599) a.unexpected5xx++;
  }
}
function percentile(h, count, q) {
  if (!count) return null;
  const rank = Math.ceil(count * q);
  let n = 0;
  for (let i = 0; i < h.length; i++) {
    n += h[i];
    if (n >= rank) return i;
  }
  return null;
}
function latency(h, n) {
  return {
    samples: n,
    p50Ms: percentile(h, n, 0.5),
    p95Ms: percentile(h, n, 0.95),
    p99Ms: percentile(h, n, 0.99),
  };
}
function summary(a) {
  const routes = [...a.routes.values()].map((r) => ({
    name: r.name,
    kind: r.kind,
    attempts: r.attempts,
    successful: r.successful,
    statusCounts: { ...r.statusCounts },
    allAttemptLatency: latency(r.all, r.attempts),
    successfulLatency: latency(r.success, r.successful),
  }));
  const latencyBudgetsSatisfied =
    routes.length > 0 &&
    routes.every(
      (r) => r.successful > 0 && r.successfulLatency.p95Ms <= (r.kind === 'metadata' ? 500 : 1000),
    );
  const unexpected5xxFraction = a.total ? a.unexpected5xx / a.total : null;
  const transportHealthy =
    a.successful > 0 &&
    a.throttled === 0 &&
    a.timeouts === 0 &&
    a.networkFailures === 0 &&
    a.bodyFailures === 0 &&
    a.cancelled === 0 &&
    a.unexpected === a.unexpected5xx &&
    unexpected5xxFraction < 0.01;
  return {
    ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'routes')),
    routes,
    unexpected5xxFraction,
    latencyBudgetsSatisfied,
    transportHealthy,
    fullNfrAcceptance: false,
  };
}
export function summarizeSamples(samples) {
  const a = accumulator();
  for (const s of samples) add(a, s);
  return summary(a);
}

export async function observeRuntimeCommand(executable, args) {
  try {
    const { stdout } = await promisify(execFile)(executable, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 2_097_152,
    });
    return stdout;
  } catch {
    // Node's original child-process error may contain private argv/stdout/stderr.
    throw new Error('OWNED_OBSERVATION_FAILED');
  }
}

async function boundedBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('BODY_LIMIT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString('utf8');
}
async function call(p, actor, path, method = 'GET', body, refresh = false, signal) {
  const timeout = AbortSignal.timeout(p.timeoutMs),
    combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  try {
    const response = await fetch(p.baseUrl + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: p.origin,
        ...(refresh ? { Cookie: actor.cookie } : { Authorization: `Bearer ${actor.token}` }),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: combined,
    });
    const text = await boundedBody(response, p.maxBodyBytes);
    return { status: response.status, text, headers: response.headers };
  } catch (error) {
    if (signal?.aborted) return { status: 0, outcome: 'cancelled' };
    if (timeout.aborted) return { status: 0, outcome: 'timeout' };
    return { status: 0, outcome: error.message === 'BODY_LIMIT' ? 'body' : 'network' };
  }
}
function cooldown(headers) {
  const raw = headers?.get('retry-after');
  if (!raw) return 60_000;
  if (/^\d+$/.test(raw)) return Math.min(60_000, Math.max(1000, Number(raw) * 1000));
  const n = Date.parse(raw) - Date.now();
  return Number.isFinite(n) ? Math.min(60_000, Math.max(1000, n)) : 60_000;
}
function validJson(text, route) {
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    if (
      route.response === 'PAGE' &&
      (!Array.isArray(v.items) || !Number.isSafeInteger(v.total) || v.total < 0)
    )
      return false;
    if (route.response === 'OBJECT') {
      const expectedId = route.path.split('?')[0].split('/').at(-1);
      const actualId = v.id ?? v.alertId ?? v.assessmentId;
      if (actualId !== expectedId) return false;
      if (route.method === 'PATCH' && v.name !== route.body.name.trim()) return false;
    }
    const site = route.path.match(new RegExp(`^/sites/(${uuid})`))?.[1];
    const regionCamera = route.path.match(new RegExp(`/cameras/(${uuid})/regions(?:\\?|$)`))?.[1];
    const rows = route.response === 'PAGE' ? v.items : [v];
    return (
      !site ||
      rows.every(
        (row) =>
          row &&
          typeof row === 'object' &&
          (row.siteId === undefined || row.siteId === site) &&
          (!regionCamera || row.cameraId === regionCamera),
      )
    );
  } catch {
    return false;
  }
}

/** Closed-loop profile: one request per actor, no mutation retries or rate-limit relaxation. */
export async function runLoadProfile(input, { signal, onProgress } = {}) {
  const p = validateProfile(input),
    actors = p.actors.map((a) => ({ ...a }));
  let authRefreshes = 0,
    refreshFailure = false;
  let refreshTail = Promise.resolve();
  const refresh = async (a) => {
    if (Date.parse(a.expiresAt) - Date.now() > 120_000) return;
    const prior = refreshTail;
    let release;
    refreshTail = new Promise((resolve) => (release = resolve));
    await prior;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await call(
          p,
          a,
          '/auth/refresh',
          'POST',
          { clientType: 'WEB' },
          true,
          signal,
        );
        if (result.status === 429) {
          await wait(cooldown(result.headers), undefined, { signal }).catch(() => {});
          continue;
        }
        if (result.status !== 200) fail('Actor authentication refresh failed; no ambiguous retry');
        let value;
        try {
          value = JSON.parse(result.text);
        } catch {
          fail('Actor authentication refresh failed');
        }
        const cookie = result.headers.get('set-cookie')?.split(';')[0];
        if (
          typeof value.accessToken !== 'string' ||
          /[\s\r\n]/.test(value.accessToken) ||
          !value.accessToken ||
          !cookie ||
          !/^smartsite_refresh=[A-Za-z0-9._-]+$/.test(cookie) ||
          !Number.isFinite(Date.parse(value.accessTokenExpiresAt)) ||
          Date.parse(value.accessTokenExpiresAt) <= Date.now() + 120_000
        )
          fail('Actor authentication refresh failed');
        a.token = value.accessToken;
        a.cookie = cookie;
        a.expiresAt = value.accessTokenExpiresAt;
        authRefreshes++;
        return;
      }
      fail('Actor authentication refresh rate limit unresolved');
    } finally {
      release();
    }
  };
  for (const a of actors) {
    await refresh(a);
    const result = await call(p, a, '/auth/me', undefined, undefined, false, signal);
    let user;
    try {
      user = JSON.parse(result.text);
    } catch {
      fail('Actor authentication preflight failed');
    }
    if (
      result.status !== 200 ||
      user.id !== a.id ||
      user.isActive !== true ||
      user.mustChangePassword !== false
    )
      fail('Actor authentication preflight failed');
  }
  const began = performance.now(),
    measureAt = began + p.warmupMs,
    endAt = measureAt + p.durationMs;
  const warmup = accumulator(),
    measured = accumulator();
  let lastProgress = began,
    reportPending = false;
  const routeCooldown = new Map();
  const progress = async () => {
    if (!onProgress || reportPending || performance.now() - lastProgress < 15_000) return;
    reportPending = true;
    lastProgress = performance.now();
    try {
      await onProgress({
        elapsedMs: performance.now() - began,
        warmup: summary(warmup),
        measurement: summary(measured),
        authenticatedActors: actors.length,
        loadGeneratorRssBytes: process.memoryUsage().rss,
      });
    } finally {
      reportPending = false;
    }
  };
  await Promise.all(
    actors.map(async (a, index) => {
      let iteration = 0;
      while (performance.now() < endAt && !signal?.aborted && !refreshFailure) {
        try {
          await refresh(a);
        } catch {
          refreshFailure = true;
          break;
        }
        const r = p.routes[(index + iteration) % p.routes.length];
        const pausedUntil = routeCooldown.get(r.name) ?? 0;
        if (pausedUntil > performance.now()) {
          await wait(
            Math.min(pausedUntil - performance.now(), Math.max(1, endAt - performance.now())),
            undefined,
            { signal },
          ).catch(() => {});
          continue;
        }
        const start = performance.now();
        if (start >= endAt) break;
        const result = await call(p, a, r.path, r.method, r.body, false, signal);
        const outcome =
          result.outcome ??
          (result.status === 429
            ? 'throttled'
            : result.status === 200
              ? validJson(result.text, r)
                ? 'success'
                : 'body'
              : 'unexpected');
        if (outcome === 'throttled')
          routeCooldown.set(r.name, performance.now() + cooldown(result.headers));
        add(start < measureAt ? warmup : measured, {
          name: r.name,
          kind: r.kind,
          durationMs: performance.now() - start,
          status: result.status,
          outcome,
        });
        iteration++;
        await progress();
        await wait(Math.min(p.thinkMs, Math.max(1, endAt - performance.now())), undefined, {
          signal,
        }).catch(() => {});
      }
    }),
  );
  const completed = !signal?.aborted && !refreshFailure && performance.now() >= endAt;
  const measurement = summary(measured);
  // A route never sampled is not an implicitly successful route.
  measurement.latencyBudgetsSatisfied &&= p.routes.every((r) =>
    measurement.routes.some((s) => s.name === r.name && s.successful > 0),
  );
  return {
    mode: 'OWNED_SYNTHETIC_SOFTWARE_CLOSED_LOOP_NOT_BROWSER_OR_PRODUCTION_ACCEPTANCE',
    completed,
    authenticatedActors: actors.length,
    authRefreshes,
    authRefreshFailed: refreshFailure,
    warmupMs: p.warmupMs,
    requestedMeasurementMs: p.durationMs,
    elapsedMs: performance.now() - began,
    measuredElapsedMs: Math.max(0, performance.now() - measureAt),
    warmup: summary(warmup),
    measurement,
    thirtyMinuteTwentyActorProfile: completed && actors.length === 20 && p.durationMs >= 1_800_000,
    loadGeneratorRssBytes: process.memoryUsage().rss,
    fullNfrAcceptance: false,
  };
}

async function cli() {
  if (process.argv.length !== 4 || !isAbsolute(process.argv[2]) || !isAbsolute(process.argv[3]))
    fail();
  const input = JSON.parse(await readFile(process.argv[2], 'utf8')),
    p = validateProfile(input);
  const state = JSON.parse(
    execFileSync('docker', ['inspect', input.owner?.containerId, '--format', '{{json .}}'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }),
  );
  const target = verifyOwnedContainer(p, input.owner, state);
  await mkdir(process.argv[3]); // Exclusive output; preserve existing receipts and private inputs.
  const output = process.argv[3],
    resources = [];
  const controller = new AbortController();
  process.once('SIGTERM', () => controller.abort());
  process.once('SIGINT', () => controller.abort());
  const info = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    target,
    routeNames: p.routes.map((r) => r.name),
    actorCount: p.actors.length,
    declaredDataset: input.datasetCounts ?? null,
    datasetVerifiedByThisTool: false,
    fullNfrAcceptance: false,
  };
  await writeFile(join(output, 'owner.json'), JSON.stringify(info, null, 2), { flag: 'wx' });
  const onProgress = async (progress) => {
    // Recheck exact container identity before reading only PID1's numeric RSS.
    const current = JSON.parse(
      await observeRuntimeCommand('docker', [
        'inspect',
        target.containerId,
        '--format',
        '{{json .}}',
      ]),
    );
    verifyOwnedContainer(p, input.owner, current);
    let backendRssBytes = null;
    try {
      const bytes = await observeRuntimeCommand('docker', [
        'exec',
        target.containerId,
        'node',
        '-e',
        "const fs=require('fs');const s=fs.readFileSync('/proc/1/status','utf8');const r=s.match(/^VmRSS:\\s+(\\d+) kB$/m);if(!r)process.exit(1);console.log(Number(r[1])*1024)",
      ]);
      backendRssBytes = Number(bytes.trim());
      if (!Number.isSafeInteger(backendRssBytes) || backendRssBytes < 1) backendRssBytes = null;
    } catch {
      /* A missing metric stays missing; no invented zero. */
    }
    resources.push({
      elapsedMs: progress.elapsedMs,
      backendPid1RssBytes: backendRssBytes,
      loadGeneratorRssBytes: progress.loadGeneratorRssBytes,
    });
    await writeFile(
      join(output, 'progress.json'),
      JSON.stringify({ ...progress, target, resources, fullNfrAcceptance: false }, null, 2),
    );
  };
  const result = await runLoadProfile(p, { signal: controller.signal, onProgress });
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ ...result, target, resources, datasetVerifiedByThisTool: false }, null, 2),
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      completed: result.completed,
      actors: result.authenticatedActors,
      attempts: result.measurement.total,
      successful: result.measurement.successful,
      throttled: result.measurement.throttled,
      fullNfrAcceptance: false,
    }),
  );
  if (
    !result.completed ||
    !result.measurement.transportHealthy ||
    !result.measurement.latencyBudgetsSatisfied
  )
    process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  cli().catch(() => {
    console.error(
      'SOFTWARE_LOAD_PROFILE_FAILED; inspect owned output without exposing private inputs',
    );
    process.exitCode = 1;
  });
