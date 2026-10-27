import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  registerSessionCredential,
  unregisterSessionCredential,
} from '../src/index';

afterEach(() => {
  vi.unstubAllGlobals();
});

function callUrl(calls: ReadonlyArray<readonly unknown[]>, index: number): URL {
  const row = calls[index];
  if (!row || row.length === 0) {
    throw new Error(`Missing fetch call at index ${index}`);
  }
  return new URL(String(row[0]));
}

function callInit(calls: ReadonlyArray<readonly unknown[]>, index: number): RequestInit {
  const row = calls[index];
  if (!row || row.length < 2 || typeof row[1] !== 'object' || row[1] === null) {
    throw new Error(`Missing RequestInit at index ${index}`);
  }
  return row[1] as RequestInit;
}

describe('safety overview and alert work-context client methods', () => {
  it('encodes scoped IDs and serializes filter values across all 6 Overview methods and getAlertWorkContext', async () => {
    const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const fullQuery = {
      date: '2026-10-15',
      timezone: 'Asia/Ho_Chi_Minh',
      contractorId: 'contractor/alpha 1',
      teamId: 'team/bravo 2',
      unassignedOffset: 5,
      unassignedLimit: 15,
      offset: 10,
      limit: 25,
    };

    await client.listSafetyOverviewContractors('overview-token', 'site/main 1', fullQuery);
    await client.getSafetyOverview('overview-token', 'site/main 1', fullQuery);
    await client.getSafetyTeamOptions('overview-token', 'site/main 1', fullQuery);
    await client.getSafetyWeek('overview-token', 'site/main 1', fullQuery);
    await client.listSafetyZoneTeams(
      'overview-token',
      'site/main 1',
      'zone/restricted 9',
      fullQuery,
    );
    await client.getSafetyTeam('overview-token', 'site/main 1', 'team/bravo 2', fullQuery);
    await client.getAlertWorkContext('overview-token', 'site/main 1', 'alert/delta 7');

    expect(fetchMock).toHaveBeenCalledTimes(7);

    const contractorsUrl = callUrl(fetchMock.mock.calls, 0);
    const overviewUrl = callUrl(fetchMock.mock.calls, 1);
    const teamOptionsUrl = callUrl(fetchMock.mock.calls, 2);
    const weekUrl = callUrl(fetchMock.mock.calls, 3);
    const zoneTeamsUrl = callUrl(fetchMock.mock.calls, 4);
    const teamDetailUrl = callUrl(fetchMock.mock.calls, 5);
    const workContextUrl = callUrl(fetchMock.mock.calls, 6);

    expect(contractorsUrl.pathname).toBe(
      '/api/v1/sites/site%2Fmain%201/safety-overview/contractors',
    );
    expect(overviewUrl.pathname).toBe('/api/v1/sites/site%2Fmain%201/safety-overview');
    expect(teamOptionsUrl.pathname).toBe(
      '/api/v1/sites/site%2Fmain%201/safety-overview/team-options',
    );
    expect(weekUrl.pathname).toBe('/api/v1/sites/site%2Fmain%201/safety-overview/week');
    expect(zoneTeamsUrl.pathname).toBe(
      '/api/v1/sites/site%2Fmain%201/safety-overview/zones/zone%2Frestricted%209/teams',
    );
    expect(teamDetailUrl.pathname).toBe(
      '/api/v1/sites/site%2Fmain%201/safety-overview/teams/team%2Fbravo%202',
    );
    expect(workContextUrl.pathname).toBe(
      '/api/v1/sites/site%2Fmain%201/safety-alerts/alert%2Fdelta%207/work-context',
    );

    for (const url of [
      contractorsUrl,
      overviewUrl,
      teamOptionsUrl,
      weekUrl,
      zoneTeamsUrl,
      teamDetailUrl,
    ]) {
      expect(url.searchParams.get('date')).toBe('2026-10-15');
      expect(url.searchParams.get('timezone')).toBe('Asia/Ho_Chi_Minh');
      expect(url.searchParams.get('contractorId')).toBe('contractor/alpha 1');
      expect(url.searchParams.get('teamId')).toBe('team/bravo 2');
      expect(url.searchParams.get('unassignedOffset')).toBe('5');
      expect(url.searchParams.get('unassignedLimit')).toBe('15');
      expect(url.searchParams.get('offset')).toBe('10');
      expect(url.searchParams.get('limit')).toBe('25');
    }

    for (let i = 0; i < 7; i += 1) {
      expect(callInit(fetchMock.mock.calls, i)).toMatchObject({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer overview-token',
        },
      });
    }
  });

  it('omits undefined and empty optional query parameters consistently with donor behavior', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    const sparseQuery = {
      date: '2026-10-15',
      timezone: 'UTC',
      contractorId: '',
      teamId: undefined,
      unassignedOffset: undefined,
      unassignedLimit: undefined,
      offset: undefined,
      limit: undefined,
    };

    const undefinedOptionalsQuery = {
      date: '2026-10-15',
      timezone: 'UTC',
      contractorId: undefined,
      teamId: undefined,
      unassignedOffset: undefined,
      unassignedLimit: undefined,
      offset: undefined,
      limit: undefined,
    };

    await client.getSafetyOverview('token', 'site-a', sparseQuery);
    await client.getSafetyTeam('token', 'site-a', 'team-1', sparseQuery);
    await client.listSafetyOverviewContractors('token', 'site-a', undefinedOptionalsQuery);
    await client.getSafetyTeamOptions('token', 'site-a', undefinedOptionalsQuery);
    await client.getSafetyWeek('token', 'site-a', undefinedOptionalsQuery);
    await client.listSafetyZoneTeams('token', 'site-a', 'zone-1', undefinedOptionalsQuery);

    const overviewUrl = callUrl(fetchMock.mock.calls, 0);
    const teamUrl = callUrl(fetchMock.mock.calls, 1);
    const contractorsUrl = callUrl(fetchMock.mock.calls, 2);
    const optionsUrl = callUrl(fetchMock.mock.calls, 3);
    const weekUrl = callUrl(fetchMock.mock.calls, 4);
    const zoneTeamsUrl = callUrl(fetchMock.mock.calls, 5);

    // safetyOverviewPath omits both undefined and empty-string ('') values
    expect(overviewUrl.searchParams.has('contractorId')).toBe(false);
    expect(overviewUrl.searchParams.has('teamId')).toBe(false);
    expect(overviewUrl.searchParams.has('offset')).toBe(false);
    expect(teamUrl.searchParams.has('contractorId')).toBe(false);
    expect(teamUrl.searchParams.has('teamId')).toBe(false);

    for (const url of [contractorsUrl, optionsUrl, weekUrl, zoneTeamsUrl]) {
      expect(Array.from(url.searchParams.keys())).toEqual(['date', 'timezone']);
    }
  });

  it('propagates caller AbortSignal cancellation and 401 BackendErrorEnvelope across Overview and AlertWorkContext calls', async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    const query = { date: '2026-10-15', timezone: 'Asia/Ho_Chi_Minh' };

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      client.getSafetyOverview('token', 'site-a', query, { signal: preAborted.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();

    const inFlight = new AbortController();
    const pendingTeam = client.getSafetyTeam('token', 'site-a', 'team-a', query, {
      signal: inFlight.signal,
    });
    inFlight.abort();
    await expect(pendingTeam).rejects.toBeInstanceOf(ApiError);
    await expect(pendingTeam).rejects.toMatchObject({ code: 'cancelled' });

    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    registerSessionCredential('expired-overview-token', 'overview-scope');
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: 'Access token expired',
            requestId: 'req-overview-401',
            timestamp: '2026-10-15T04:00:00.000Z',
            path: '/api/v1/sites/site-a/safety-overview',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await expect(
        client.getSafetyOverview('expired-overview-token', 'site-a', query),
      ).rejects.toMatchObject({
        code: 'http',
        status: 401,
        message: 'Access token expired',
        backendError: {
          code: 'UNAUTHORIZED',
          statusCode: 401,
        },
      });
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0]?.[0].type).toBe('smartsite:session-expired');
      expect(dispatchEvent.mock.calls[0]?.[0].detail.sessionScopes).toContain('overview-scope');

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: 'Work context unauthorized',
            requestId: 'req-work-context-401',
            timestamp: '2026-10-15T04:01:00.000Z',
            path: '/api/v1/sites/site-a/safety-alerts/alert-1/work-context',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      await expect(
        client.getAlertWorkContext('expired-overview-token', 'site-a', 'alert-1'),
      ).rejects.toMatchObject({
        code: 'http',
        status: 401,
        message: 'Work context unauthorized',
      });
      expect(dispatchEvent).toHaveBeenCalledTimes(2);
      expect(dispatchEvent.mock.calls[1]?.[0].type).toBe('smartsite:session-expired');
      expect(dispatchEvent.mock.calls[1]?.[0].detail.sessionScopes).toContain('overview-scope');
    } finally {
      unregisterSessionCredential('expired-overview-token', 'overview-scope');
    }
  });
});
