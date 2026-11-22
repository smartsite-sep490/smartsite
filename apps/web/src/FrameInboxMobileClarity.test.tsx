// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyFrameInboxPage } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './components/safety-episodes/SafetyEpisodeWorkspace';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const CAM_A = '22222222-2222-4222-8222-222222222221';
const CAM_B = '22222222-2222-4222-8222-222222222222';
const FRAME_SHA = 'c'.repeat(64);
const LONG_SITE_NAME =
  'North Harbor Petrochemical Wharf Construction Complex — Phase 3 Heavy Lifting Sector';
const LONG_CAMERA_NAME =
  'East Tower Crane Boom Overhang Inspection Camera 04 — High-Voltage Restricted Perimeter';

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
  accessToken: 'tok-mobile-clarity',
  user: {
    id: '00000000-0000-4000-8000-000000000088',
    username: 'safety.mobile',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }],
  },
};

function makeFrame(
  seq: number,
  options: {
    cameraId?: string;
    cameraName?: string;
    siteName?: string;
    subjectCount?: number;
    contentRevision?: number;
  } = {},
): SafetyFrameInboxPage['items'][number] {
  const {
    cameraId = CAM_A,
    cameraName = LONG_CAMERA_NAME,
    siteName = LONG_SITE_NAME,
    subjectCount = 3,
    contentRevision = 2,
  } = options;
  return {
    siteId: SITE_A,
    cameraId,
    frameKey: `tracked:${'d'.repeat(64)}:frame-${seq}`,
    siteName,
    cameraName,
    capturedAt: `2026-11-22T09:${String(10 + seq).padStart(2, '0')}:00.000Z`,
    unread: true,
    findingCount: subjectCount * 2,
    cases: Array.from({ length: subjectCount }, (_, idx) => ({
      recipientId: `00000000-0000-4000-8000-${String(seq * 10 + idx + 1).padStart(12, '0')}`,
      episodeId: `00000000-0000-4000-9000-${String(seq * 10 + idx + 1).padStart(12, '0')}`,
      findingCount: 2,
      unread: true,
      contentRevision: contentRevision + idx,
      source: {
        alertId: `00000000-0000-4000-7000-${String(seq * 10 + idx + 1).padStart(12, '0')}`,
        eventId: '00000000-0000-4000-8000-000000000200',
        personObservationIndex: idx,
        evidenceIndex: 0,
        sha256: FRAME_SHA,
      },
      zoneEntries:
        idx === 0
          ? [
              {
                requestId: `00000000-0000-4000-6000-${String(seq * 10 + 1).padStart(12, '0')}`,
                zoneId: '44444444-4444-4444-8444-444444444401',
                status: 'DENIED',
                reasonCode: 'POLICY_PROHIBITED',
                provenance: 'TRUSTED_SERVICE',
              },
            ]
          : [],
    })),
  };
}

let queryClient: QueryClient;

function mountAt(path: string) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={officerSession}>
          <div>Legacy safety workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.resetAllMocks();
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://api.invalid/frame');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  api.listSites.mockResolvedValue({
    items: [{ id: SITE_A, code: 'WHARF-3', name: LONG_SITE_NAME }],
    total: 1,
  });
  api.listPreviewCameras.mockResolvedValue({
    items: [
      { id: CAM_A, name: LONG_CAMERA_NAME },
      { id: CAM_B, name: 'South Gate Camera 02' },
    ],
    total: 2,
  });
  api.listSafetyFrameInbox.mockResolvedValue({
    total: 2,
    unreadCount: 2,
    items: [
      makeFrame(1),
      makeFrame(2, { cameraId: CAM_A, cameraName: LONG_CAMERA_NAME, subjectCount: 1 }),
    ],
  });
  api.getTrackedEpisode.mockResolvedValue({
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
  });
  api.readTrackedEpisodeMedia.mockResolvedValue({
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
    sha256: FRAME_SHA,
    frameSha256: FRAME_SHA,
    representation: 'FRAME',
  });
  api.readSafetyEpisodeInbox.mockResolvedValue({
    id: 'ok',
    contentRevision: 2,
    seenRevision: 2,
    unread: false,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryClient?.clear();
  vi.restoreAllMocks();
});

describe('Grouped Frame Inbox mobile hierarchy, progressive disclosure, and contextual bulk controls', () => {
  it('keeps single-row mobile navigation, progressively discloses scope help & filter selects, keeps active long filters visible, and shows mobile bulk controls contextually on selection', async () => {
    mountAt(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, cameraId: CAM_A })}`,
    );

    const articles = await screen.findAllByRole('article');
    expect(articles).toHaveLength(2);

    // 1. Mode bar uses single-row horizontal scroll on mobile instead of multi-row wrap, and keeps active aria-current
    const modeActions = screen.getByTestId('safety-workspace-mode-actions');
    expect(modeActions.className).toContain('flex-nowrap');
    expect(modeActions.className).toContain('overflow-x-auto');
    expect(modeActions.className).toContain('sm:flex-wrap');
    const frameLink = within(modeActions).getByRole('link', { name: 'Frame notifications' });
    expect(frameLink.getAttribute('aria-current')).toBe('page');
    expect(frameLink.className).toContain('shrink-0');

    // 2. Scope help note is progressively disclosed on mobile while staying visible on desktop (sm:block) with w-full
    const helpToggle = screen.getByTestId('frame-inbox-scope-help-toggle');
    expect(helpToggle.getAttribute('aria-expanded')).toBe('false');
    const scopeNote = screen.getByTestId('frame-inbox-header-scope-note');
    expect(scopeNote.className).toContain('w-full');
    expect(scopeNote.className).toContain('hidden');
    expect(scopeNote.className).toContain('sm:block');

    fireEvent.click(helpToggle);
    expect(helpToggle.getAttribute('aria-expanded')).toBe('true');
    expect(scopeNote.className).not.toContain('hidden');

    // 3. Site & Camera selects are collapsed behind a labelled toggle on mobile, while active long filter chips + Clear actions stay visible outside it
    const filterToggle = screen.getByTestId('frame-inbox-mobile-filter-toggle');
    const filterControls = screen.getByTestId('frame-inbox-filter-controls');
    expect(filterToggle.getAttribute('aria-expanded')).toBe('false');
    expect(filterControls.className).toContain('hidden');
    expect(filterControls.className).toContain('sm:grid');

    const activeSiteBadge = await screen.findByText(`Filtered site: ${LONG_SITE_NAME}`);
    const activeCameraBadge = await screen.findByText(`Filtered camera: ${LONG_CAMERA_NAME}`);
    expect(filterControls.contains(activeSiteBadge)).toBe(false);
    expect(filterControls.contains(activeCameraBadge)).toBe(false);
    expect(activeSiteBadge.getAttribute('title')).toContain(LONG_SITE_NAME);
    expect(activeCameraBadge.getAttribute('title')).toContain(LONG_CAMERA_NAME);
    expect(screen.getByRole('button', { name: 'Clear site filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear camera filter' })).toBeTruthy();

    fireEvent.click(filterToggle);
    expect(filterToggle.getAttribute('aria-expanded')).toBe('true');
    expect(filterControls.className).not.toContain('hidden');

    // 4. Bulk bar is hidden on mobile (< lg) when nothing is selected, then appears contextually on selection and sends exact per-recipient seenRevision
    const batchBarBefore = screen.getByTestId('frame-inbox-batch-bar');
    expect(batchBarBefore.className).toContain('hidden');
    expect(batchBarBefore.className).toContain('lg:block');

    fireEvent.click(within(articles[0]!).getByRole('checkbox'));
    const activeBatchBar = screen.getByTestId('frame-inbox-batch-bar');
    expect(activeBatchBar.className).not.toContain('hidden');
    expect(activeBatchBar.textContent).toContain('1 frame selected');

    fireEvent.click(screen.getByTestId('frame-inbox-mark-visible-read'));
    await waitFor(() => {
      expect(api.readSafetyEpisodeInbox).toHaveBeenCalledTimes(3);
    });
    expect(api.readSafetyEpisodeInbox.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['00000000-0000-4000-8000-000000000011', { seenRevision: 2 }],
      ['00000000-0000-4000-8000-000000000012', { seenRevision: 3 }],
      ['00000000-0000-4000-8000-000000000013', { seenRevision: 4 }],
    ]);

    // 5. Expanding a 3-subject frame keeps unknown identity and never triggers read mutation
    api.readSafetyEpisodeInbox.mockClear();
    fireEvent.click(within(articles[0]!).getByTestId('frame-triage-columns'));
    expect(api.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    for (const n of [1, 2, 3]) {
      const subjectRow = await screen.findByTestId(`frame-subject-row-${n}`);
      expect(within(subjectRow).getByTestId(`frame-subject-identity-${n}`).textContent).toBe(
        'Identity: Unconfirmed',
      );
    }

    // 6. Localized Vietnamese copy works cleanly for new progressive disclosure labels
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('frame-inbox-mobile-filter-toggle').textContent).toContain(
      'Ẩn bộ lọc',
    );
    expect(screen.getByTestId('frame-inbox-scope-help-toggle').textContent).toContain('Phạm vi');
  });

  it('never hides site or camera loading errors even while mobile filter selects remain collapsed', async () => {
    api.listSites.mockRejectedValue(new ApiError('network', 'Transient site fetch error'));
    mountAt(`/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A })}`);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Retry');
    const filterControls = screen.getByTestId('frame-inbox-filter-controls');
    expect(filterControls.className).toContain('hidden');
    expect(filterControls.contains(alert)).toBe(false);
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
