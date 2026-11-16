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
