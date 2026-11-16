/// <reference types="node" />
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  registerSessionCredential,
  unregisterSessionCredential,
  type CreateSafetyIdentificationRequest,
  type ReassignSafetyIdentificationRequest,
  type RespondSafetyIdentificationRequest,
  type ReviewSafetyIdentificationRequest,
  type SafetyIdentificationAssignee,
  type SafetyIdentificationEvidencePreview,
  type SafetyIdentificationHistoryEntry,
  type SafetyIdentificationHistoryPage,
  type SafetyIdentificationMutation,
  type SafetyIdentificationOutcome,
  type SafetyIdentificationRequest,
  type SafetyIdentificationRequestPage,
  type SafetyIdentificationStatus,
  type SafetyIdentificationVersionCommand,
} from '../src/index';

// Browser/Metro clients must never evaluate the Node-only contracts root barrel at runtime.
vi.mock('@smartsite/contracts', () => {
  throw new Error('Browser client imported the Node-only contracts root at runtime');
});

const site = '11111111-1111-4111-8111-111111111111';
const episode = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const evidenceId = '44444444-4444-4444-8444-444444444444';
const source = {
  alertId: '55555555-5555-4555-8555-555555555555',
  eventId: '66666666-6666-4666-8666-666666666666',
  personObservationIndex: 1,
  evidenceIndex: 0,
};
// Signature fixture only; full JPEG decoding & pixel masking run on the Backend.
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha = hash(jpeg);

const client = () => new SmartSiteManagementClient('https://api.example.test');
afterEach(() => vi.unstubAllGlobals());

function jsonReply(payload: unknown, status = 200) {
  const mock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

function previewMedia(bytes: Uint8Array = jpeg, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'x-smartsite-frame-sha256': sha,
      'x-smartsite-content-sha256': hash(bytes),
      ...headers,
    },
  });
}

function publishedMedia(bytes: Uint8Array = jpeg, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'x-smartsite-content-sha256': hash(bytes),
      'x-smartsite-evidence-ttl-ms': '60000',
      ...headers,
    },
  });
}

describe('C02 safety identification SDK transport (Backend paired separately)', () => {
  it('encodes scoped assignee, list, detail, and history routes with explicit query parameters', async () => {
    const assignee: SafetyIdentificationAssignee = { id: 'mgr-1', displayName: 'Site Manager A' };
    const statusFilter: SafetyIdentificationStatus = 'OPEN';
    const historyEntry: SafetyIdentificationHistoryEntry = {
      version: 1,
      kind: 'CREATE',
      actorId: 'off-1',
      reason: 'Check PPE case',
      assignedTo: 'mgr-1',
      proposal: null,
      recordedAt: '2026-11-16T00:00:00.000Z',
    };
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ assignee }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [], total: 0 } satisfies SafetyIdentificationRequestPage),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: requestId } as SafetyIdentificationRequest), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [historyEntry],
            total: 1,
          } satisfies SafetyIdentificationHistoryPage),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', mock);

    const api = client();
    expect(await api.getSafetyIdentificationAssignee('token', 'site/1')).toEqual({ assignee });
    await api.listSafetyIdentificationRequests('token', 'site/1', {
      offset: 0,
      limit: 20,
      status: statusFilter,
    });
    await api.getSafetyIdentificationRequest('token', 'site/1', 'req/2');
    const history = await api.listSafetyIdentificationHistory('token', 'site/1', 'req/2', {
      offset: 5,
      limit: 10,
    });
    expect(history.total).toBe(1);

    expect(mock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/assignee',
      'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests?offset=0&limit=20&status=OPEN',
      'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2',
      'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/history?offset=5&limit=10',
    ]);
    for (const [, init] of mock.mock.calls) {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
    }
  });

  it('sends create and respond/review/reassign/cancel mutations and rejects invalid action names before network', async () => {
    const mutation = {
      request: { id: requestId } as SafetyIdentificationRequest,
      replayed: false,
    } satisfies SafetyIdentificationMutation;
    const mock = jsonReply(mutation, 201);
    const api = client();

    const createInput: CreateSafetyIdentificationRequest = {
      commandId: '77777777-7777-4777-8777-777777777777',
      episodeId: episode,
      assignedTo: '88888888-8888-4888-8888-888888888888',
      reason: 'Identify contractor team',
      dueAt: null,
      evidenceRefs: [],
    };
    const outcome: SafetyIdentificationOutcome = 'PARTIAL';
    const respondInput: RespondSafetyIdentificationRequest = {
      commandId: '99999999-9999-4999-8999-999999999999',
      expectedVersion: 1,
      reason: 'Subcontractor A on scaffold',
      outcome,
      workerId: null,
      contractorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      evidenceRefs: [],
    };
    const reviewInput: ReviewSafetyIdentificationRequest = {
      commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      expectedVersion: 2,
      reason: 'Accepted partial proposal',
      decision: 'ACCEPT',
    };
    const reassignInput: ReassignSafetyIdentificationRequest = {
      commandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      expectedVersion: 2,
      reason: 'Shift handover',
      assignedTo: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    };
    const cancelInput: SafetyIdentificationVersionCommand = {
      commandId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      expectedVersion: 2,
      reason: 'Duplicate investigation',
    };

    await api.createSafetyIdentificationRequest('token', 'site/1', createInput);
    await api.changeSafetyIdentificationRequest('token', 'site/1', 'req/2', {
      action: 'respond',
      input: respondInput,
    });
    await api.changeSafetyIdentificationRequest('token', 'site/1', 'req/2', {
      action: 'review',
      input: reviewInput,
    });
    await api.changeSafetyIdentificationRequest('token', 'site/1', 'req/2', {
      action: 'reassign',
      input: reassignInput,
    });
    await api.changeSafetyIdentificationRequest('token', 'site/1', 'req/2', {
      action: 'cancel',
      input: cancelInput,
    });

    expect(mock.mock.calls.map((c) => [c[0], c[1]?.method, c[1]?.body])).toEqual([
      [
        'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests',
        'POST',
        JSON.stringify(createInput),
      ],
      [
        'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/respond',
        'POST',
        JSON.stringify(respondInput),
      ],
      [
        'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/review',
        'POST',
        JSON.stringify(reviewInput),
      ],
      [
        'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/reassign',
        'POST',
        JSON.stringify(reassignInput),
      ],
      [
        'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/cancel',
        'POST',
        JSON.stringify(cancelInput),
      ],
    ]);

    const callsBeforeInvalid = mock.mock.calls.length;
    expect(() =>
      api.changeSafetyIdentificationRequest('token', site, requestId, {
        action: '../admin' as 'cancel',
        input: cancelInput,
      }),
    ).toThrow(TypeError);
    expect(mock).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it('posts the scoped C02 preview, validates expectedFrameSha256 client-side, and verifies original + derived digests', async () => {
    const input: SafetyIdentificationEvidencePreview = {
      episodeId: episode,
      ...source,
      masks: [{ left: 0, top: 0, right: 5000, bottom: 5000 }],
    };
    const fetcher = vi.fn<typeof fetch>(async () => previewMedia());
    vi.stubGlobal('fetch', fetcher);

    expect(() =>
      client().previewSafetyIdentificationEvidence('token', site, input, 'not-a-sha256'),
    ).toThrow(ApiError);
    expect(fetcher).not.toHaveBeenCalled();

    const result = await client().previewSafetyIdentificationEvidence('token', site, input, sha);
    expect(result).toMatchObject({ sha256: sha, frameSha256: sha, validUntil: null });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(jpeg);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://api.example.test/api/v1/sites/${site}/safety-identification-requests/evidence-preview`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(input),
    });
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');

    await expect(
      client().previewSafetyIdentificationEvidence('token', site, input, '0'.repeat(64)),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('reads C02 published JPEG bytes only when content digest and bounded TTL header are valid', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(publishedMedia())
      .mockResolvedValueOnce(publishedMedia(jpeg, { 'x-smartsite-content-sha256': '0'.repeat(64) }))
      .mockResolvedValueOnce(publishedMedia(jpeg, { 'x-smartsite-evidence-ttl-ms': '0' }))
      .mockResolvedValueOnce(publishedMedia(jpeg, { 'x-smartsite-evidence-ttl-ms': '3600001' }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array(jpeg), {
          headers: {
            'content-type': 'image/jpeg',
            'x-smartsite-content-sha256': sha,
          },
        }),
      )
      .mockResolvedValueOnce(publishedMedia(jpeg, { 'x-smartsite-frame-sha256': sha }));
    vi.stubGlobal('fetch', fetcher);

    const read = () =>
      client().readSafetyIdentificationEvidence('token', 'site/1', 'req/2', 'ev/3');
    const first = await read();
    expect(new Uint8Array(await first.blob.arrayBuffer())).toEqual(jpeg);
    expect(first.sha256).toBe(sha);
    expect(first.frameSha256).toBeNull();
    expect(typeof first.validUntil).toBe('number');
    expect(first.validUntil).toBeGreaterThan(performance.now() - 5_000);
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/safety-identification-requests/req%2F2/evidence/ev%2F3',
    );

    for (let i = 0; i < 5; i++) {
      await expect(read()).rejects.toMatchObject({ code: 'invalid-response' });
    }
  });

  it('preserves HTTP 401/403/404/409 errors, dispatches 401 session expiry on binary routes, and honors AbortSignal', async () => {
    for (const status of [401, 403, 404, 409]) {
      jsonReply({ message: 'Denied or conflict' }, status);
      await expect(
        client().getSafetyIdentificationRequest('token', site, requestId),
      ).rejects.toMatchObject({ code: 'http', status });
    }

    const fakeWindow = new EventTarget();
    const expiredEvents: string[][] = [];
    const onExpired = (event: Event) => {
      expiredEvents.push((event as CustomEvent<{ sessionScopes: string[] }>).detail.sessionScopes);
    };
    fakeWindow.addEventListener('smartsite:session-expired', onExpired);
    vi.stubGlobal('window', fakeWindow);
    registerSessionCredential('expired-token', 'c02-scope');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ message: 'Unauthorized' }, { status: 401 })),
      );
      await expect(
        client().readSafetyIdentificationEvidence('expired-token', site, requestId, evidenceId),
      ).rejects.toMatchObject({ code: 'http', status: 401 });
      expect(expiredEvents).toEqual([['c02-scope']]);
    } finally {
      unregisterSessionCredential('expired-token', 'c02-scope');
      fakeWindow.removeEventListener('smartsite:session-expired', onExpired);
    }

    const abort = new AbortController();
    abort.abort();
    const mock = jsonReply({});
    await expect(
      client().readSafetyIdentificationEvidence('token', site, requestId, evidenceId, {
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(mock).not.toHaveBeenCalled();
  });
});
