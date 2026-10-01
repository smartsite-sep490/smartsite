import { describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

describe('management client', () => {
  it('prepares an existing account and sends gate direction/photo to Backend, then reads DB logs', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
      void _url;
      void _init;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = new SmartSiteManagementClient('https://api.example.test');
      await client.prepareFaceAccount('synthetic-token', 'site/a', 'account-id');
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2Fa/workers/for-account',
      );
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({
        userId: 'account-id',
      });
      await client.verifyFaceGate(
        'synthetic-token',
        'site/a',
        'gate-1',
        new Blob(['synthetic'], { type: 'image/jpeg' }),
        'OUT',
      );
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2Fa/gates/gate-1/face-verifications',
      );
      const form = fetchMock.mock.calls[1]?.[1].body as FormData;
      expect(form.get('direction')).toBe('OUT');
      expect(form.get('frame')).toBeInstanceOf(Blob);
      await client.checkFaceEnrollmentQuality(
        'synthetic-token',
        'worker-1',
        new Blob(['synthetic'], { type: 'image/jpeg' }),
        'left',
      );
      expect((fetchMock.mock.calls[2]?.[1].body as FormData).get('target')).toBe('left');
      await client.listGateAccessLogs('synthetic-token', 'site/a', 'gate-1');
      expect(fetchMock.mock.calls[3]?.[0]).toBe(
        'https://api.example.test/api/v1/sites/site%2Fa/gates/gate-1/access-logs',
      );
      expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
        method: 'GET',
        headers: { Authorization: 'Bearer synthetic-token' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
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
