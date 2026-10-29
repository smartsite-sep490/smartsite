import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '../src/index';
import type { SafetyEpisode } from '../src/index';

// Browser clients must not evaluate the Node-only schema loaders from the root barrel.
vi.mock('@smartsite/contracts', () => {
  throw new Error('Browser client imported the Node-only contracts root at runtime');
});

afterEach(() => vi.unstubAllGlobals());
const client = () => new SmartSiteManagementClient('https://api.example.test');
function reply(payload: unknown, status = 200) {
  const mock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('episode API transport contract (endpoints not deployed)', () => {
  it('uses scoped encoded resource paths and preserves all explicit list filters', async () => {
    const mock = reply({ items: [], total: 0 });
    const api = client();
    await api.listSafetyEpisodes('token', 'site/1', {
      offset: 0,
      limit: 20,
      cameraId: 'camera&1',
      zoneId: 'zone/2',
    });
    await api.getSafetyEpisode('token', 'site/1', 'episode/3');
    expect(mock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.example.test/api/v1/sites/site%2F1/safety-episodes?offset=0&limit=20&cameraId=camera%261&zoneId=zone%2F2',
      'https://api.example.test/api/v1/sites/site%2F1/safety-episodes/episode%2F3',
    ]);
    for (const [, init] of mock.mock.calls)
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('keeps two independent findings for one exact subject without inventing Worker identity', async () => {
    const episode: SafetyEpisode = {
      id: 'episode',
      siteId: 'site',
      cameraId: 'camera',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: '11111111-1111-4111-8111-111111111111',
        personObservationIndex: 1,
      },
      configurationBundleId: null,
      firstObservedAt: '2026-10-23T00:00:00Z',
      lastObservedAt: '2026-10-23T00:00:00Z',
      contentRevision: 2,
      collectionState: 'SEALED',
      findingCount: 2,
      identityDecision: null,
      workflowLinks: [],
      findings: [
        {
          alertId: 'hat',
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          status: 'CONFIRMED',
          alertRevision: 2,
          zoneId: null,
          evidenceRefs: [],
        },
        {
          alertId: 'vest',
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          status: 'NEEDS_MORE_EVIDENCE',
          alertRevision: 1,
          zoneId: null,
          evidenceRefs: [],
        },
      ],
    };
    reply(episode);
    const detail = await client().getSafetyEpisode('token', 'site', 'episode');
    expect(detail.findings.map((finding) => [finding.alertId, finding.status])).toEqual([
      ['hat', 'CONFIRMED'],
      ['vest', 'NEEDS_MORE_EVIDENCE'],
    ]);
    expect(detail.identityDecision).toBeNull();
    expect(detail.subject).toEqual(episode.subject);
  });

  it('does not turn an empty explicit Site filter into an all-Sites request', async () => {
    const mock = reply({ items: [], total: 0, unreadCount: 0 });
    await client().listSafetyEpisodeInbox('token', {
      offset: 20,
      limit: 20,
      siteId: '',
      readStatus: 'UNREAD',
    });
    expect(mock.mock.calls[0]![0]).toBe(
      'https://api.example.test/api/v1/me/safety-episode-inbox?offset=20&limit=20&siteId=&readStatus=UNREAD',
    );
  });

  it('sends only the observed revision; a newer server revision remains unread', async () => {
    const response = { id: 'notice', contentRevision: 3, seenRevision: 2, unread: true };
    const mock = reply(response);
    const result = await client().readSafetyEpisodeInbox('token', 'notice/1', { seenRevision: 2 });
    expect(result).toEqual(response);
    expect(mock.mock.calls[0]![0]).toBe(
      'https://api.example.test/api/v1/me/safety-episode-inbox/notice%2F1/read',
    );
    expect(mock.mock.calls[0]![1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({ seenRevision: 2 }),
    });
  });

  it('rejects malformed read bodies before sending a network request', async () => {
    const mock = reply({});
    const api = client();
    for (const body of [{ seenRevision: 0 }, { seenRevision: 2, recipientId: 'other' }]) {
      await expect(api.readSafetyEpisodeInbox('token', 'notice', body)).rejects.toThrow();
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409])(
    'preserves HTTP %s instead of pretending the operation succeeded',
    async (status) => {
      reply({ message: 'Denied' }, status);
      await expect(
        client().readSafetyEpisodeInbox('token', 'notice', { seenRevision: 2 }),
      ).rejects.toMatchObject({ status });
    },
  );

  it('honors cancellation for all four methods using the existing transport', async () => {
    const mock = reply({});
    const abort = new AbortController();
    abort.abort();
    const options = { signal: abort.signal };
    const api = client();
    for (const run of [
      () => api.listSafetyEpisodes('token', 'site', {}, options),
      () => api.getSafetyEpisode('token', 'site', 'episode', options),
      () => api.listSafetyEpisodeInbox('token', {}, options),
      () => api.readSafetyEpisodeInbox('token', 'notice', { seenRevision: 1 }, options),
    ])
      await expect(run()).rejects.toBeInstanceOf(ApiError);
    expect(mock).not.toHaveBeenCalled();
  });
});
