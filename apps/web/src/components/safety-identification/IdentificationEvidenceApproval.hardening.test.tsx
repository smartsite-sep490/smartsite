// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentificationEvidenceApproval } from './IdentificationEvidenceApproval';
import type { ManagementClient } from './IdentificationWorkspaceScope';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('revokes approved media when the management client changes without changing credentials', async () => {
  const approve = vi.fn();
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:client-scope';
      static revokeObjectURL = revoke;
    },
  );
  const client = {
    getSafetyEpisode: vi.fn().mockResolvedValue({
      id: 'episode',
      siteId: 'site',
      findings: [
        {
          alertId: 'alert',
          evidenceRefs: [
            {
              available: true,
              eventId: 'event',
              personObservationIndex: 0,
              evidenceIndex: 0,
              sha256: 'a'.repeat(64),
            },
          ],
        },
      ],
    }),
    previewSafetyIdentificationEvidence: vi
      .fn()
      .mockResolvedValue({ blob: new Blob(), sha256: 'b'.repeat(64) }),
  } as unknown as ManagementClient;
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const build = (value: ManagementClient) => (
    <QueryClientProvider client={query}>
      <IdentificationEvidenceApproval
        client={value}
        token="same-token"
        siteId="site"
        episodeId="episode"
        vietnamese={false}
        disabled={false}
        onApprove={approve}
      />
    </QueryClientProvider>
  );
  const view = render(build(client));
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }));
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview image' }));
    await screen.findByRole('img', { name: 'Image to share' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve).toHaveBeenLastCalledWith(expect.objectContaining({ sha256: 'b'.repeat(64) }));
    const replacementClient: ManagementClient = Object.create(client);
    view.rerender(build(replacementClient));
    await waitFor(() => expect(approve).toHaveBeenLastCalledWith(undefined));
    expect(screen.queryByRole('img', { name: 'Image to share' })).toBeNull();
    expect((screen.getByLabelText('Image source') as HTMLSelectElement).value).toBe('');
    expect(revoke).toHaveBeenCalledWith('blob:client-scope');
  } finally {
    view.unmount();
    query.clear();
  }
});

describe('IdentificationEvidenceApproval P1 hardening regressions (F1, F2, F3, F4)', () => {
  it('F1 + F4: recovers cleanly from probe img decode error / zero dimensions without losing drafted masks, and shows explicit validation alert on invalid numeric mask draft', async () => {
    const frameSha = 'a'.repeat(64);
    const preview = vi.fn().mockResolvedValue({
      blob: new Blob(['corrupt'], { type: 'image/jpeg' }),
      sha256: 'b'.repeat(64),
      frameSha256: frameSha,
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
            ],
          },
        ],
      }),
      listTrackedEpisodeObservations: vi.fn(),
      previewSafetyIdentificationEvidence: preview,
    } as unknown as ManagementClient;

    const revoked: string[] = [];
    let seq = 0;
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => `blob:f1-${++seq}`);
        static revokeObjectURL = vi.fn((u: string) => {
          revoked.push(u);
        });
      },
    );

    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={query}>
        <IdentificationEvidenceApproval
          client={client}
          token="tok-secret-1"
          siteId="site-1"
          episodeId="episode-1"
          vietnamese={false}
          disabled={false}
          onApprove={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }));
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '0' } });

    // F4: Invalid numeric draft (Left >= Right or decimal) shows explicit validation message instead of silent no-op
    fireEvent.change(screen.getByLabelText('Left'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Right'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    expect(screen.getByTestId('c02-numeric-mask-error').textContent).toMatch(
      /0.*100.*Left.*Right/i,
    );

    // Valid numeric mask clears validation error and adds mask #1
    fireEvent.change(screen.getByLabelText('Left'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Right'), { target: { value: '40' } });
    expect(screen.queryByTestId('c02-numeric-mask-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    expect(screen.getByTestId('c02-mask-chip-0').textContent).toContain('#1');

    // F1: Trigger authoring crop load, then simulate browser <img> decode failure
    fireEvent.click(screen.getByTestId('c02-load-authoring-crop'));
    const probeImg = await screen.findByTestId('c02-authoring-crop-img');
    fireEvent.error(probeImg);

    // Probe error clears cropUrl, revokes broken blob, surfaces Retry banner, keeps mask #1, and reopens numeric <details>
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(revoked).toContain('blob:f1-1');
    expect(screen.getByTestId('c02-mask-chip-0').textContent).toContain('#1');
    const fallbackDetails = screen
      .getByText('Numeric percentage coordinates (keyboard fallback)')
      .closest('details');
    expect(fallbackDetails?.hasAttribute('open')).toBe(true);
  });

  it('F2 + F3: clears input on Step 2 403 denial without re-fetching on prop change, resets state on standalone token/site/episode transitions without leaking raw token in queryKey, and handles border-box + lostpointercapture + mid-drag disabled', async () => {
    const frameSha = 'c'.repeat(64);
    const maskedSha = 'd'.repeat(64);
    let failStep2With403 = false;

    const preview = vi.fn().mockImplementation(async (_tok, _site, body: { masks: unknown[] }) => {
      if (body.masks.length > 0 && failStep2With403) {
        throw new ApiError('http', 'Forbidden', 403);
      }
      return {
        blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
        sha256: body.masks.length === 0 ? 'e'.repeat(64) : maskedSha,
        frameSha256: frameSha,
      };
    });

    const client = {
      getSafetyEpisode: vi.fn().mockImplementation(async (_tok, siteId, episodeId) => ({
        id: episodeId,
        siteId,
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
            ],
          },
        ],
      })),
      listTrackedEpisodeObservations: vi.fn(),
      previewSafetyIdentificationEvidence: preview,
    } as unknown as ManagementClient;

    let seq = 0;
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = vi.fn(() => `blob:f2-${++seq}`);
        static revokeObjectURL = vi.fn();
      },
    );

    const approve = vi.fn();
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const build = (props: {
      token: string;
      siteId: string;
      episodeId: string;
      disabled: boolean;
    }) => (
      <QueryClientProvider client={query}>
        <IdentificationEvidenceApproval
          client={client}
          token={props.token}
          siteId={props.siteId}
          episodeId={props.episodeId}
          vietnamese={false}
          disabled={props.disabled}
          onApprove={(val) => approve(val)}
        />
      </QueryClientProvider>
    );

    const view = render(
      build({
        token: 'secret-jwt-alpha',
        siteId: 'site-1',
        episodeId: 'episode-1',
        disabled: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }));
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '0' } });

    // Raw token must never appear in TanStack Query cache keys
    const cacheKeysJson = JSON.stringify(
      query
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    expect(cacheKeysJson).not.toContain('secret-jwt-alpha');

    // Load authoring crop for F3 border-box, lostpointercapture, and mid-drag disabled checks
    fireEvent.click(screen.getByTestId('c02-load-authoring-crop'));
    const cropImg = (await screen.findByTestId('c02-authoring-crop-img')) as HTMLImageElement;
    Object.defineProperty(cropImg, 'naturalWidth', { configurable: true, value: 200 });
    Object.defineProperty(cropImg, 'naturalHeight', { configurable: true, value: 200 });
    fireEvent.load(cropImg);

    const stage = await screen.findByTestId('c02-crop-mask-stage');
    // Outer border-box is 202x202 with 1px border (clientLeft=1, clientTop=1, clientWidth=200, clientHeight=200)
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      left: 10,
      top: 20,
      width: 202,
      height: 202,
      right: 212,
      bottom: 222,
      toJSON: () => ({}),
    });
    Object.defineProperty(stage, 'clientLeft', { configurable: true, value: 1 });
    Object.defineProperty(stage, 'clientTop', { configurable: true, value: 1 });
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, value: 200 });

    // 1) lostpointercapture clears frozen draft rect without adding a mask
    fireEvent.pointerDown(stage, { button: 0, clientX: 31, clientY: 41, pointerId: 7 });
    fireEvent.pointerMove(stage, { clientX: 111, clientY: 121, pointerId: 7 });
    expect(screen.getByTestId('c02-draft-mask-rect')).toBeTruthy();
    fireEvent.lostPointerCapture(stage, { pointerId: 7 });
    expect(screen.queryByTestId('c02-draft-mask-rect')).toBeNull();
    expect(screen.queryByTestId('c02-mask-chip-0')).toBeNull();

    // 2) Flipping disabled=true mid-drag prevents pointerUp from committing a mask
    fireEvent.pointerDown(stage, { button: 0, clientX: 31, clientY: 41, pointerId: 8 });
    fireEvent.pointerMove(stage, { clientX: 111, clientY: 121, pointerId: 8 });
    view.rerender(
      build({
        token: 'secret-jwt-alpha',
        siteId: 'site-1',
        episodeId: 'episode-1',
        disabled: true,
      }),
    );
    fireEvent.pointerUp(stage, { clientX: 111, clientY: 121, pointerId: 8 });
    expect(screen.queryByTestId('c02-mask-chip-0')).toBeNull();

    // Re-enable and draw exact inner-box coordinates:
    // inner left = 10 + 1 = 11, inner top = 20 + 1 = 21; 200x200 -> (51-11)/200 = 0.20 (2000bp), (151-11)/200 = 0.70 (7000bp)
    view.rerender(
      build({
        token: 'secret-jwt-alpha',
        siteId: 'site-1',
        episodeId: 'episode-1',
        disabled: false,
      }),
    );
    fireEvent.pointerDown(stage, { button: 0, clientX: 51, clientY: 61, pointerId: 9 });
    fireEvent.pointerMove(stage, { clientX: 151, clientY: 161, pointerId: 9 });
    fireEvent.pointerUp(stage, { clientX: 151, clientY: 161, pointerId: 9 });

    // Preview & approve first, then verify standalone token transition revokes approval & resets state
    fireEvent.click(screen.getByRole('button', { name: 'Preview image' }));
    await screen.findByRole('img', { name: 'Image to share' });
    expect(preview).toHaveBeenLastCalledWith(
      'secret-jwt-alpha',
      'site-1',
      expect.objectContaining({
        masks: [{ left: 2000, top: 2000, right: 7000, bottom: 7000 }],
      }),
      frameSha,
      expect.anything(),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(approve).toHaveBeenLastCalledWith(expect.objectContaining({ sha256: maskedSha }));

    // F2a: Standalone token rotation resets masks/selection/approval and does not retain approved=true
    approve.mockClear();
    view.rerender(
      build({
        token: 'secret-jwt-beta',
        siteId: 'site-1',
        episodeId: 'episode-1',
        disabled: false,
      }),
    );
    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith(undefined);
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByTestId('c02-mask-chip-0')).toBeNull();

    // F2b: Step 2 403 denial clears input so subsequent prop change does NOT re-trigger preview
    await screen.findByRole('option', { name: 'Image 1' });
    fireEvent.change(screen.getByLabelText('Image source'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add mask' }));
    failStep2With403 = true;
    preview.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Preview image' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(preview).toHaveBeenCalledTimes(1);

    preview.mockClear();
    view.rerender(
      build({
        token: 'secret-jwt-gamma',
        siteId: 'site-1',
        episodeId: 'episode-1',
        disabled: false,
      }),
    );
    expect(preview).not.toHaveBeenCalled();
  });
});
