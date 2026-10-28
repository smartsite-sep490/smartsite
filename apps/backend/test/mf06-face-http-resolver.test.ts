import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { HttpSafetyIdentityResolver } from '../src/modules/safety/assessments/mf06-face-http-resolver.js';
import { Mf06RetryableWorkError } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import {
  inspectSafetyFaceResponse,
  type SafetyFaceInvocation,
} from '../src/modules/safety/assessments/safety-identity-resolver.port.js';

const BASE_URL = 'https://ai-identity.internal:8443';
const SERVICE_TOKEN = 'synthetic-ai-service-bearer-token-2026';
const FERNET_TEMPLATE = 'g' + 'A'.repeat(139);

test('correlated temporary Face outage reaches the existing worker retry policy', async () => {
  const invocation = makeInvocation();
  const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
    jsonResponse({
      ...invocation,
      state: 'UNAVAILABLE',
      provenance: 'TRUSTED_SERVICE',
      reason: 'SERVICE_UNAVAILABLE',
    }),
  );
  await assert.rejects(
    resolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [makeCandidate(1)] },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof Mf06RetryableWorkError && error.code === 'RESOLVER_UNAVAILABLE',
  );
});

test('wrong-correlation outage and genuine NO_MATCH never become retry requests', async () => {
  const invocation = makeInvocation();
  for (const [wire, reason] of [
    [
      { ...invocation, bindingDigest: 'f'.repeat(64), reason: 'SERVICE_UNAVAILABLE' },
      'CORRELATION_MISMATCH',
    ],
    [{ ...invocation, reason: 'NO_MATCH' }, 'IDENTITY_UNAVAILABLE'],
  ] as const) {
    const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
      jsonResponse({ ...wire, state: 'UNAVAILABLE', provenance: 'TRUSTED_SERVICE' }),
    );
    assert.deepEqual(
      await resolver.resolve(
        { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [makeCandidate(1)] },
        new AbortController().signal,
      ),
      { state: 'UNAVAILABLE', reason },
    );
  }
});

const VALID_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const VALID_CROP_SHA256 = createHash('sha256').update(VALID_JPEG_BYTES).digest('hex');

function makeInvocation(overrides: Partial<SafetyFaceInvocation> = {}): SafetyFaceInvocation {
  return {
    protocolVersion: 'SAFETY_MF06_FACE_V1',
    purpose: 'SAFETY_MF06',
    invocationId: '11111111-1111-4111-8111-111111111111',
    bindingDigest: 'a'.repeat(64),
    requestId: '22222222-2222-4222-8222-222222222222',
    eventId: '33333333-3333-4333-8333-333333333333',
    payloadHash: 'b'.repeat(64),
    siteId: '44444444-4444-4444-8444-444444444444',
    cameraId: '55555555-5555-4555-8555-555555555555',
    cameraExternalId: 'synthetic-camera',
    streamSessionId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-11T00:00:00.000Z',
    originalCapturedAt: '2026-10-11T00:00:00.000Z',
    personObservationIndex: 2,
    zoneObservationIndex: 3,
    trackId: 17,
    regionId: '77777777-7777-4777-8777-777777777777',
    geometryVersion: 4,
    zoneId: '88888888-8888-4888-8888-888888888888',
    requestRevision: 1,
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    frameSha256: 'c'.repeat(64),
    cropSha256: VALID_CROP_SHA256,
    cropAlgorithmVersion: 'PERSON_FLOOR_CEIL_JPEG95_444_V1',
    modelVersion: 'synthetic-face-v1',
    ...overrides,
  };
}

function makeCandidate(index = 1) {
  const hex = index.toString(16).padStart(2, '0');
  return {
    profileReferenceHash: hex.repeat(32),
    profileRevision: `${hex.repeat(4)}-${hex.repeat(2)}-4${hex.padStart(3, '0')}-8${hex.padStart(3, '0')}-${hex.repeat(6)}`,
    encryptedTemplate: FERNET_TEMPLATE,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bytes.byteLength),
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

test('1. valid request sends exact authenticated POST /v1/identity/safety-mf06/resolve payload and returns correlated TRUSTED_SERVICE response', async () => {
  const invocation = makeInvocation();
  const candidates = [makeCandidate(1), makeCandidate(2)];
  const wireSuccess = {
    ...invocation,
    state: 'CANDIDATE' as const,
    provenance: 'TRUSTED_SERVICE' as const,
    profileReferenceHash: candidates[0]!.profileReferenceHash,
    profileRevision: candidates[0]!.profileRevision,
  };

  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse(wireSuccess);
  };

  const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, fetcher);
  const result = await resolver.resolve(
    { invocation, cropBytes: Buffer.from(VALID_JPEG_BYTES), candidates },
    new AbortController().signal,
  );

  assert.equal(capturedUrl, `${BASE_URL}/v1/identity/safety-mf06/resolve`);
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.redirect, 'error');
  assert.equal(capturedInit?.cache, 'no-store');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('authorization'), `Bearer ${SERVICE_TOKEN}`);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('accept'), 'application/json');

  const parsedBody = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
  assert.deepEqual(parsedBody, {
    invocation,
    cropJpegBase64: VALID_JPEG_BYTES.toString('base64'),
    candidates,
  });

  assert.deepEqual(result, wireSuccess);
  assert.deepEqual(inspectSafetyFaceResponse(invocation, result, 'TRUSTED_SERVICE'), {
    state: 'CANDIDATE_REFERENCE',
    profileReferenceHash: candidates[0]!.profileReferenceHash,
    profileRevision: candidates[0]!.profileRevision,
    provenance: 'TRUSTED_SERVICE',
  });
});

test('2. mismatched, non-JPEG, empty, or oversized cropBytes are rejected before calling fetch', async () => {
  let fetchCalls = 0;
  const fetcher: typeof fetch = async () => {
    fetchCalls += 1;
    return jsonResponse({});
  };
  const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, fetcher);
  const candidates = [makeCandidate(1)];
  const signal = new AbortController().signal;

  const nonJpeg = Buffer.from('not-a-jpeg-file-at-all');
  const nonJpegSha = createHash('sha256').update(nonJpeg).digest('hex');
  const oversizedJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.alloc(1_048_575),
    Buffer.from([0xff, 0xd9]),
  ]);
  const oversizedSha = createHash('sha256').update(oversizedJpeg).digest('hex');

  for (const badInput of [
    { invocation: makeInvocation(), cropBytes: Buffer.alloc(0), candidates },
    {
      invocation: makeInvocation(),
      cropBytes: Buffer.concat([VALID_JPEG_BYTES.subarray(0, -1), Buffer.from([0x00])]),
      candidates,
    },
    {
      invocation: makeInvocation({ cropSha256: nonJpegSha }),
      cropBytes: nonJpeg,
      candidates,
    },
    {
      invocation: makeInvocation({ cropSha256: 'f'.repeat(64) }),
      cropBytes: VALID_JPEG_BYTES,
      candidates,
    },
    {
      invocation: makeInvocation({ cropSha256: oversizedSha }),
      cropBytes: oversizedJpeg,
      candidates,
    },
  ]) {
    const res = (await resolver.resolve(badInput, signal)) as { state: string; reason: string };
    assert.equal(res.state, 'UNAVAILABLE');
  }
  assert.equal(fetchCalls, 0);
});

test('3. invalid, duplicate, or >32 candidates and unsafe base URLs fail closed without fetch', async () => {
  let fetchCalls = 0;
  const fetcher: typeof fetch = async () => {
    fetchCalls += 1;
    return jsonResponse({});
  };
  const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, fetcher);
  const invocation = makeInvocation();
  const signal = new AbortController().signal;
  const c1 = makeCandidate(1);
  const c2 = makeCandidate(2);

  const thirtyThreeCandidates = Array.from({ length: 33 }, (_, idx) => makeCandidate(idx + 1));

  for (const badCandidates of [
    [c1, { ...c2, profileReferenceHash: c1.profileReferenceHash }],
    [c1, { ...c2, profileRevision: c1.profileRevision }],
    [{ ...c1, profileReferenceHash: 'G'.repeat(64) }],
    [{ ...c1, profileRevision: 'not-a-uuid' }],
    [{ ...c1, encryptedTemplate: 'short-template' }],
    [{ ...c1, encryptedTemplate: 'g' + 'A'.repeat(32768) }],
    thirtyThreeCandidates,
  ]) {
    const res = (await resolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates: badCandidates },
      signal,
    )) as { state: string };
    assert.equal(res.state, 'UNAVAILABLE');
  }

  for (const badBaseUrl of [
    'http://ai-identity.internal',
    'http://127.0.0.1:8443',
    'ftp://ai-identity.internal',
    'https://user:pass@ai-identity.internal',
    'https://ai-identity.internal?env=dev',
    'https://ai-identity.internal#frag',
  ]) {
    const badOriginResolver = new HttpSafetyIdentityResolver(badBaseUrl, SERVICE_TOKEN, fetcher);
    const res = (await badOriginResolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [c1] },
      signal,
    )) as { state: string };
    assert.equal(res.state, 'UNAVAILABLE');
  }
  assert.equal(fetchCalls, 0);
});

test('4. correlation mismatch, untrusted provenance, or service-reported UNAVAILABLE fail closed', async () => {
  const invocation = makeInvocation();
  const c1 = makeCandidate(1);
  const signal = new AbortController().signal;

  const mismatchedWire = {
    ...invocation,
    requestId: '99999999-9999-4999-8999-999999999999',
    state: 'CANDIDATE',
    provenance: 'TRUSTED_SERVICE',
    profileReferenceHash: c1.profileReferenceHash,
    profileRevision: c1.profileRevision,
  };
  const resolverMismatch = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
    jsonResponse(mismatchedWire),
  );
  const mismatchResult = await resolverMismatch.resolve(
    { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [c1] },
    signal,
  );
  assert.deepEqual(mismatchResult, {
    state: 'UNAVAILABLE',
    reason: 'CORRELATION_MISMATCH',
  });

  const syntheticProvenanceWire = {
    ...invocation,
    state: 'CANDIDATE',
    provenance: 'SYNTHETIC_TEST',
    profileReferenceHash: c1.profileReferenceHash,
    profileRevision: c1.profileRevision,
  };
  const resolverUntrusted = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
    jsonResponse(syntheticProvenanceWire),
  );
  const untrustedResult = await resolverUntrusted.resolve(
    { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [c1] },
    signal,
  );
  assert.deepEqual(untrustedResult, {
    state: 'UNAVAILABLE',
    reason: 'INVALID_RESPONSE',
  });

  const resolverUnlisted = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
    jsonResponse({
      ...syntheticProvenanceWire,
      provenance: 'TRUSTED_SERVICE',
      profileReferenceHash: 'f'.repeat(64),
    }),
  );
  assert.deepEqual(
    await resolverUnlisted.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [c1] },
      signal,
    ),
    { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' },
  );

  const noMatchWire = {
    ...invocation,
    state: 'UNAVAILABLE',
    provenance: 'TRUSTED_SERVICE',
    reason: 'NO_MATCH',
  };
  const resolverNoMatch = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
    jsonResponse(noMatchWire),
  );
  const noMatchResult = await resolverNoMatch.resolve(
    { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [c1] },
    signal,
  );
  assert.deepEqual(noMatchResult, {
    state: 'UNAVAILABLE',
    reason: 'IDENTITY_UNAVAILABLE',
  });
});

test('5. permanent HTTP errors, wrong content-type, oversized >32768B response, or invalid UTF-8 fail closed', async () => {
  const invocation = makeInvocation();
  const candidates = [makeCandidate(1)];
  const signal = new AbortController().signal;

  const responses: (() => Response)[] = [
    ...[400, 401, 403, 404].map(
      (status) => () => jsonResponse({ state: 'UNAVAILABLE' }, { status }),
    ),
    () =>
      new Response(JSON.stringify({ state: 'UNAVAILABLE' }), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    () =>
      new Response(Buffer.alloc(32_769, 0x61), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ];

  for (const makeResp of responses) {
    const resolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () =>
      makeResp(),
    );
    const result = (await resolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates },
      signal,
    )) as { state: string; reason: string };
    assert.deepEqual(result, { state: 'UNAVAILABLE', reason: 'INVALID_RESPONSE' });
  }
});

test('temporary HTTP failures and connection failures request bounded worker retry without reading error bodies', async () => {
  const invocation = makeInvocation();
  const input = { invocation, cropBytes: VALID_JPEG_BYTES, candidates: [makeCandidate(1)] };
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const resolver = new HttpSafetyIdentityResolver(
      BASE_URL,
      SERVICE_TOKEN,
      async () => new Response(body, { status }),
    );
    await assert.rejects(
      resolver.resolve(input, new AbortController().signal),
      Mf06RetryableWorkError,
    );
    assert.equal(cancelled, true);
  }
  const offline = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () => {
    throw new TypeError('synthetic connection failure');
  });
  await assert.rejects(
    offline.resolve(input, new AbortController().signal),
    Mf06RetryableWorkError,
  );
});

test('interrupted response body requests retry without accepting partial JSON', async () => {
  let pulls = 0;
  const interrupted = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('{"state":'));
      else controller.error(new TypeError('synthetic connection reset'));
    },
  });
  const resolver = new HttpSafetyIdentityResolver(
    BASE_URL,
    SERVICE_TOKEN,
    async () =>
      new Response(interrupted, {
        headers: { 'content-type': 'application/json' },
      }),
  );
  await assert.rejects(
    resolver.resolve(
      {
        invocation: makeInvocation(),
        cropBytes: VALID_JPEG_BYTES,
        candidates: [makeCandidate(1)],
      },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof Mf06RetryableWorkError && error.code === 'RESOLVER_UNAVAILABLE',
  );
});

test('internal Face transport deadline requests retry while caller cancellation still wins', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = {
    invocation: makeInvocation(),
    cropBytes: VALID_JPEG_BYTES,
    candidates: [makeCandidate(1)],
  };
  const resolver = new HttpSafetyIdentityResolver(
    BASE_URL,
    SERVICE_TOKEN,
    async () => new Promise<Response>(() => {}),
  );
  const pending = resolver.resolve(input, new AbortController().signal);
  const checked = assert.rejects(pending, Mf06RetryableWorkError);
  t.mock.timers.tick(8000);
  await checked;
  const controller = new AbortController();
  const cancelled = resolver.resolve(input, controller.signal);
  controller.abort();
  t.mock.timers.tick(8000);
  assert.deepEqual(await cancelled, { state: 'UNAVAILABLE', reason: 'ABORTED' });
});

test('6. pre-aborted signal and mid-stream body cancellation return ABORTED and cancel stream', async () => {
  const invocation = makeInvocation();
  const candidates = [makeCandidate(1)];

  let fetchCalls = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  const preAbortResolver = new HttpSafetyIdentityResolver(BASE_URL, SERVICE_TOKEN, async () => {
    fetchCalls += 1;
    return jsonResponse({});
  });
  assert.deepEqual(
    await preAbortResolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates },
      preAborted.signal,
    ),
    { state: 'UNAVAILABLE', reason: 'ABORTED' },
  );
  assert.equal(fetchCalls, 0);

  let streamCancelled = false;
  const lateAbort = new AbortController();
  const hangingStream = new ReadableStream<Uint8Array>({
    pull() {
      lateAbort.abort();
      return new Promise<void>(() => {});
    },
    cancel() {
      streamCancelled = true;
    },
  });
  const lateResolver = new HttpSafetyIdentityResolver(
    BASE_URL,
    SERVICE_TOKEN,
    async () =>
      new Response(hangingStream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  assert.deepEqual(
    await lateResolver.resolve(
      { invocation, cropBytes: VALID_JPEG_BYTES, candidates },
      lateAbort.signal,
    ),
    { state: 'UNAVAILABLE', reason: 'ABORTED' },
  );
  assert.equal(streamCancelled, true);
});
