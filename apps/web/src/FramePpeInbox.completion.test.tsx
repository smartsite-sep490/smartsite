// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyFrameInboxPage } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './components/safety-episodes/SafetyEpisodeWorkspace';
import { SafetyTaskTour } from './components/safety/SafetyTaskTour';
import type { SafetyTourStepSpec } from './components/safety/safetyTaskTourModel';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '11111111-1111-4111-8111-111111111112';
const CAM_GATE_A = '22222222-2222-4222-8222-222222222221';
const CAM_GATE_B = '22222222-2222-4222-8222-222222222222';
const FRAME_KEY = 'tracked:' + 'a'.repeat(64) + ':frame-42';
const FRAME_SHA = 'b'.repeat(64);

const api = vi.hoisted(() => ({
  listSites: vi.fn(),
  listPreviewCameras: vi.fn(),
  listSafetyFrameInbox: vi.fn(),
  listSafetyEpisodeInbox: vi.fn(),
  getTrackedEpisode: vi.fn(),
  getSafetyEpisode: vi.fn(),
  listTrackedEpisodeObservations: vi.fn(),
  readTrackedEpisodeMedia: vi.fn(),
  getTrackedObservationIdentity: vi.fn(),
  readSafetyEpisodeInbox: vi.fn(),
}));

vi.mock('./features/auth/auth-session', () => ({
  useManagementClient: () => api,
}));

const multiSiteSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'test-token-completion',
  user: {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      { role: 'SAFETY_OFFICER', siteId: SITE_A },
      { role: 'SAFETY_OFFICER', siteId: SITE_B },
    ],
  },
};

function makeMixedThreeSubjectFrame(): SafetyFrameInboxPage['items'][number] {
  return {
    siteId: SITE_A,
    cameraId: CAM_GATE_A,
    frameKey: FRAME_KEY,
    siteName: 'Site Alpha',
    cameraName: 'Gate Camera',
    capturedAt: '2026-11-18T04:00:00.000Z',
    unread: true,
    // findingCount counts PPE ONLY (2 on Person 1 + 1 on Person 2 + 0 on Person 3 = 3)
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
            zoneId: 'z-1',
            status: 'PENDING',
            reasonCode: null,
            provenance: null,
          },
        ],
      },
      {
        recipientId: '00000000-0000-4000-8000-000000000002',
        episodeId: '00000000-0000-4000-8000-000000000012',
        findingCount: 1,
        unread: true,
        contentRevision: 2,
        source: {
          alertId: '00000000-0000-4000-8000-000000000102',
          eventId: '00000000-0000-4000-8000-000000000200',
          personObservationIndex: 1,
          evidenceIndex: 0,
          sha256: FRAME_SHA,
        },
        zoneEntries: [
          {
            requestId: '00000000-0000-4000-8000-000000000302',
            zoneId: 'z-2',
            status: 'DENIED',
            reasonCode: 'UNAUTHORIZED',
            provenance: 'TRUSTED_SERVICE',
          },
        ],
      },
      {
        recipientId: '00000000-0000-4000-8000-000000000003',
        episodeId: '00000000-0000-4000-8000-000000000013',
        findingCount: 0,
        unread: true,
        contentRevision: 1,
        source: {
          alertId: '00000000-0000-4000-8000-000000000103',
          eventId: '00000000-0000-4000-8000-000000000200',
          personObservationIndex: 2,
          evidenceIndex: 0,
          sha256: FRAME_SHA,
        },
        zoneEntries: [
          {
            requestId: '00000000-0000-4000-8000-000000000303',
            zoneId: 'z-3',
            status: 'UNAVAILABLE',
            reasonCode: 'IDENTITY_UNAVAILABLE',
            provenance: 'UNAVAILABLE',
          },
        ],
      },
    ],
  };
}

let queryClient: QueryClient;

function mountInbox(initialPath: string) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={multiSiteSession}>
          <div>Legacy incidents</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.resetAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  let blobSeq = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(
    () => `blob:http://api.invalid/media-${++blobSeq}`,
  );
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  api.listSites.mockResolvedValue({
    items: [
      { id: SITE_A, code: 'ALPHA', name: 'Site Alpha' },
      { id: SITE_B, code: 'BETA', name: 'Site Beta' },
    ],
    total: 2,
  });
  api.listPreviewCameras.mockResolvedValue({ items: [], total: 0 });
  api.getTrackedEpisode.mockImplementation(
    async (_token: string, _siteId: string, episodeId: string) => {
      if (episodeId.endsWith('11')) {
        return {
          findings: [
            {
              alertId: 'a-hat-1',
              alertType: 'PPE_VIOLATION',
              candidateSubtype: 'PPE_HARD_HAT_MISSING',
              status: 'PENDING_REVIEW',
            },
            {
              alertId: 'a-vest-1',
              alertType: 'PPE_VIOLATION',
              candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
              status: 'PENDING_REVIEW',
            },
          ],
        };
      }
      // Person 2 episode detail includes BOTH a PPE_VIOLATION and a RESTRICTED_ZONE_INTRUSION;
      // FrameInboxSubjectRow must show PPE_VIOLATION ONLY under PPE findings!
      return {
        findings: [
          {
            alertId: 'a-vest-2',
            alertType: 'PPE_VIOLATION',
            candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
            status: 'PENDING_REVIEW',
          },
          {
            alertId: 'a-zone-2',
            alertType: 'RESTRICTED_ZONE_INTRUSION',
            candidateSubtype: 'ZONE_ENTRY_UNAUTHORIZED',
            status: 'PENDING_REVIEW',
          },
        ],
      };
    },
  );
  api.readTrackedEpisodeMedia.mockImplementation(
    async (
      _token: string,
      _siteId: string,
      _episodeId: string,
      _source: unknown,
      representation: 'FRAME' | 'SUBJECT',
    ) => ({
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      sha256: FRAME_SHA,
      frameSha256: FRAME_SHA,
      representation,
    }),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryClient?.clear();
  vi.restoreAllMocks();
});

describe('Grouped Frame Inbox subject/PPE/Zone separation, evidence binding, 401/403/404 purge, and tour hygiene', () => {
  it('separates affected subject count from PPE-only findings and Zone assessments, labels Whole frame vs Person crop, binds crop strictly to selected person, and never marks read on expand', async () => {
    const frame = makeMixedThreeSubjectFrame();
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    mountInbox(`/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A })}`);

    // Header scope note is visible even before expanding any card
    expect((await screen.findByTestId('frame-inbox-header-scope-note')).textContent).toMatch(
      /flagged cases|recorded checks/i,
    );

    // Collapsed card shows 3 subjects, 3 PPE findings, 1 denied Zone, 1 pending Zone, AND 1 unavailable/unverified Zone check
    const cardToggle = await screen.findByRole('button', {
      name: /3 people to review · 3 PPE findings · 1 denied Zone entry/i,
    });
    expect(screen.getByTestId('frame-pending-zone-summary')).toBeTruthy();
    expect(screen.getByTestId('frame-unavailable-zone-summary')).toBeTruthy();

    // Expanding card NEVER acknowledges/marks read automatically
    fireEvent.click(cardToggle);
    expect(api.readSafetyEpisodeInbox).not.toHaveBeenCalled();

    // Whole-frame evidence is explicitly labeled Whole frame
    expect((await screen.findByTestId('frame-whole-frame-badge')).textContent).toBe('Whole frame');

    // Person 2 PPE findings list excludes RESTRICTED_ZONE_INTRUSION so PPE count (1) matches PPE pills (1)
    const row2 = await screen.findByTestId('frame-subject-row-2');
    const ppeList2 = await within(row2).findByTestId('frame-subject-findings-2');
    expect(within(ppeList2).getAllByRole('listitem')).toHaveLength(1);
    expect(ppeList2.textContent).toContain('Possible missing safety vest');
    expect(ppeList2.textContent).not.toContain('Unauthorized presence');

    // Person 3 has 0 PPE findings and UNAVAILABLE zone check, no fabricated crowd denominator (10)
    const row3 = await screen.findByTestId('frame-subject-row-3');
    expect(row3.textContent).toContain('No PPE findings in this frame');
    expect(row3.querySelector('[data-zone-status="UNAVAILABLE"]')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/of 10\b|\/ 10\b/);

    // Viewing Person 2 crop requests SUBJECT strictly for Person 2's episodeId and personObservationIndex=1
    api.readTrackedEpisodeMedia.mockClear();
    fireEvent.click(within(row2).getByRole('button', { name: 'Show evidence for person 2' }));
    expect((await within(row2).findByTestId('subject-person-crop-badge-2')).textContent).toContain(
      'Person crop · Person 2',
    );
    expect(api.readTrackedEpisodeMedia).toHaveBeenCalledTimes(1);
    expect(api.readTrackedEpisodeMedia).toHaveBeenCalledWith(
      'test-token-completion',
      SITE_A,
      '00000000-0000-4000-8000-000000000012',
      expect.objectContaining({
        alertId: '00000000-0000-4000-8000-000000000102',
        personObservationIndex: 1,
      }),
      'SUBJECT',
      FRAME_SHA,
      expect.anything(),
    );
    expect(api.readSafetyEpisodeInbox).not.toHaveBeenCalled();
  });

  it('purges blob URLs and subject findings on 403/404 refetch and disambiguates multi-site camera options', async () => {
    const frameA = makeMixedThreeSubjectFrame();
    const frameB: SafetyFrameInboxPage['items'][number] = {
      ...makeMixedThreeSubjectFrame(),
      siteId: SITE_B,
      siteName: 'Site Beta',
      cameraId: CAM_GATE_B,
      cameraName: 'Gate Camera',
      frameKey: 'tracked:' + 'c'.repeat(64) + ':frame-99',
    };
    api.listSafetyFrameInbox.mockResolvedValue({
      total: 2,
      unreadCount: 2,
      items: [frameA, frameB],
    });

    mountInbox(`/incidents?${new URLSearchParams({ tab: 'ppe-frames', frameKey: FRAME_KEY })}`);

    // Multi-site (ALL) mode disambiguates duplicate camera names with site name
    const cameraSelect = (await screen.findByRole('combobox', {
      name: 'Camera',
    })) as HTMLSelectElement;
    await waitFor(() => {
      const optionLabels = Array.from(cameraSelect.options).map((o) => o.textContent);
      expect(optionLabels).toContain('Site Alpha · Gate Camera');
      expect(optionLabels).toContain('Site Beta · Gate Camera');
    });

    // Wait for initial whole-frame image and Person 1 findings to render
    await screen.findByTestId('open-original-frame-jpeg');
    const row1 = await screen.findByTestId('frame-subject-row-1');
    expect(await within(row1).findByTestId('frame-subject-findings-1')).toBeTruthy();

    // Refetch media with 404 and findings with 403 -> blob URL revoked and stale findings hidden
    api.readTrackedEpisodeMedia.mockRejectedValue(new ApiError('http', 'Not found', 404));
    api.getTrackedEpisode.mockRejectedValue(new ApiError('http', 'Forbidden', 403));

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['frame-photo'] });
      await queryClient.refetchQueries({ queryKey: ['frame-subject-findings'] });
    });

    await waitFor(() => expect(screen.getByTestId('frame-photo-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('open-original-frame-jpeg')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://api.invalid/media-1');
    expect(within(row1).queryByTestId('frame-subject-findings-1')).toBeNull();
    expect(within(row1).getByTestId('frame-subject-findings-error-1').textContent).toContain(
      'Access denied or inbox unavailable.',
    );
  });

  it('skips anchors inside closed <details>, supports ArrowRight/ArrowLeft keyboard navigation, and avoids implementation jargon in tour copy', async () => {
    const frame = makeMixedThreeSubjectFrame();
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    mountInbox(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );
    await screen.findByTestId('frame-subject-row-1');

    fireEvent.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    let tour = await screen.findByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-filters');

    // Keyboard ArrowRight advances steps; ArrowLeft goes back; never marks read
    fireEvent.keyDown(tour, { key: 'ArrowRight' });
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'frame-inbox-card-summary',
    );
    fireEvent.keyDown(screen.getByTestId('safety-task-tour'), { key: 'ArrowRight' });
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-media-evidence');
    expect(tour.textContent).not.toMatch(/mechanical/i);

    fireEvent.keyDown(tour, { key: 'ArrowRight' });
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-subject-status');
    expect(tour.textContent).not.toMatch(/fail-closed/i);

    fireEvent.keyDown(tour, { key: 'ArrowLeft' });
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'frame-inbox-media-evidence',
    );
    expect(api.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    cleanup();

    // Closed <details> anchor must not be treated as visible by SafetyTaskTour
    const closedDetailsSteps: readonly SafetyTourStepSpec[] = [
      {
        id: 'inside-closed-details',
        anchorSelector: '[data-tour-anchor="hidden-in-details"]',
        titleKey: 'tour.frameInbox.filters.title',
        bodyKey: 'tour.frameInbox.filters.body',
      },
      {
        id: 'visible-outside',
        anchorSelector: '[data-tour-anchor="visible-outside"]',
        titleKey: 'tour.frameInbox.frameSummary.title',
        bodyKey: 'tour.frameInbox.frameSummary.body',
      },
    ];
    render(
      <div>
        <details>
          <summary>More</summary>
          <div data-tour-anchor="hidden-in-details">Diagnostic</div>
        </details>
        <button type="button" data-tour-anchor="visible-outside">
          Visible control
        </button>
        <SafetyTaskTour
          taskId="frame-inbox"
          tourVersion={1}
          userId="officer-test"
          scopeKey="details-test"
          steps={closedDetailsSteps}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    const detailsTour = await screen.findByTestId('safety-task-tour');
    expect(detailsTour.getAttribute('data-tour-step')).toBe('visible-outside');
    expect(detailsTour.textContent).toContain('Step 1 of 1');
  });
});
