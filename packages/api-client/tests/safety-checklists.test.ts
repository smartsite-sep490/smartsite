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
