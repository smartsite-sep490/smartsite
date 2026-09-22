import { describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

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
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
