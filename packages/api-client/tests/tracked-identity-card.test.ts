import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/management';

const site = '00000000-0000-4000-8000-000000000001';
const episode = '00000000-0000-4000-8000-000000000002';
const workerId = '00000000-0000-4000-8000-000000000003';
const source = { alertId: episode, eventId: workerId, personObservationIndex: 0, evidenceIndex: 0 };
const hash = 'a'.repeat(64);
const subjectRef = {
  eventId: source.eventId,
  personObservationIndex: 0,
  payloadHash: hash,
  cameraId: episode,
  cameraExternalId: 'synthetic-camera',
  streamSessionId: site,
  capturedAt: '2026-11-19T10:00:00.000Z',
  trackId: 1,
  personBoundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
};
function card(resolved = true) {
  return {
    episodeId: episode,
    siteId: site,
    source,
    subjectRef,
    revision: resolved ? 1 : 0,
    latestDecision: resolved
      ? {
          id: episode,
          revision: 1,
          action: 'RESOLVE',
          workerId,
          actorUserId: site,
          reason: 'Synthetic reviewed observation',
          scope: 'EXACT_OBSERVATION',
          verificationMethod: 'MANUAL',
          recordedAt: '2026-11-19T10:01:00.000Z',
          subjectRef,
          evidenceIndex: 0,
          evidenceSha256: hash,
        }
      : null,
    worker: resolved
      ? {
          id: workerId,
          siteId: site,
          externalId: 'W001',
          displayName: 'Synthetic Worker',
          isActive: true,
        }
      : null,
  };
}
const client = () => new SmartSiteManagementClient('https://synthetic.invalid/api/v1');
afterEach(() => vi.unstubAllGlobals());

it('reads a separately scoped worker card without changing the legacy identity endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(card()));
  vi.stubGlobal('fetch', fetcher);
  const result = await client().getTrackedObservationIdentityCard(
    'token',
    site,
    episode,
    source,
    hash,
  );
  expect(result.worker?.displayName).toBe('Synthetic Worker');
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('/identity-card?');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
});

it('keeps unknown and unavailable current directory metadata explicit', async () => {
  for (const response of [card(false), { ...card(), worker: null }]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );
    expect(
      (await client().getTrackedObservationIdentityCard('token', site, episode, source, hash))
        .worker,
    ).toBeNull();
  }
});

it('rejects an invalid source or payload digest before requesting names', async () => {
  const fetcher = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    client().getTrackedObservationIdentityCard('token', site, episode, source, 'bad'),
  ).rejects.toMatchObject({ code: 'invalid-response' });
  await expect(
    client().getTrackedObservationIdentityCard(
      'token',
      site,
      episode,
      { ...source, evidenceIndex: -1 },
      hash,
    ),
  ).rejects.toMatchObject({ code: 'invalid-response' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects a different worker/site, unknown identity with a name, and a legacy payload', async () => {
  const good = card();
  for (const response of [
    { ...good, worker: { ...good.worker!, id: site } },
    { ...good, worker: { ...good.worker!, siteId: episode } },
    { ...card(false), worker: good.worker },
    { ...good, worker: { ...good.worker!, encryptedTemplate: 'must-not-cross-boundary' } },
    Object.fromEntries(Object.entries(good).filter(([key]) => key !== 'worker')),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );
    await expect(
      client().getTrackedObservationIdentityCard('token', site, episode, source, hash),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
