// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyFrameInboxPage } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './components/safety-episodes/SafetyEpisodeWorkspace';
import { SAFETY_TOUR_STORAGE_KEY } from './components/safety/safetyTaskTourModel';
import { PpeInboxBellPreview } from './features/notifications/PpeInboxBellPreview';
import { usePpeFrameInboxPreview } from './features/notifications/usePpeFrameInboxPreview';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const CAM_GATE = '22222222-2222-4222-8222-222222222221';
const CAM_YARD = '22222222-2222-4222-8222-222222222222';
const FRAME_KEY = 'tracked:' + 'a'.repeat(64) + ':frame-17';
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

const session: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'test-token-only',
  user: {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }],
  },
};

function makeThreeSubjectFrame(): SafetyFrameInboxPage['items'][number] {
  return {
    siteId: SITE_A,
    cameraId: CAM_GATE,
    frameKey: FRAME_KEY,
    siteName: 'Site Alpha',
    cameraName: 'Gate Camera 01',
    capturedAt: '2026-11-15T09:30:00.000Z',
    unread: true,
    findingCount: 6,
    cases: [1, 2, 3].map((n) => ({
      recipientId: `00000000-0000-4000-8000-00000000000${n}`,
      episodeId: `00000000-0000-4000-8000-00000000001${n}`,
      findingCount: 2,
      unread: true,
      contentRevision: 1,
      source: {
        alertId: `00000000-0000-4000-8000-00000000010${n}`,
        eventId: '00000000-0000-4000-8000-000000000200',
        personObservationIndex: n - 1,
        evidenceIndex: 0,
        sha256: FRAME_SHA,
      },
      zoneEntries: [],
    })),
  };
}

function LocationEcho() {
  const location = useLocation();
  return <output data-testid="current-url">{`${location.pathname}${location.search}`}</output>;
}

function BellHarness({ onNavigate = () => undefined }: { onNavigate?: () => void }) {
  const query = usePpeFrameInboxPreview({
    apiUrl: 'http://api.invalid',
    token: session.accessToken,
    userId: session.user.id,
    siteIds: [SITE_A],
    enabled: true,
  });
  return <PpeInboxBellPreview query={query} siteIds={[SITE_A]} onNavigate={onNavigate} />;
}

let queryClient: QueryClient;

function mountWorkspace(
  initialPath: string,
  activeSession: Pick<LoginResponse, 'accessToken' | 'user'> = session,
) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationEcho />
        <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={activeSession}>
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
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://api.invalid/frame-jpeg');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  api.listSites.mockResolvedValue({
    items: [{ id: SITE_A, code: 'ALPHA', name: 'Site Alpha' }],
    total: 1,
  });
  api.listPreviewCameras.mockResolvedValue({
    items: [
      { id: CAM_GATE, name: 'Gate Camera 01' },
      { id: CAM_YARD, name: 'Yard Camera 02' },
    ],
    total: 2,
  });
  api.getTrackedEpisode.mockImplementation(
    async (_token: string, _siteId: string, episodeId: string) => ({
      episodeId,
      siteId: SITE_A,
      cameraId: CAM_GATE,
      subject: { kind: 'TRACKED', segmentId: `seg-${episodeId}`, scopeSha256: 'a'.repeat(64) },
      firstObservedAt: '2026-11-15T09:30:00.000Z',
      lastObservedAt: '2026-11-15T09:30:00.000Z',
      contentRevision: 1,
      collectionState: 'SEALED',
      findings: [
        {
          alertId: `${episodeId}-hat`,
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          status: 'PENDING_REVIEW',
          alertRevision: 0,
          zoneId: null,
          observationCount: 1,
        },
        {
          alertId: `${episodeId}-vest`,
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          status: 'PENDING_REVIEW',
          alertRevision: 0,
          zoneId: null,
          observationCount: 1,
        },
      ],
    }),
  );
  api.listTrackedEpisodeObservations.mockResolvedValue({
    episodeId: '00000000-0000-4000-8000-000000000011',
    contentRevision: 1,
    throughSequence: '1',
    offset: 0,
    limit: 20,
    total: 0,
    hasMore: false,
    items: [],
  });
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
  api.getTrackedObservationIdentity.mockRejectedValue(new ApiError('http', 'Not found', 404));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryClient?.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('grouped frame Inbox UX (v1.7 three-subject, six-finding contract)', () => {
  it('renders one grouped frame for three subjects with all six PPE findings and opens original JPEG via keyboard', async () => {
    const frame = makeThreeSubjectFrame();
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );

    const toggle = await screen.findByRole('button', {
      name: /3 people to review · 6 PPE findings/i,
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('article')).toHaveLength(1);

    for (const n of [1, 2, 3]) {
      const row = await screen.findByTestId(`frame-subject-row-${n}`);
      const list = await within(row).findByTestId(`frame-subject-findings-${n}`);
      expect(within(list).getByText('Possible missing hard hat')).toBeTruthy();
      expect(within(list).getByText('Possible missing safety vest')).toBeTruthy();
    }

    const openJpegBtn = await screen.findByTestId('open-original-frame-jpeg');
    openJpegBtn.focus();
    expect(document.activeElement).toBe(openJpegBtn);
    fireEvent.click(openJpegBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Original frame JPEG' });
    expect(within(dialog).getByTestId('original-frame-jpeg-modal-img').getAttribute('src')).toBe(
      'blob:http://api.invalid/frame-jpeg',
    );

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Original frame JPEG' })).toBeNull();
    expect(document.activeElement).toBe(openJpegBtn);
  });

  it('preserves selected site and camera when navigating to subject detail and returning to Inbox', async () => {
    const gateFrame = makeThreeSubjectFrame();
    const yardFrame: SafetyFrameInboxPage['items'][number] = {
      ...makeThreeSubjectFrame(),
      cameraId: CAM_YARD,
      cameraName: 'Yard Camera 02',
      frameKey: 'tracked:' + 'c'.repeat(64) + ':frame-99',
    };
    api.listSafetyFrameInbox.mockImplementation(
      async (_token: string, options?: { siteId?: string; cameraId?: string }) => {
        const allItems = [gateFrame, yardFrame].filter(
          (item) =>
            (!options?.siteId || item.siteId === options.siteId) &&
            (!options?.cameraId || item.cameraId === options.cameraId),
        );
        return {
          total: allItems.length,
          unreadCount: allItems.filter((item) => item.unread).length,
          items: allItems,
        };
      },
    );
    api.listSafetyEpisodeInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [
        {
          id: gateFrame.cases[0]!.recipientId,
          episode: {
            id: gateFrame.cases[0]!.episodeId,
            siteId: SITE_A,
            cameraId: CAM_GATE,
            subject: { kind: 'TRACKED', segmentId: 'seg-1', scopeSha256: 'a'.repeat(64) },
            configurationBundleId: null,
            firstObservedAt: gateFrame.capturedAt,
            lastObservedAt: gateFrame.capturedAt,
            contentRevision: 1,
            collectionState: 'SEALED',
            findingCount: 2,
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: gateFrame.capturedAt,
          updatedAt: gateFrame.capturedAt,
        },
      ],
    });

    mountWorkspace(`/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A })}`);

    const initialArticles = await screen.findAllByRole('article');
    expect(initialArticles).toHaveLength(2);
    expect(initialArticles[0]?.textContent).toContain('Gate Camera 01');
    expect(initialArticles[1]?.textContent).toContain('Yard Camera 02');

    const cameraSelect = screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;
    fireEvent.change(cameraSelect, { target: { value: CAM_GATE } });

    await waitFor(() =>
      expect(api.listSafetyFrameInbox.mock.calls.at(-1)?.[1]).toMatchObject({
        offset: 0,
        limit: 20,
        readStatus: 'ALL',
        siteId: SITE_A,
        cameraId: CAM_GATE,
      }),
    );
    const filteredArticles = await screen.findAllByRole('article');
    expect(filteredArticles).toHaveLength(1);
    expect(filteredArticles[0]?.textContent).toContain('Gate Camera 01');
    expect(filteredArticles[0]?.textContent).not.toContain('Yard Camera 02');

    fireEvent.click(screen.getByRole('button', { name: /3 people to review · 6 PPE findings/i }));
    const openCase = await screen.findByRole('link', { name: 'Open case for person 1' });
    fireEvent.click(openCase);

    expect(screen.getByTestId('current-url').textContent).toContain(`siteId=${SITE_A}`);
    expect(screen.getByTestId('current-url').textContent).toContain(`cameraId=${CAM_GATE}`);

    const backLink = await screen.findByRole('link', { name: 'Back to this frame' });
    fireEvent.click(backLink);

    const siteSelectAfter = (await screen.findByRole('combobox', {
      name: 'Site',
    })) as HTMLSelectElement;
    const cameraSelectAfter = screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;
    expect(siteSelectAfter.value).toBe(SITE_A);
    expect(cameraSelectAfter.value).toBe(CAM_GATE);
    expect(await screen.findByText('Filtered camera: Gate Camera 01')).toBeTruthy();

    const allFramesLink = screen.getByRole('link', { name: 'View all frames' });
    expect(
      Object.fromEntries(
        new URL(allFramesLink.getAttribute('href')!, 'http://x.test').searchParams,
      ),
    ).toEqual({
      tab: 'ppe-frames',
      siteId: SITE_A,
      cameraId: CAM_GATE,
    });
  });

  it('keeps Back to this frame accessible inside open FRAME evidence modal and unlocks page on return', async () => {
    const gateFrame = makeThreeSubjectFrame();
    const person1 = gateFrame.cases[0]!;
    api.listSafetyFrameInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [gateFrame],
    });
    api.listSafetyEpisodeInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [
        {
          id: person1.recipientId,
          episode: {
            id: person1.episodeId,
            siteId: SITE_A,
            cameraId: CAM_GATE,
            subject: { kind: 'TRACKED', segmentId: 'seg-1', scopeSha256: 'a'.repeat(64) },
            configurationBundleId: null,
            firstObservedAt: gateFrame.capturedAt,
            lastObservedAt: gateFrame.capturedAt,
            contentRevision: 1,
            collectionState: 'SEALED',
            findingCount: 2,
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: gateFrame.capturedAt,
          updatedAt: gateFrame.capturedAt,
        },
      ],
    });
    api.listTrackedEpisodeObservations.mockResolvedValue({
      episodeId: person1.episodeId,
      contentRevision: 1,
      throughSequence: '1',
      offset: 0,
      limit: 20,
      total: 1,
      hasMore: false,
      items: [
        {
          alertId: `${person1.episodeId}-hat`,
          eventId: '00000000-0000-4000-8000-000000000200',
          personObservationIndex: 0,
          payloadHash: 'd'.repeat(64),
          sourceSequence: '1',
          capturedAt: gateFrame.capturedAt,
          observationIndexes: [3],
          frames: [{ evidenceIndex: 0, sha256: FRAME_SHA }],
        },
      ],
    });

    mountWorkspace(
      `/incidents?${new URLSearchParams({
        tab: 'ppe-frames',
        siteId: SITE_A,
        cameraId: CAM_GATE,
        frameKey: FRAME_KEY,
      })}`,
    );

    const openCase = await screen.findByRole('link', { name: 'Open case for person 1' });
    fireEvent.click(openCase);

    const historyItem = await screen.findByTestId('tracked-history-item');
    fireEvent.click(within(historyItem).getByRole('button', { name: /Full FRAME #0/i }));

    const viewerImg = await screen.findByTestId('tracked-viewer-image');
    expect(viewerImg.getAttribute('src')).toBe('blob:http://api.invalid/frame-jpeg');

    const modalBackLink = screen.getByRole('link', { name: 'Back to this frame' });
    expect(modalBackLink.getAttribute('data-testid')).toBe('tracked-viewer-back-to-frame');
    modalBackLink.focus();
    expect(document.activeElement).toBe(modalBackLink);

    fireEvent.click(modalBackLink);

    expect(screen.queryByTestId('ppe-dialog-backdrop')).toBeNull();
    const siteSelectAfter = (await screen.findByRole('combobox', {
      name: 'Site',
    })) as HTMLSelectElement;
    const cameraSelectAfter = screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;
    expect(siteSelectAfter.value).toBe(SITE_A);
    expect(cameraSelectAfter.value).toBe(CAM_GATE);
    expect(screen.getByTestId('current-url').textContent).toContain(
      `frameKey=${encodeURIComponent(FRAME_KEY)}`,
    );
  });

  it('keeps PENDING zone assessment visibly distinct from confirmed DENIED in Bell and Inbox', async () => {
    const frame = makeThreeSubjectFrame();
    frame.cases[0]!.zoneEntries = [
      {
        requestId: '00000000-0000-4000-8000-000000000301',
        zoneId: 'z-1',
        status: 'PENDING',
        reasonCode: null,
        provenance: null,
      },
    ];
    frame.cases[1]!.zoneEntries = [
      {
        requestId: '00000000-0000-4000-8000-000000000302',
        zoneId: 'z-1',
        status: 'DENIED',
        reasonCode: 'ZONE_ENTRY_UNAUTHORIZED',
        provenance: 'TRUSTED_SERVICE',
      },
    ];
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BellHarness />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const bellItem = await screen.findByTestId('notification-bell-ppe-frame');
    expect(bellItem.textContent).toContain('1 denied Zone entry');
    expect(within(bellItem).getByTestId('bell-frame-zone-pending').textContent).toBe(
      '1 pending Zone assessment',
    );
    cleanup();
    queryClient.clear();

    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );

    expect((await screen.findByTestId('frame-pending-zone-summary')).textContent).toContain(
      '1 Zone check pending assessment (not denied)',
    );
    const row1 = await screen.findByTestId('frame-subject-row-1');
    const pendingChip = row1.querySelector('[data-zone-status="PENDING"]');
    expect(pendingChip).toBeTruthy();
    expect(pendingChip?.textContent).toContain('Pending assessment');
    expect(pendingChip?.textContent).toContain('Awaiting authorization check');

    const row2 = await screen.findByTestId('frame-subject-row-2');
    const deniedChip = row2.querySelector('[data-zone-status="DENIED"]');
    expect(deniedChip).toBeTruthy();
    expect(deniedChip?.textContent).toContain('Denied');
    expect(deniedChip?.textContent).toContain('Unauthorized presence in a restricted zone');
  });

  it('shows clear inline messages when frame evidence is missing or forbidden', async () => {
    const missingFrame = makeThreeSubjectFrame();
    missingFrame.cases = missingFrame.cases.map((entry) => ({ ...entry, source: null }));
    api.listSafetyFrameInbox.mockResolvedValueOnce({
      total: 1,
      unreadCount: 1,
      items: [missingFrame],
    });

    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );
    expect((await screen.findByTestId('frame-evidence-missing')).textContent).toContain(
      'Saved original frame evidence is missing for this frame.',
    );
    expect(screen.getByTestId('frame-subject-crop-missing-1').textContent).toContain(
      'Original person crop unavailable',
    );
    cleanup();
    queryClient.clear();

    api.listSafetyFrameInbox.mockResolvedValueOnce({
      total: 1,
      unreadCount: 1,
      items: [makeThreeSubjectFrame()],
    });
    api.readTrackedEpisodeMedia.mockRejectedValueOnce(new ApiError('http', 'Forbidden', 403));
    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );
    expect((await screen.findByTestId('frame-photo-unavailable')).textContent).toContain(
      'You do not have permission to view this saved evidence photo.',
    );
  });

  it('shows check-scope headcount note, neutral Identity: Unconfirmed pill, Manager C02 handoff cue, and human camera name on episode queue cards', async () => {
    const gateFrame = makeThreeSubjectFrame();
    const person1 = gateFrame.cases[0]!;
    api.listSafetyFrameInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [gateFrame],
    });
    api.listSafetyEpisodeInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [
        {
          id: person1.recipientId,
          episode: {
            id: person1.episodeId,
            siteId: SITE_A,
            cameraId: CAM_GATE,
            subject: { kind: 'TRACKED', segmentId: 'seg-1', scopeSha256: 'a'.repeat(64) },
            configurationBundleId: null,
            firstObservedAt: gateFrame.capturedAt,
            lastObservedAt: gateFrame.capturedAt,
            contentRevision: 1,
            collectionState: 'SEALED',
            findingCount: 2,
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: gateFrame.capturedAt,
          updatedAt: gateFrame.capturedAt,
        },
      ],
    });

    mountWorkspace(
      `/incidents?${new URLSearchParams({
        tab: 'ppe-frames',
        siteId: SITE_A,
        cameraId: CAM_GATE,
        frameKey: FRAME_KEY,
      })}`,
    );

    const scopeNote = (await screen.findByTestId('frame-check-scope-note')).textContent ?? '';
    expect(scopeNote).toContain('Counts reflect people with recorded checks in this frame only');
    expect(scopeNote).toMatch(/flagged cases, not current live person count/i);
    for (const n of [1, 2, 3]) {
      expect(screen.getByTestId(`frame-subject-identity-${n}`).textContent).toBe(
        'Identity: Unconfirmed',
      );
      expect(screen.getByTestId(`frame-subject-handoff-hint-${n}`).textContent).toContain(
        'request Site Manager identification when enabled',
      );
    }

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('frame-subject-identity-1').textContent).toBe(
      'Danh tính: Chưa xác nhận',
    );
    expect(screen.getByTestId('frame-check-scope-note').textContent).toContain(
      'số ca được gắn cờ, không phải số người trực tiếp hiện tại',
    );
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    fireEvent.click(screen.getByRole('link', { name: 'Open case for person 1' }));

    const episodeList = await screen.findByLabelText('Episode list');
    await screen.findByText(/Site Alpha · Gate Camera 01/);
    expect(episodeList.textContent).not.toContain(CAM_GATE);
  });

  it('renders inline per-person findings error (transient Retry vs non-retryable 403) and localizes real MF06 contract reasonCode values in EN and VI', async () => {
    const frame = makeThreeSubjectFrame();
    const person2EpisodeId = frame.cases[1]!.episodeId;
    const person3EpisodeId = frame.cases[2]!.episodeId;
    frame.cases[0]!.zoneEntries = [
      {
        requestId: '00000000-0000-4000-8000-000000000304',
        zoneId: 'z-1',
        status: 'DENIED',
        reasonCode: 'POLICY_PROHIBITED',
        provenance: 'TRUSTED_SERVICE',
      },
      {
        requestId: '00000000-0000-4000-8000-000000000305',
        zoneId: 'z-1b',
        status: 'DENIED',
        reasonCode: 'UNAUTHORIZED',
        provenance: 'TRUSTED_SERVICE',
      },
    ];
    frame.cases[2]!.zoneEntries = [
      {
        requestId: '00000000-0000-4000-8000-000000000303',
        zoneId: 'z-2',
        status: 'UNAVAILABLE',
        reasonCode: 'IDENTITY_UNAVAILABLE',
        provenance: 'UNAVAILABLE',
      },
      {
        requestId: '00000000-0000-4000-8000-000000000306',
        zoneId: 'z-3',
        status: 'UNAVAILABLE',
        reasonCode: 'AUTHORITY_UNAVAILABLE',
        provenance: 'UNAVAILABLE',
      },
    ];
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    let failPerson2 = true;
    const baseImpl = api.getTrackedEpisode.getMockImplementation()!;
    api.getTrackedEpisode.mockImplementation(
      async (token: string, siteId: string, episodeId: string) => {
        if (episodeId === person2EpisodeId && failPerson2) {
          throw new ApiError('network', 'Temporary episode detail failure');
        }
        if (episodeId === person3EpisodeId) {
          throw new ApiError('http', 'Forbidden', 403);
        }
        return baseImpl(token, siteId, episodeId);
      },
    );

    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );

    const row1 = await screen.findByTestId('frame-subject-row-1');
    expect(await within(row1).findByTestId('frame-subject-findings-1')).toBeTruthy();
    expect(row1.textContent).toContain('Entry prohibited by zone policy');
    expect(row1.textContent).toContain('No active zone authorization recorded');

    const row2 = await screen.findByTestId('frame-subject-row-2');
    const errorBox = await within(row2).findByTestId('frame-subject-findings-error-2');
    expect(errorBox.textContent).toContain('Could not load PPE findings for this person.');
    expect(within(errorBox).getByRole('button', { name: 'Retry' })).toBeTruthy();

    // Person 3 received 403 -> shows unavailable/denied message WITHOUT a Retry button
    const row3 = await screen.findByTestId('frame-subject-row-3');
    const forbiddenBox = await within(row3).findByTestId('frame-subject-findings-error-3');
    expect(forbiddenBox.textContent).toContain('Access denied or inbox unavailable.');
    expect(within(forbiddenBox).queryByRole('button', { name: 'Retry' })).toBeNull();

    const unavailableChips = row3.querySelectorAll('[data-zone-status="UNAVAILABLE"]');
    expect(unavailableChips).toHaveLength(2);
    expect(unavailableChips[0]?.textContent).toContain('Insufficient evidence');
    expect(unavailableChips[0]?.textContent).toContain(
      'Identity unverified (not a confirmed violation)',
    );
    expect(unavailableChips[1]?.textContent).toContain('Authorization service unavailable');

    // Switch to Vietnamese and assert real MF06 contract codes are localized (never English snake-case fallback)
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(row1.textContent).toContain('Khu vực cấm vào theo chính sách vùng');
    expect(row1.textContent).toContain('Không có quyền vào vùng hạn chế tại thời điểm ghi nhận');
    expect(row3.textContent).toContain('Chưa xác minh được danh tính (chưa kết luận vi phạm)');
    expect(row3.textContent).toContain('Dịch vụ kiểm tra phân quyền tạm thời không khả dụng');
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    failPerson2 = false;
    fireEvent.click(within(errorBox).getByRole('button', { name: 'Retry' }));
    expect(await within(row2).findByTestId('frame-subject-findings-2')).toBeTruthy();
    expect(within(row2).queryByTestId('frame-subject-findings-error-2')).toBeNull();
  });

  it('walks through all five rendered Frame Inbox tour anchors in EN/VI with keyboard Escape, Skip, Reset, and Done persistence', async () => {
    const frame = makeThreeSubjectFrame();
    frame.cases[0]!.zoneEntries = [
      {
        requestId: '00000000-0000-4000-8000-000000000401',
        zoneId: 'z-1',
        status: 'PENDING',
        reasonCode: null,
        provenance: null,
      },
      {
        requestId: '00000000-0000-4000-8000-000000000402',
        zoneId: 'z-2',
        status: 'DENIED',
        reasonCode: 'ZONE_ENTRY_UNAUTHORIZED',
        provenance: 'TRUSTED_SERVICE',
      },
    ];
    api.listSafetyFrameInbox.mockResolvedValue({ total: 1, unreadCount: 1, items: [frame] });

    mountWorkspace(
      `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A, frameKey: FRAME_KEY })}`,
    );

    await screen.findByTestId('frame-subject-row-1');
    const inviteStart = await screen.findByTestId('safety-task-tour-invitation-start');
    fireEvent.click(inviteStart);

    // Step 1: Site & Camera filters
    let tour = await screen.findByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-filters');
    expect(tour.textContent).toContain('Step 1 of 5');
    expect(tour.textContent).toContain('Site');
    expect(tour.textContent).toContain('Camera');
    expect(
      document
        .querySelector('[data-tour-anchor="frame-inbox-filters"]')
        ?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    // Step 2: One grouped frame vs per-person cases (affected-only count, never healthy-person total)
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-card-summary');
    expect(tour.textContent).toContain('Step 2 of 5');
    expect(tour.textContent).toMatch(/flagged cases/i);
    expect(tour.textContent).toMatch(/affected people with recorded checks/i);
    expect(tour.textContent).toMatch(/never a healthy-person total/i);
    expect(tour.textContent).toMatch(/current live person count/i);

    // Step 3: Shared original frame JPEG vs mechanical person crop + blocking modal Escape safety
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-media-evidence');
    expect(tour.textContent).toContain('Step 3 of 5');
    expect(tour.textContent).toMatch(/original frame JPEG/i);
    expect(tour.textContent).toMatch(/person crop/i);

    // Escape closes the open tour without storing completion/skip
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();

    // Opening Original frame JPEG modal isolates background (inert) and auto-closes tour cleanly without persisting progress
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    await screen.findByTestId('safety-task-tour');
    fireEvent.click(await screen.findByTestId('open-original-frame-jpeg'));
    await screen.findByRole('dialog', { name: 'Original frame JPEG' });
    await waitFor(() => expect(screen.queryByTestId('safety-task-tour')).toBeNull());
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: 'Original frame JPEG' })).toBeNull();

    // Reopen tour, step to Step 4 (Pending / Denied / Unknown) & verify VI localization
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    fireEvent.click(await screen.findByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-subject-status');
    expect(tour.textContent).toContain('Step 4 of 5');
    expect(tour.textContent).toMatch(/Unconfirmed \(Unknown\)/i);
    expect(tour.textContent).toMatch(/Pending assessment/i);
    expect(tour.textContent).toMatch(/Denied/i);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.textContent).toContain('Bước 4 / 5');
    expect(tour.textContent).toContain('Chưa xác nhận');
    expect(tour.textContent).toContain('Đang chờ đánh giá');
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Step 5: Open case, request Site Manager identification when enabled, and return via Back to this frame
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('frame-inbox-open-case');
    expect(tour.textContent).toContain('Step 5 of 5');
    expect(tour.textContent).toMatch(/Site Manager identification when enabled/i);
    expect(tour.textContent).toMatch(/Back to this frame/i);

    // Skip -> persists SKIPPED, shows Replay + Reset; Reset clears progress & restores invitation
    fireEvent.click(screen.getByTestId('safety-task-tour-skip'));
    const storageKey = `${session.user.id}:frame-inbox:v1`;
    expect(
      JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')[storageKey],
    ).toEqual({
      status: 'SKIPPED',
      tourVersion: 1,
    });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');
    fireEvent.click(screen.getByTestId('safety-task-tour-reset'));
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');
    expect(await screen.findByTestId('safety-task-tour-invitation')).toBeTruthy();

    // Complete -> persists COMPLETED
    fireEvent.click(screen.getByTestId('safety-task-tour-invitation-start'));
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    }
    fireEvent.click(screen.getByTestId('safety-task-tour-done'));
    expect(
      JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')[storageKey],
    ).toEqual({
      status: 'COMPLETED',
      tourVersion: 1,
    });
  });

  it('respects role, loading, error, empty, collapsed-vs-expanded targets, and filter-change resets', async () => {
    // 1. Denied role (SITE_MANAGER without SAFETY_OFFICER)
    const managerOnlySession: Pick<LoginResponse, 'accessToken' | 'user'> = {
      ...session,
      user: {
        ...session.user,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: SITE_A }],
      },
    };
    mountWorkspace(`/incidents?tab=ppe-frames&siteId=${SITE_A}`, managerOnlySession);
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    cleanup();
    queryClient.clear();

    // 2. Ungranted siteId param
    mountWorkspace(`/incidents?tab=ppe-frames&siteId=99999999-9999-4999-8999-999999999999`);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    cleanup();
    queryClient.clear();

    // 3. Loading state -> withheld until query resolves
    let resolveInbox!: (page: SafetyFrameInboxPage) => void;
    api.listSafetyFrameInbox.mockImplementationOnce(
      () =>
        new Promise<SafetyFrameInboxPage>((resolve) => {
          resolveInbox = resolve;
        }),
    );
    mountWorkspace(`/incidents?tab=ppe-frames&siteId=${SITE_A}`);
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();

    // 4. Empty state -> only rendered filter anchor is visited (Step 1 of 1)
    await act(async () => {
      resolveInbox({ total: 0, unreadCount: 0, items: [] });
    });
    const emptyTrigger = await screen.findByTestId('safety-task-tour-trigger');
    fireEvent.click(emptyTrigger);
    const emptyTour = await screen.findByTestId('safety-task-tour');
    expect(emptyTour.getAttribute('data-tour-step')).toBe('frame-inbox-filters');
    expect(emptyTour.textContent).toContain('Step 1 of 1');
    expect(screen.getByTestId('safety-task-tour-done')).toBeTruthy();
    cleanup();
    queryClient.clear();

    // 5. Hard error state -> tour withheld
    api.listSafetyFrameInbox.mockRejectedValueOnce(new ApiError('http', 'Server error', 500));
    mountWorkspace(`/incidents?tab=ppe-frames&siteId=${SITE_A}`);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    cleanup();
    queryClient.clear();

    // 6. Collapsed cards -> 2 rendered steps; expanding card -> 5 rendered steps; changing camera filter resets open tour
    const gateFrame = makeThreeSubjectFrame();
    const yardFrame: SafetyFrameInboxPage['items'][number] = {
      ...makeThreeSubjectFrame(),
      cameraId: CAM_YARD,
      cameraName: 'Yard Camera 02',
      frameKey: 'tracked:' + 'e'.repeat(64) + ':frame-88',
    };
    api.listSafetyFrameInbox.mockImplementation(
      async (_token: string, options?: { siteId?: string; cameraId?: string }) => {
        const allItems = [gateFrame, yardFrame].filter(
          (item) =>
            (!options?.siteId || item.siteId === options.siteId) &&
            (!options?.cameraId || item.cameraId === options.cameraId),
        );
        return {
          total: allItems.length,
          unreadCount: allItems.filter((item) => item.unread).length,
          items: allItems,
        };
      },
    );
    mountWorkspace(`/incidents?tab=ppe-frames&siteId=${SITE_A}`);
    await screen.findAllByRole('article');

    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect((await screen.findByTestId('safety-task-tour')).textContent).toContain('Step 1 of 2');
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'frame-inbox-card-summary',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 2');

    // Expand first frame card -> MutationObserver exposes steps 3..5 dynamically
    const cardButtons = screen.getAllByRole('button', {
      name: /3 people to review · 6 PPE findings/i,
    });
    fireEvent.click(cardButtons[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 5'),
    );

    // Changing camera filter updates scopeKey and closes the active tour
    const cameraSelect = screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;
    fireEvent.change(cameraSelect, { target: { value: CAM_GATE } });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });
});
