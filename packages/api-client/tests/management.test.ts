import { randomUUID } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '../src/index';

describe('management client', () => {
  it('sends a token only to the requested endpoint and sends revision in mutation body', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      return new Response(
        JSON.stringify({
          region: { id: 'region-1' },
          configurationVersion: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test/');
      const result = await client.setRegionActive('user-token', 'site-1', 'camera-1', 'region-1', {
        isActive: false,
        expectedConfigurationVersion: 1,
      });
      expect(result.configurationVersion).toBe(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site-1/cameras/camera-1/regions/region-1/status',
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'PATCH',
        headers: { Authorization: 'Bearer user-token' },
        body: JSON.stringify({ isActive: false, expectedConfigurationVersion: 1 }),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not include a credential in the login URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      return new Response(JSON.stringify({ accessToken: 'returned-token' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.login('admin', 'test-password-secret');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/auth/login');
      expect(fetchMock.mock.calls[0]?.[1].body).toContain('test-password-secret');
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({
        username: 'admin',
        password: 'test-password-secret',
        clientType: 'WEB',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses cookies only for Web refresh/logout and JSON refresh tokens only for Mobile', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.logout();
      await client.logout('MOBILE', 'mobile-refresh-token');
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        credentials: 'include',
        body: JSON.stringify({ clientType: 'WEB' }),
      });
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        body: JSON.stringify({ clientType: 'MOBILE', refreshToken: 'mobile-refresh-token' }),
      });
      expect(fetchMock.mock.calls[1]?.[1].credentials).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('encodes the site ID and constructs alert pagination and filters with bearer auth', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test/');
      const result = await client.listSafetyAlerts('alert-token', 'site/a b', {
        offset: 0,
        limit: 25,
        status: 'NEEDS_MORE_EVIDENCE',
        type: 'RESTRICTED_ZONE_INTRUSION',
      });
      expect(result).toEqual({ items: [], total: 0 });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2Fa%20b/safety-alerts?offset=0&limit=25&status=NEEDS_MORE_EVIDENCE&type=RESTRICTED_ZONE_INTRUSION',
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'GET',
        headers: { Authorization: 'Bearer alert-token', Accept: 'application/json' },
      });
      await client.listSafetyAlerts('alert-token', 'site/a b');
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2Fa%20b/safety-alerts',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('encodes alert detail path IDs and sends bearer auth', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      return new Response(JSON.stringify({ id: 'alert/1', detections: [], detectionsTotal: 0 }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      const result = await client.getSafetyAlert('detail-token', 'site/1', 'alert/1');
      expect(result.detectionsTotal).toBe(0);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2F1/safety-alerts/alert%2F1',
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'GET',
        headers: { Authorization: 'Bearer detail-token', Accept: 'application/json' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetches alert evidence as an authenticated JPEG blob', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetchMock = vi.fn(
      async () =>
        new Response(jpeg, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test/');
      const result = await client.getSafetyAlertEvidence(
        'evidence-token',
        'site/1',
        'alert/1',
        'event/1',
        2,
      );
      expect(result.type).toBe('image/jpeg');
      expect(new Uint8Array(await result.arrayBuffer())).toEqual(jpeg);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2F1/safety-alerts/alert%2F1/detections/event%2F1/evidence/2',
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        headers: { Authorization: 'Bearer evidence-token', Accept: 'image/jpeg' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('submits a Site-scoped alert review command with optimistic revision', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ replayed: false, alert: {}, review: {} }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.reviewSafetyAlert('review-token', 'site/1', 'alert/1', {
        commandId: '00000000-0000-4000-8000-000000000001',
        expectedRevision: 3,
        targetStatus: 'CONFIRMED',
        reason: 'Confirmed across three consecutive observations.',
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2F1/safety-alerts/alert%2F1/reviews',
      );
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer review-token' }),
        body: JSON.stringify({
          commandId: '00000000-0000-4000-8000-000000000001',
          expectedRevision: 3,
          targetStatus: 'CONFIRMED',
          reason: 'Confirmed across three consecutive observations.',
        }),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('constructs worker and zone access endpoints with encoded scope IDs', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.listWorkers('access-token', 'site/a', { limit: 100 });
      await client.listZoneAccessGrants('access-token', 'site/a', 'zone/b', { limit: 100 });
      await client.listZoneEntryDecisions('access-token', 'site/a', {
        zoneId: 'zone/b',
        status: 'DENIED',
        limit: 50,
      });

      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        'https://api.example.test/api/v1/sites/site%2Fa/workers?limit=100',
        'https://api.example.test/api/v1/sites/site%2Fa/zones/zone%2Fb/access-grants?limit=100',
        'https://api.example.test/api/v1/sites/site%2Fa/zone-entry-decisions?limit=50&zoneId=zone%2Fb&status=DENIED',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends grant creation and revocation mutations with bearer auth', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: 'grant-1', effect: 'ALLOW' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.createZoneAccessGrant('access-token', 'site-1', 'zone-1', {
        workerId: 'worker-1',
        effect: 'ALLOW',
        validFrom: '2026-09-28T12:00:00.000Z',
        validUntil: null,
      });
      await client.revokeZoneAccessGrant('access-token', 'site-1', 'zone-1', 'grant-1');

      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          workerId: 'worker-1',
          effect: 'ALLOW',
          validFrom: '2026-09-28T12:00:00.000Z',
          validUntil: null,
        }),
      });
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const siteId = '11111111-1111-4111-8111-111111111111';
const alertId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const otherEventId = '44444444-4444-4444-8444-444444444444';

function identityFixture(index = 0) {
  const subjectRef = {
    eventId,
    personObservationIndex: index,
    payloadHash: 'a'.repeat(64),
    cameraId: '55555555-5555-4555-8555-555555555555',
    cameraExternalId: 'SYNTHETIC',
    streamSessionId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-01T00:00:00Z',
    trackId: 7,
    personBoundingBox: {
      x1: 0.1,
      y1: 0.1,
      x2: 0.8,
      y2: 0.9,
      coordinateSpace: 'NORMALIZED_0_1' as const,
    },
  };
  const manual = {
    id: '77777777-7777-4777-8777-777777777777',
    revision: 4,
    action: 'RESOLVE' as const,
    workerId: '88888888-8888-4888-8888-888888888888',
    actorUserId: '99999999-9999-4999-8999-999999999999',
    reason: 'Synthetic person reviewed.',
    scope: 'EXACT_OBSERVATION' as const,
    verificationMethod: 'MANUAL' as const,
    recordedAt: '2026-10-01T01:00:00.000Z',
  };
  const decision = { ...manual, subjectRef, evidenceIndex: 0, evidenceSha256: 'b'.repeat(64) };
  const context = {
    eventId,
    payloadHash: 'a'.repeat(64),
    eventConsistent: true,
    frames: [{ index: 0, kind: 'FRAME' as const, sha256: 'b'.repeat(64), available: true }],
    subjects: [
      {
        personObservationIndex: index,
        trackId: 7,
        subjectRef,
        subjectRefSource: 'RAW_EVENT' as const,
        technicalIdentity: { status: 'UNKNOWN' as const, candidates: [] },
        latestManualDecision: manual,
        revision: 4,
        canResolve: true,
        resolveBlockReason: null,
        canClear: true,
        clearBlockReason: null,
        originalZoneDecisions: { items: [], total: 0 },
      },
    ],
  };
  return { context, decision };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('observation identity client', () => {
  it('requests encoded identity paths and posts the exact command once', async () => {
    const fixture = identityFixture();
    const command = {
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedRevision: 3,
      expectedEventHash: 'a'.repeat(64),
      reason: 'Synthetic person reviewed.',
      action: 'RESOLVE' as const,
      workerId: fixture.decision.workerId,
      evidenceIndex: 0,
      expectedEvidenceSha256: 'b'.repeat(64),
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith('/decisions')) {
        return jsonResponse({
          recordedDecision: { ...fixture.decision, id: command.commandId },
          latestRevision: 6,
          replayed: true,
        });
      }
      if (String(url).includes('/workers')) return jsonResponse({ items: [], total: 0 });
      if (String(url).includes('/decisions?'))
        return jsonResponse({ items: [fixture.decision], total: 1 });
      return jsonResponse(fixture.context);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test/');
      const context = await client.getObservationIdentityContext(
        'identity-token',
        'site/a b',
        'alert/c',
        eventId,
      );
      const workers = await client.listObservationIdentityWorkers(
        'identity-token',
        siteId,
        alertId,
        eventId,
        0,
        20,
      );
      const history = await client.listObservationIdentityDecisions(
        'identity-token',
        siteId,
        alertId,
        eventId,
        0,
        1,
        20,
      );
      const mutation = await client.decideObservationIdentity(
        'identity-token',
        siteId,
        alertId,
        eventId,
        0,
        command,
      );
      expect(context.eventId).toBe(eventId);
      expect(workers).toEqual({ items: [], total: 0 });
      expect(history.items[0]?.revision).toBe(4);
      expect(mutation).toMatchObject({
        replayed: true,
        latestRevision: 6,
        recordedDecision: { id: command.commandId, revision: 4, action: 'RESOLVE' },
      });
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        `https://api.example.test/api/v1/sites/site%2Fa%20b/safety-alerts/alert%2Fc/detections/${eventId}/identity-subjects`,
        `https://api.example.test/api/v1/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/identity-subjects/workers?offset=0&limit=20`,
        `https://api.example.test/api/v1/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/identity-subjects/0/decisions?offset=1&limit=20`,
        `https://api.example.test/api/v1/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/identity-subjects/0/decisions`,
      ]);
      expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
        method: 'POST',
        headers: { Authorization: 'Bearer identity-token', Accept: 'application/json' },
        body: JSON.stringify(command),
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects malformed and foreign-subject identity responses', async () => {
    const fixture = identityFixture();
    const foreign = structuredClone(fixture.context);
    foreign.eventId = otherEventId;
    foreign.subjects[0]!.subjectRef!.eventId = otherEventId;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ subjects: [], secret: 'secret-embedding' }))
      .mockResolvedValueOnce(jsonResponse(foreign))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{ ...identityFixture(1).decision }],
          total: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: randomUUID(),
              siteId: otherEventId,
              externalId: 'W-001',
              displayName: 'Other Site',
              isActive: true,
            },
          ],
          total: 1,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await expect(
        client.getObservationIdentityContext('token', siteId, alertId, eventId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      await expect(
        client.getObservationIdentityContext('token', siteId, alertId, eventId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      await expect(
        client.listObservationIdentityDecisions('token', siteId, alertId, eventId, 0, 0, 20),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      await expect(
        client.listObservationIdentityWorkers('token', siteId, alertId, eventId, 0, 20),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves one 409 public envelope and does not retry', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Observation identity revision is stale',
          requestId: 'req-1',
          timestamp: '2026-10-01T00:00:00.000Z',
          path: `/sites/${siteId}/safety-alerts/${alertId}/detections/${eventId}/identity-subjects/0/decisions`,
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await expect(
        client.decideObservationIdentity('token', siteId, alertId, eventId, 0, {
          commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          expectedRevision: 4,
          expectedEventHash: 'a'.repeat(64),
          reason: 'Synthetic person reviewed.',
          action: 'CLEAR',
        }),
      ).rejects.toMatchObject({
        code: 'http',
        status: 409,
        message: 'Observation identity revision is stale',
        backendError: { code: 'CONFLICT', message: 'Observation identity revision is stale' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('cancels before fetch, during fetch, and during body parsing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test');
    const before = new AbortController();
    before.abort();
    await expect(
      client.getObservationIdentityContext('token', siteId, alertId, eventId, {
        signal: before.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const duringFetch = new AbortController();
    const pendingFetch = client.getSafetyAlertEvidence('token', siteId, alertId, eventId, 0, {
      signal: duringFetch.signal,
    });
    duringFetch.abort();
    await expect(pendingFetch).rejects.toBeInstanceOf(ApiError);
    await expect(pendingFetch).rejects.toMatchObject({ code: 'cancelled' });

    fetchMock.mockImplementation(() => {
      const response = new Response(' ', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      response.json = () => new Promise(() => undefined);
      return Promise.resolve(response);
    });
    const duringParse = new AbortController();
    const pendingParse = client.getObservationIdentityContext('token', siteId, alertId, eventId, {
      signal: duringParse.signal,
    });
    duringParse.abort();
    await expect(pendingParse).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('times out an identity request that never returns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ),
    );
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await expect(
        client.listObservationIdentityWorkers('token', siteId, alertId, eventId, 0, 20, {
          timeoutMs: 20,
        }),
      ).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('aborts a JSON or JPEG body only after that read starts, then drops abort listeners', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const pendingAfterRead = async (
      kind: 'json' | 'blob',
      start: (signal: AbortSignal) => Promise<unknown>,
    ) => {
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const fetchMock = vi.fn(async () => {
        const response = new Response(
          kind === 'blob' ? new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) : ' ',
          {
            status: 200,
            headers: { 'Content-Type': kind === 'blob' ? 'image/jpeg' : 'application/json' },
          },
        );
        const hang = () => {
          markStarted();
          return new Promise(() => undefined);
        };
        if (kind === 'blob') response.blob = hang as typeof response.blob;
        else response.json = hang as typeof response.json;
        return response;
      });
      vi.stubGlobal('fetch', fetchMock);
      const controller = new AbortController();
      const pending = start(controller.signal);
      const readStarted = await Promise.race([
        started.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
      ]);
      expect(readStarted).toBe(true);
      controller.abort();
      const outcome = await Promise.race([
        pending.then(
          () => 'resolved',
          (error: unknown) => error,
        ),
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 250)),
      ]);
      expect(outcome).toMatchObject({ code: 'cancelled' });
      const transport = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
      expect(transport).toBeInstanceOf(AbortSignal);
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
      expect(getEventListeners(transport!, 'abort')).toEqual([]);
    };
    try {
      await pendingAfterRead('json', (signal) =>
        client.getObservationIdentityContext('token', siteId, alertId, eventId, { signal }),
      );
      await pendingAfterRead('blob', (signal) =>
        client.getSafetyAlertEvidence('token', siteId, alertId, eventId, 0, { signal }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a timeout that is not a finite positive integer before arming a listener or timer', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const addSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const abortAdds = () => addSpy.mock.calls.filter((call) => call[0] === 'abort').length;
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      const signal = new AbortController().signal;
      for (const timeoutMs of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        -1,
        0,
        1.5,
        2_147_483_648,
      ]) {
        const timersBefore = setTimeoutSpy.mock.calls.length;
        const listenersBefore = abortAdds();
        await expect(
          client.getObservationIdentityContext('token', siteId, alertId, eventId, {
            signal,
            timeoutMs,
          }),
        ).rejects.toThrow(RangeError);
        expect(setTimeoutSpy.mock.calls.slice(timersBefore).map((call) => call[1])).not.toContain(
          timeoutMs,
        );
        expect(
          setTimeoutSpy.mock.calls
            .slice(timersBefore)
            .some((call) => typeof call[1] === 'number' && Number.isNaN(call[1])),
        ).toBe(false);
        expect(abortAdds()).toBe(listenersBefore);
        expect(getEventListeners(signal, 'abort')).toEqual([]);
      }
      expect(fetchMock).not.toHaveBeenCalled();

      fetchMock.mockResolvedValue(jsonResponse(identityFixture().context));
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      await expect(
        client.getObservationIdentityContext('token', siteId, alertId, eventId, {
          timeoutMs: 2_147_483_647,
        }),
      ).resolves.toMatchObject({ eventId });
      const armed = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 2_147_483_647);
      expect(armed).toBeGreaterThanOrEqual(0);
      expect(clearSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[armed]?.value);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clearSpy.mockRestore();
    } finally {
      setTimeoutSpy.mockRestore();
      addSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rejects a mutation recorded for a different command, including replay', async () => {
    const fixture = identityFixture();
    const resolveCommand = {
      commandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expectedRevision: 3,
      expectedEventHash: 'a'.repeat(64),
      reason: 'Synthetic person reviewed.',
      action: 'RESOLVE' as const,
      workerId: fixture.decision.workerId,
      evidenceIndex: 0,
      expectedEvidenceSha256: 'b'.repeat(64),
    };
    const clearCommand = {
      commandId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      expectedRevision: 4,
      expectedEventHash: 'a'.repeat(64),
      reason: 'Synthetic person reviewed.',
      action: 'CLEAR' as const,
    };
    const matchedResolve = {
      recordedDecision: { ...fixture.decision, id: resolveCommand.commandId, revision: 4 },
      latestRevision: 9,
      replayed: true,
    };
    const matchedClear = {
      recordedDecision: {
        ...fixture.decision,
        id: clearCommand.commandId,
        revision: 5,
        action: 'CLEAR' as const,
        workerId: null,
        evidenceIndex: null,
        evidenceSha256: null,
      },
      latestRevision: 8,
      replayed: true,
    };
    const foreign = [
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          reason: 'A different review reason was recorded.',
        },
      },
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
      },
      {
        ...matchedResolve,
        recordedDecision: { ...matchedResolve.recordedDecision, revision: 3 },
        latestRevision: 3,
      },
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          action: 'CLEAR' as const,
          workerId: null,
          evidenceIndex: null,
          evidenceSha256: null,
        },
      },
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          workerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      },
      {
        ...matchedResolve,
        recordedDecision: { ...matchedResolve.recordedDecision, evidenceIndex: 2 },
      },
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          evidenceSha256: 'c'.repeat(64),
        },
      },
      {
        ...matchedResolve,
        recordedDecision: {
          ...matchedResolve.recordedDecision,
          subjectRef: { ...fixture.decision.subjectRef, payloadHash: 'd'.repeat(64) },
        },
      },
      {
        ...matchedClear,
        recordedDecision: {
          ...matchedClear.recordedDecision,
          id: resolveCommand.commandId,
        },
      },
    ];
    let index = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse([...foreign, matchedResolve, matchedClear][index++]),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      for (const offset of foreign.keys()) {
        const command = offset === foreign.length - 1 ? clearCommand : resolveCommand;
        await expect(
          client.decideObservationIdentity('token', siteId, alertId, eventId, 0, command),
        ).rejects.toMatchObject({ code: 'invalid-response' });
      }
      await expect(
        client.decideObservationIdentity('token', siteId, alertId, eventId, 0, {
          ...resolveCommand,
          reason: `  ${resolveCommand.reason}  `,
        }),
      ).resolves.toMatchObject({
        replayed: true,
        latestRevision: 9,
        recordedDecision: { id: resolveCommand.commandId, revision: 4, action: 'RESOLVE' },
      });
      await expect(
        client.decideObservationIdentity('token', siteId, alertId, eventId, 0, clearCommand),
      ).resolves.toMatchObject({
        replayed: true,
        latestRevision: 8,
        recordedDecision: {
          id: clearCommand.commandId,
          revision: 5,
          action: 'CLEAR',
          workerId: null,
          evidenceIndex: null,
          evidenceSha256: null,
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(foreign.length + 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
