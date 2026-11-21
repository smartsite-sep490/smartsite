// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@smartsite/api-client';
import { expect, it, vi } from 'vitest';
import { IdentificationEvidenceApproval } from './IdentificationEvidenceApproval';
import type { ManagementClient } from './IdentificationWorkspaceScope';

it('reviews the tracked fallback image and clears approval on a mask change', async () => {
  const sha256 = 'a'.repeat(64);
  const preview = vi.fn().mockResolvedValue({ blob: new Blob(), sha256: 'b'.repeat(64) });
  const client = {
    getSafetyEpisode: vi.fn().mockRejectedValue(new ApiError('http', 'Tracked episode', 409)),
    listTrackedEpisodeObservations: vi
      .fn()
      .mockResolvedValueOnce({
        episodeId: 'episode',
        offset: 0,
        throughSequence: '7',
        hasMore: true,
        items: [
          {
            alertId: 'alert',
            eventId: 'event',
            personObservationIndex: 2,
            frames: [{ evidenceIndex: 0, sha256 }],
          },
        ],
      })
      .mockResolvedValueOnce({
        episodeId: 'episode',
        offset: 1,
        throughSequence: '7',
        hasMore: false,
        items: [
          {
            alertId: 'alert',
            eventId: 'later-event',
            personObservationIndex: 2,
            frames: [{ evidenceIndex: 0, sha256 }],
          },
        ],
      }),
    previewSafetyIdentificationEvidence: preview,
  } as unknown as ManagementClient;
  const approve = vi.fn();
  const create = vi.fn(() => 'blob:preview');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const query = new QueryClient();
  const view = render(
    <QueryClientProvider client={query}>
      <IdentificationEvidenceApproval
        client={client}
        token="session"
        siteId="site"
        episodeId="episode"
        vietnamese={false}
        disabled={false}
        onApprove={approve}
      />
    </QueryClientProvider>,
  );
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }));
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more image sources' }));
    await screen.findByRole('option', { name: 'Image 2' });
    expect(client.listTrackedEpisodeObservations).toHaveBeenLastCalledWith(
      'session',
      'site',
      'episode',
      { limit: 20, offset: 1, throughSequence: '7' },
      expect.anything(),
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview image' }));
    await screen.findByRole('img', { name: 'Image to share' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve).toHaveBeenLastCalledWith({
      preview: {
        episodeId: 'episode',
        eventId: 'later-event',
        alertId: 'alert',
        personObservationIndex: 2,
        evidenceIndex: 0,
        masks: [{ left: 0, top: 0, right: 5000, bottom: 5000 }],
      },
      frameSha256: sha256,
      sha256: 'b'.repeat(64),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo last mask (1)' }));
    expect(approve).toHaveBeenLastCalledWith(undefined);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:preview'));
  } finally {
    view.unmount();
    query.clear();
    vi.unstubAllGlobals();
  }
});

it('supports letterbox-accurate pointer drag masking on the protected subject crop, requires explicit preview before approval, and cleans up URLs on source change, denial, and unmount', async () => {
  const frameSha = 'c'.repeat(64);
  const unmaskedSha = 'd'.repeat(64);
  const maskedSha = 'e'.repeat(64);
  const preview = vi
    .fn()
    .mockResolvedValueOnce({
      blob: new Blob(['crop'], { type: 'image/jpeg' }),
      sha256: unmaskedSha,
    })
    .mockResolvedValueOnce({
      blob: new Blob(['masked'], { type: 'image/jpeg' }),
      sha256: maskedSha,
    });
  const client = {
    getSafetyEpisode: vi.fn().mockResolvedValue({
      id: 'episode-1',
      siteId: 'site-1',
      findings: [
        {
          alertId: 'alert-1',
          evidenceRefs: [
            {
              available: true,
              eventId: 'event-1',
              personObservationIndex: 0,
              evidenceIndex: 0,
              sha256: frameSha,
            },
            {
              available: true,
              eventId: 'event-2',
              personObservationIndex: 0,
              evidenceIndex: 0,
              sha256: frameSha,
            },
          ],
        },
      ],
    }),
    listTrackedEpisodeObservations: vi.fn(),
    previewSafetyIdentificationEvidence: preview,
  } as unknown as ManagementClient;

  let nextUrlId = 1;
  const createdUrls: string[] = [];
  const revokedUrls: string[] = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => {
        const u = `blob:c02-${nextUrlId++}`;
        createdUrls.push(u);
        return u;
      });
      static revokeObjectURL = vi.fn((u: string) => {
        revokedUrls.push(u);
      });
    },
  );

  const approve = vi.fn();
  const query = new QueryClient();
  const view = render(
    <QueryClientProvider client={query}>
      <IdentificationEvidenceApproval
        client={client}
        token="session-tok"
        siteId="site-1"
        episodeId="episode-1"
        vietnamese={false}
        disabled={false}
        onApprove={approve}
      />
    </QueryClientProvider>,
  );

  try {
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }));
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '0' } });

    // Does NOT auto-fetch crop on source select; explicit user action loads protected subject crop (masks: [])
    expect(preview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('c02-load-authoring-crop'));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenLastCalledWith(
      'session-tok',
      'site-1',
      {
        episodeId: 'episode-1',
        alertId: 'alert-1',
        eventId: 'event-1',
        personObservationIndex: 0,
        evidenceIndex: 0,
        masks: [],
      },
      frameSha,
      expect.anything(),
    );

    const cropImg = (await screen.findByTestId('c02-authoring-crop-img')) as HTMLImageElement;
    // Before natural dimensions load, pointer stage is not interactive
    expect(screen.queryByTestId('c02-crop-mask-stage')).toBeNull();

    Object.defineProperty(cropImg, 'naturalWidth', { configurable: true, value: 200 });
    Object.defineProperty(cropImg, 'naturalHeight', { configurable: true, value: 300 });
    fireEvent.load(cropImg);

    const stage = await screen.findByTestId('c02-crop-mask-stage');
    // Container is 400x300 holding a 200x300 portrait crop -> 100px horizontal letterbox bars on each side
    // Rendered image occupies x: [110..310], y: [20..320]
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 400,
      height: 300,
      right: 410,
      bottom: 320,
      toJSON: () => ({}),
    });

    // Reverse drag (bottom-right -> top-left) inside rendered portrait crop:
    // x: 260 -> (260-110)/200 = 0.75 (7500bp); x: 160 -> (160-110)/200 = 0.25 (2500bp)
    // y: 200 -> (200-20)/300 = 0.60 (6000bp); y: 80 -> (80-20)/300 = 0.20 (2000bp)
    fireEvent.pointerDown(stage, { button: 0, clientX: 260, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(stage, { clientX: 160, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 160, clientY: 80, pointerId: 1 });

    // Drawing a mask never auto-approves; explicit server preview + confirmation checkbox still required
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('c02-mask-chip-0').textContent).toContain('#1');

    fireEvent.click(screen.getByRole('button', { name: 'Preview image' }));
    await screen.findByRole('img', { name: 'Image to share' });
    expect(preview).toHaveBeenLastCalledWith(
      'session-tok',
      'site-1',
      {
        episodeId: 'episode-1',
        alertId: 'alert-1',
        eventId: 'event-1',
        personObservationIndex: 0,
        evidenceIndex: 0,
        masks: [{ left: 2500, top: 2000, right: 7500, bottom: 6000 }],
      },
      frameSha,
      expect.anything(),
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve).toHaveBeenLastCalledWith({
      preview: {
        episodeId: 'episode-1',
        alertId: 'alert-1',
        eventId: 'event-1',
        personObservationIndex: 0,
        evidenceIndex: 0,
        masks: [{ left: 2500, top: 2000, right: 7500, bottom: 6000 }],
      },
      frameSha256: frameSha,
      sha256: maskedSha,
    });

    // Switching source revokes approval AND revokes both authoring crop and masked preview blob URLs
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '1' } });
    expect(approve).toHaveBeenLastCalledWith(undefined);
    await waitFor(() => {
      expect(revokedUrls).toContain('blob:c02-1');
      expect(revokedUrls).toContain('blob:c02-2');
    });
  } finally {
    view.unmount();
    query.clear();
    vi.unstubAllGlobals();
  }
});
