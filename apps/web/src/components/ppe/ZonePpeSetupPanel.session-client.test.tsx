// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type ManagementSession,
  type ZoneResponse,
} from '@smartsite/api-client';
import { ZonePpeSetupPanel } from './ZonePpeSetupPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const zone: ZoneResponse = {
  id: 'zone',
  siteId: 'site',
  code: 'ZONE',
  name: 'Fixture zone',
  type: 'STANDARD',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT'],
  configurationLocked: false,
  createdAt: '2026-10-16T00:00:00Z',
};

it.each(['zones', 'cameras'] as const)(
  'uses the owning session adapter for the %s request inside the Zone popup',
  async (target) => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    let accessToken = 'synthetic-old';
    const session: ManagementSession = {
      signal: new AbortController().signal,
      getAccessToken: vi.fn(() => accessToken),
      refreshAccessToken: vi.fn(async () => (accessToken = 'synthetic-new')),
      onUnauthorized: vi.fn(),
    };
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const token = new Headers(init.headers).get('Authorization');
        const endpoint = url.includes('/zones') ? 'zones' : 'cameras';
        if (endpoint === target) {
          seen.push(token ?? '');
          if (token === 'Bearer synthetic-old') return Response.json({}, { status: 401 });
        }
        return Response.json({
          items: endpoint === 'zones' ? [zone] : [],
          total: endpoint === 'zones' ? 1 : 0,
        });
      }),
    );
    const client = new SmartSiteManagementClient('https://api.example.test', session);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cache}>
        <ZonePpeSetupPanel
          apiUrl="https://api.example.test"
          token="synthetic-old"
          sessionScope="fixture-session"
          credentialId={1}
          siteId="site"
          siteName="Fixture site"
          canManageZones
          canManageRegions={target === 'cameras'}
          onClose={vi.fn()}
          client={client}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(seen).toEqual(['Bearer synthetic-old', 'Bearer synthetic-new']));
    expect(session.refreshAccessToken).toHaveBeenCalledExactlyOnceWith('synthetic-old');
    expect(session.onUnauthorized).not.toHaveBeenCalled();
  },
);
