import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';
const site = '11111111-1111-4111-8111-111111111111',
  episode = '22222222-2222-4222-8222-222222222222',
  alert = '33333333-3333-4333-8333-333333333333';
const page = () => ({
  episodeId: episode,
  contentRevision: 1,
  throughSequence: '18446744073709551615',
  offset: 0,
  limit: 20,
  total: 1,
  hasMore: false,
  items: [
    {
      alertId: alert,
      eventId: site,
      personObservationIndex: 0,
      payloadHash: 'a'.repeat(64),
      sourceSequence: '18446744073709551615',
      capturedAt: '2026-11-01T10:00:00Z',
      observationIndexes: [1],
      frames: [],
    },
  ],
});
afterEach(() => vi.unstubAllGlobals());
const identitySource = {
  alertId: alert,
  eventId: site,
  personObservationIndex: 0,
  evidenceIndex: 0,
};
const identity = () => ({
  episodeId: episode,
  siteId: site,
  source: { ...identitySource },
  subjectRef: {
    eventId: site,
    personObservationIndex: 0,
    payloadHash: 'a'.repeat(64),
    cameraId: alert,
    cameraExternalId: 'synthetic-camera',
    streamSessionId: episode,
    capturedAt: '2026-11-01T10:00:00Z',
    trackId: 1,
    personBoundingBox: { x1: 0.1, y1: 0.1, x2: 0.7, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
  },
  revision: 0,
  latestDecision: null,
});
it('reads identity only for exact original source and payload hash with bounded private transport', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(identity()));
  vi.stubGlobal('fetch', fetcher);
  const result = await new SmartSiteManagementClient(
    'https://example.test',
  ).getTrackedObservationIdentity('token', site, episode, identitySource, 'a'.repeat(64));
  expect(result.latestDecision).toBeNull();
  expect(result.subjectRef.payloadHash).toBe('a'.repeat(64));
  expect(String(fetcher.mock.calls[0]?.[0])).toContain(
    `/findings/${alert}/events/${site}/identity?personObservationIndex=0&evidenceIndex=0`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
});
it('rejects identity hash/revision mismatch and preserves narrower role denial', async () => {
  for (const response of [
    Response.json({ ...identity(), revision: 1 }),
    Response.json({
      ...identity(),
      subjectRef: { ...identity().subjectRef, payloadHash: 'b'.repeat(64) },
    }),
    new Response('x'.repeat(16385), { headers: { 'content-type': 'application/json' } }),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(
      new SmartSiteManagementClient('https://example.test').getTrackedObservationIdentity(
        'token',
        site,
        episode,
        identitySource,
        'a'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'Forbidden' }, { status: 403 })),
  );
  await expect(
    new SmartSiteManagementClient('https://example.test').getTrackedObservationIdentity(
      'token',
      site,
      episode,
      identitySource,
      'a'.repeat(64),
    ),
  ).rejects.toMatchObject({ code: 'http', status: 403 });
});
const detail = () => ({
  episodeId: episode,
  siteId: site,
  cameraId: alert,
  subject: { kind: 'TRACKED', segmentId: site, scopeSha256: 'a'.repeat(64) },
  firstObservedAt: '2026-11-01T10:00:00Z',
  lastObservedAt: '2026-11-01T10:01:00Z',
  contentRevision: 1,
  collectionState: 'COLLECTING',
  findings: [
    {
      alertId: alert,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'MISSING_HARD_HAT',
      status: 'PENDING_REVIEW',
      alertRevision: 1,
      zoneId: null,
      observationCount: 3,
    },
  ],
});
it('reads distinct tracked detail without inventing anchor identity or evidence', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(detail()));
  vi.stubGlobal('fetch', fetcher);
  const result = await new SmartSiteManagementClient('https://example.test').getTrackedEpisode(
    'token',
    site,
    episode,
  );
  expect(result.subject.kind).toBe('TRACKED');
  expect(result.findings[0]?.observationCount).toBe(3);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain(
    `/sites/${site}/safety-episodes/${episode}/tracked`,
  );
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
});
it('rejects mismatched tracked detail and oversized metadata', async () => {
  for (const response of [
    Response.json({ ...detail(), siteId: alert }),
    new Response('x'.repeat(131073), { headers: { 'content-type': 'application/json' } }),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(
      new SmartSiteManagementClient('https://example.test').getTrackedEpisode(
        'token',
        site,
        episode,
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
it('uses bounded scoped no-store history transport and preserves uint64', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(page()));
  vi.stubGlobal('fetch', fetcher);
  const result = await new SmartSiteManagementClient(
    'https://example.test',
  ).listTrackedEpisodeObservations('token', site, episode, {
    throughSequence: '18446744073709551615',
    alertId: alert,
  });
  expect(result.items[0]?.sourceSequence).toBe('18446744073709551615');
  expect(String(fetcher.mock.calls[0]?.[0])).toContain(
    `/sites/${site}/safety-episodes/${episode}/observations?`,
  );
  const init = fetcher.mock.calls[0]?.[1] as RequestInit;
  expect(init.cache).toBe('no-store');
  expect(init.redirect).toBe('error');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
});
it('rejects other episode or scope/fence mismatch response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...page(), episodeId: site })),
  );
  await expect(
    new SmartSiteManagementClient('https://example.test').listTrackedEpisodeObservations(
      'token',
      site,
      episode,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
});
it('rejects invalid options before network and stale deferred response after cancellation', async () => {
  const fetcher = vi.fn(async () => Response.json(page()));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://example.test');
  await expect(
    client.listTrackedEpisodeObservations('token', site, episode, { limit: 21 }),
  ).rejects.toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
  const controller = new AbortController();
  controller.abort();
  await expect(
    client.listTrackedEpisodeObservations(
      'token',
      site,
      episode,
      {},
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects oversized streamed JSON and preserves denied response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('x'.repeat(524289), { headers: { 'content-type': 'application/json' } }),
    ),
  );
  await expect(
    new SmartSiteManagementClient('https://example.test').listTrackedEpisodeObservations(
      'token',
      site,
      episode,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 })),
  );
  await expect(
    new SmartSiteManagementClient('https://example.test').listTrackedEpisodeObservations(
      'token',
      site,
      episode,
    ),
  ).rejects.toMatchObject({ code: 'http', status: 403 });
});
it('does not deliver an old response after the caller cancels an in-flight request', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const pending = new SmartSiteManagementClient(
    'https://example.test',
  ).listTrackedEpisodeObservations('token', site, episode, {}, { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  finish(Response.json(page()));
  await assertion;
});
