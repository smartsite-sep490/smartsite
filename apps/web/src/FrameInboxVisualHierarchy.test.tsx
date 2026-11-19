// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse, SafetyFrameInboxPage } from '@smartsite/api-client';
import { FramePpeInbox } from './FramePpeInbox';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const CAM_A = '22222222-2222-4222-8222-222222222221';
const FRAME_KEY = 'tracked:' + 'a'.repeat(64) + ':frame-55';
const FRAME_SHA = 'b'.repeat(64);

const api = vi.hoisted(() => ({
  listSites: vi.fn(),
  listPreviewCameras: vi.fn(),
  listSafetyFrameInbox: vi.fn(),
  getTrackedEpisode: vi.fn(),
  getSafetyEpisode: vi.fn(),
  readTrackedEpisodeMedia: vi.fn(),
  readSafetyEpisodeInbox: vi.fn(),
}));

vi.mock('./features/auth/auth-session', () => ({
  useManagementClient: () => api,
}));

const officerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-visual-hierarchy',
  user: {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }],
  },
};

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

describe('FramePpeInbox operational hierarchy, side-by-side evidence split, and decluttered subject rows', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.resetAllMocks();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://api.invalid/frame');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    api.listSites.mockResolvedValue({
      items: [{ id: SITE_A, code: 'NORTH', name: 'North Tower Site' }],
      total: 1,
    });
    api.listPreviewCameras.mockResolvedValue({
      items: [{ id: CAM_A, name: 'Crane Bay Camera 01' }],
      total: 1,
    });
    api.listSafetyFrameInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [makeMixedFrame()],
    });
    api.getTrackedEpisode.mockImplementation(
      async (_token: string, _siteId: string, episodeId: string) => {
        if (episodeId.endsWith('11')) {
          return {
            findings: [
              {
                alertId: 'hat-1',
                alertType: 'PPE_VIOLATION',
                candidateSubtype: 'PPE_HARD_HAT_MISSING',
                status: 'PENDING_REVIEW',
              },
              {
                alertId: 'vest-1',
                alertType: 'PPE_VIOLATION',
                candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
                status: 'PENDING_REVIEW',
              },
            ],
          };
        }
        return {
          findings: [
            {
              alertId: 'vest-2',
              alertType: 'PPE_VIOLATION',
              candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
              status: 'PENDING_REVIEW',
            },
          ],
        };
      },
    );
    api.readTrackedEpisodeMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      sha256: FRAME_SHA,
      frameSha256: FRAME_SHA,
      representation: 'FRAME',
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('presents 24-28px heading before filters, side-by-side evidence + 3-person breakdown on expand, >=12px type floor, and collapsible duplicate disclaimers', async () => {
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A })}`,
          ]}
        >
          <FramePpeInbox apiUrl="http://api.invalid" session={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const heading = await screen.findByRole('heading', { level: 1, name: 'Frame inbox' });
    expect(heading.className).toContain('text-2xl');
    expect(heading.className).toContain('sm:text-[1.75rem]');
    expect(heading.className).not.toContain('text-3xl');

    // L1 header precedes L2 filter bar in DOM order
    const filterAnchor = container.querySelector('[data-tour-anchor="frame-inbox-filters"]')!;
    expect(
      Boolean(heading.compareDocumentPosition(filterAnchor) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);

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

    // Expand grouped frame -> side-by-side split container, zero read mutation
    fireEvent.click(toggle);
    expect(api.readSafetyEpisodeInbox).not.toHaveBeenCalled();

    const splitWorkspace = await screen.findByTestId('frame-expanded-workspace');
    expect(splitWorkspace.firstElementChild?.className).toContain('lg:grid-cols-12');

    // Per-card repeated headcount disclaimer is collapsed inside <details> by default while header scope note stays visible
    expect(screen.getByTestId('frame-inbox-header-scope-note')).toBeTruthy();
    const perCardScopeNote = screen.getByTestId('frame-check-scope-note');
    expect(perCardScopeNote.closest('details')?.hasAttribute('open')).toBe(false);

    // Person 1 groups both PPE findings cleanly without redundant "Original person crop available" pill
    const row1 = await screen.findByTestId('frame-subject-row-1');
    expect(within(row1).getByTestId('frame-subject-ppe-count-1').textContent).toBe(
      '2 PPE findings',
    );
    const findingsList1 = await within(row1).findByTestId('frame-subject-findings-1');
    expect(within(findingsList1).getByText('Possible missing hard hat')).toBeTruthy();
    expect(within(findingsList1).getByText('Possible missing safety vest')).toBeTruthy();
    expect(row1.textContent).not.toContain('Original person crop available');
    expect(within(row1).getByTestId('frame-subject-identity-1').textContent).toBe(
      'Identity: Unconfirmed',
    );

    // Missing crop on Person 2 & unverified Zone check on Person 3 remain explicitly visible
    expect(screen.getByTestId('frame-subject-crop-missing-2')).toBeTruthy();
    expect(
      screen.getByTestId('frame-subject-row-3').querySelector('[data-zone-status="UNAVAILABLE"]'),
    ).toBeTruthy();

    // Owned FrameInbox DOM uses zero sub-12px (9px/10px/11px) Tailwind font-size classes inside expanded workspace
    expect(splitWorkspace.innerHTML).not.toMatch(/text-\[(?:9|10|11)px\]/);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('frame-summary-ppe-pill').textContent).toContain('3');
  });
});
