// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafetyFrameInboxPage } from '@smartsite/api-client';
import type { useManagementClient } from './features/auth/auth-session';
import { FrameInboxCards } from './FrameInboxCards';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const CAM_A = '22222222-2222-4222-8222-222222222221';
const FRAME_KEY = 'tracked:' + 'a'.repeat(64) + ':frame-55';
const FRAME_SHA = 'b'.repeat(64);

function makeMixedFrame(): SafetyFrameInboxPage['items'][number] {
  return {
    siteId: SITE_A,
    cameraId: CAM_A,
    frameKey: FRAME_KEY,
    siteName: 'North Tower Site',
    cameraName: 'Crane Bay Camera 01',
    capturedAt: '2026-11-19T09:15:00.000Z',
    unread: true,
    findingCount: 3,
    cases: [
      {
        recipientId: '00000000-0000-4000-8000-000000000001',
        episodeId: '00000000-0000-4000-8000-000000000011',
        findingCount: 2,
        unread: true,
        contentRevision: 1,
        source: {
          alertId: '00000000-0000-4000-8000-000000000101',
          eventId: '00000000-0000-4000-8000-000000000200',
          personObservationIndex: 0,
          evidenceIndex: 0,
          sha256: FRAME_SHA,
        },
        zoneEntries: [
          {
            requestId: '00000000-0000-4000-8000-000000000301',
            zoneId: '44444444-4444-4444-8444-444444444401',
            status: 'DENIED',
            reasonCode: 'UNAUTHORIZED',
            provenance: 'TRUSTED_SERVICE',
          },
        ],
      },
      {
        recipientId: '00000000-0000-4000-8000-000000000002',
        episodeId: '00000000-0000-4000-8000-000000000012',
        findingCount: 1,
        unread: true,
        contentRevision: 1,
        source: null,
        zoneEntries: [
          {
            requestId: '00000000-0000-4000-8000-000000000302',
            zoneId: '44444444-4444-4444-8444-444444444402',
            status: 'PENDING',
            reasonCode: null,
            provenance: null,
          },
        ],
      },
      {
        recipientId: '00000000-0000-4000-8000-000000000003',
        episodeId: '00000000-0000-4000-8000-000000000013',
        findingCount: 0,
        unread: false,
        contentRevision: 1,
        source: null,
        zoneEntries: [
          {
            requestId: '00000000-0000-4000-8000-000000000303',
            zoneId: '44444444-4444-4444-8444-444444444403',
            status: 'UNAVAILABLE',
            reasonCode: 'IDENTITY_UNAVAILABLE',
            provenance: 'UNAVAILABLE',
          },
        ],
      },
    ],
  };
}

describe('FrameInboxCards visual counter separation and subject row clarity', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://api.invalid/frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('renders separate semantic counter pills for Subjects, PPE findings, and Zone outcomes while preserving accessible card toggle copy in EN and VI', async () => {
    const client = {
      getTrackedEpisode: vi.fn().mockResolvedValue({
        findings: [
          {
            alertId: 'hat-1',
            alertType: 'PPE_VIOLATION',
            candidateSubtype: 'PPE_HARD_HAT_MISSING',
            status: 'PENDING_REVIEW',
          },
        ],
      }),
      readTrackedEpisodeMedia: vi.fn().mockResolvedValue({
        blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
        sha256: FRAME_SHA,
        frameSha256: FRAME_SHA,
        representation: 'FRAME',
      }),
      readSafetyEpisodeInbox: vi.fn(),
    } as unknown as ReturnType<typeof useManagementClient>;

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FrameInboxCards
            client={client}
            token="tok"
            scope="scope-1"
            frames={[makeMixedFrame()]}
            frameKey={FRAME_KEY}
            onRefetch={async () => undefined}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', {
      name: /3 people to review · 3 PPE findings · 1 denied Zone entry/i,
    });
    expect(within(toggle).getByTestId('frame-summary-subjects-pill').textContent).toBe(
      '3 people to review',
    );
    expect(within(toggle).getByTestId('frame-summary-ppe-pill').textContent).toBe('3 PPE findings');
    expect(within(toggle).getByTestId('frame-summary-zone-denied-pill').textContent).toBe(
      '1 denied Zone entry',
    );
    expect(within(toggle).getByTestId('frame-pending-zone-summary')).toBeTruthy();
    expect(within(toggle).getByTestId('frame-unavailable-zone-summary')).toBeTruthy();

    const row1 = await screen.findByTestId('frame-subject-row-1');
    expect(within(row1).getByTestId('frame-subject-ppe-count-1').textContent).toBe(
      '2 PPE findings',
    );

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('frame-summary-ppe-pill').textContent).toContain('3');
  });
});
