import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('downloads checklist PNG/PDF while legacy evidence stays JPEG-only', async () => {
  const fetch = vi.fn(
    async () => new Response('synthetic', { headers: { 'content-type': 'application/pdf' } }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect((await client.getChecklistEvidence('token', 'site', 'checklist', 'evidence')).type).toBe(
    'application/pdf',
  );
  fetch.mockImplementation(
    async () => new Response('synthetic', { headers: { 'content-type': 'image/png' } }),
  );
  expect((await client.getChecklistEvidence('token', 'site', 'checklist', 'evidence')).type).toBe(
    'image/png',
  );
  await expect(
    client.getWorkflowEvidence('token', 'site', 'incidents', 'incident', 'evidence'),
  ).rejects.toMatchObject({ code: 'invalid-response' });
  fetch.mockImplementation(
    async () => new Response('synthetic', { headers: { 'content-type': 'text/html' } }),
  );
  await expect(
    client.getChecklistEvidence('token', 'site', 'checklist', 'evidence'),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});

it('preserves Overview context when opening related alerts', async () => {
  const fetch = vi.fn<(url: string | URL | Request) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ items: [], total: 0 }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const filters = {
    contextTeamId: 'team-a',
    attentionOnly: true,
    capturedFrom: '2026-10-14T00:00:00Z',
  };
  await client.listSafetyAlerts('token', 'site-a', filters);
  const url = new URL(String(fetch.mock.calls[0]![0]));
  expect(url.searchParams.get('contextTeamId')).toBe('team-a');
  expect(url.searchParams.get('attentionOnly')).toBe('true');
});

it('serializes week and Zone context without changing scoped resource paths', async () => {
  const fetch = vi.fn<(url: string | URL | Request) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ items: [], total: 0 }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test'),
    q = { date: '2026-10-14', timezone: 'Asia/Ho_Chi_Minh', offset: 20 };
  await client.getSafetyWeek('token', 'site-a', q);
  await client.listSafetyZoneTeams('token', 'site-a', 'zone-a', q);
  const first = new URL(String(fetch.mock.calls[0]![0])),
    second = new URL(String(fetch.mock.calls[1]![0]));
  expect(first.pathname).toBe('/api/v1/sites/site-a/safety-overview/week');
  expect(second.pathname).toBe('/api/v1/sites/site-a/safety-overview/zones/zone-a/teams');
  expect(first.searchParams.get('offset')).toBe('20');
  expect(second.searchParams.get('timezone')).toBe('Asia/Ho_Chi_Minh');
});
