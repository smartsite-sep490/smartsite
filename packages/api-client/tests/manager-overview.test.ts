import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('sends scoped management reads with pagination/date/timezone and creates without manual codes', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://synthetic.test');
  await client.managerOverview('token', 'site/1', { offset: 20, limit: 20 });
  await client.managerContractorDetail('token', 'site/1', 'contractor/1', {
    date: '2026-10-12',
    timezone: 'Asia/Ho_Chi_Minh',
  });
  await client.createContractor('token', 'site/1', { name: 'Alpha' });
  await client.createZone('token', 'site/1', {
    name: 'Area',
    type: 'STANDARD',
    restrictionPolicy: 'NONE',
    requiredPpe: [],
  });
  const dates = {
    requestId: 'request-id',
    siteContractorId: 'participation',
    zoneId: 'zone',
    startDate: '2026-10-12',
    endDate: '2026-10-13',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  await client.grantContractorZoneDates('token', 'site/1', dates);
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls[0]![0]).toContain('/sites/site%2F1/management/overview');
  expect(new URL(calls[0]![0]).searchParams.get('offset')).toBe('20');
  expect(calls[1]![0]).toContain('/sites/site%2F1/management/contractors/contractor%2F1');
  expect(new URL(calls[1]![0]).searchParams.get('timezone')).toBe('Asia/Ho_Chi_Minh');
  expect(new URL(calls[1]![0]).searchParams.get('date')).toBe('2026-10-12');
  expect(JSON.parse(calls[2]![1].body as string)).toEqual({ name: 'Alpha' });
  expect(JSON.parse(calls[3]![1].body as string)).not.toHaveProperty('code');
  expect(calls[4]![0]).toContain('/sites/site%2F1/access-setup/contractor-zone-permissions/dates');
  expect(JSON.parse(calls[4]![1].body as string)).toEqual(dates);
  for (const [, init] of calls)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
});

it('encodes global contractor participation reads and preserves pagination and authentication', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://synthetic.test');
  await client.listGlobalContractors('admin-token', { offset: 20, limit: 20 });
  await client.listContractorParticipations('admin-token', 'contractor/1', {
    offset: 40,
    limit: 20,
  });
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(new URL(calls[0]![0]).pathname).toBe('/api/v1/contractors');
  expect(new URL(calls[1]![0]).pathname).toBe('/api/v1/contractors/contractor%2F1/participations');
  expect(new URL(calls[1]![0]).searchParams.get('offset')).toBe('40');
  expect(new URL(calls[1]![0]).searchParams.get('limit')).toBe('20');
  for (const [, init] of calls) {
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
  }
});
