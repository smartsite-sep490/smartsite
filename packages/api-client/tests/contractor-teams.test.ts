import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('encodes scoped contractor team routes and preserves versions and membership binding sent by UI', async () => {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://synthetic.test');
  await client.contractorDashboardScopes('synthetic-token');
  await client.contractorDashboard('synthetic-token', 'site/1', 'contractor/1');
  await client.listContractorTeams('synthetic-token', 'site/1', 'contractor/1', {
    offset: 100,
    limit: 20,
    status: 'ACTIVE',
    search: 'Đội sơn',
  });
  await client.listContractorTeamWorkers('synthetic-token', 'site/1', 'contractor/1', {
    unassigned: true,
  });
  await client.createContractorTeam('synthetic-token', 'site/1', 'contractor/1', {
    requestId: 'request-1',
    name: 'Đội sơn',
  });
  await client.updateContractorTeam('synthetic-token', 'site/1', 'contractor/1', 'team/1', {
    expectedVersion: 3,
    name: 'Đội sàn',
    description: '',
  });
  await client.archiveContractorTeam('synthetic-token', 'site/1', 'contractor/1', 'team/1', {
    expectedVersion: 4,
    reason: 'Empty team retired',
  });
  const input = {
    requestId: 'request-2',
    expectedMembershipId: 'old-membership',
    teamId: null,
    reason: 'Remove from team',
  };
  await client.assignContractorTeam('synthetic-token', 'site/1', 'contractor/1', 'worker/1', input);
  await client.myContractorTeam('synthetic-token', 'site/1');
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls[0]![0]).toContain('/contractor-dashboard/scopes');
  expect(calls[1]![0]).toContain('/sites/site%2F1/contractors/contractor%2F1/dashboard');
  const query = new URL(calls[2]![0]).searchParams;
  expect(query.get('offset')).toBe('100');
  expect(query.get('search')).toBe('Đội sơn');
  expect(calls[3]![0]).toContain('unassigned=true');
  expect(JSON.parse(calls[5]![1].body as string).expectedVersion).toBe(3);
  expect(calls[7]![1].method).toBe('PUT');
  expect(JSON.parse(calls[7]![1].body as string)).toEqual(input);
  expect(calls[8]![0]).toContain('/sites/site%2F1/my-team');
  for (const [, init] of calls)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
});
