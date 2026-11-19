// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginResponse, SafetyFrameInboxPage } from '@smartsite/api-client';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { SafetyAlertsView } from '../alerts/SafetyAlertsView';
import { SafetyEpisodeWorkspace } from './SafetyEpisodeWorkspace';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockClient = vi.hoisted(() => ({
  listSites: vi.fn(),
  listCameras: vi.fn(),
  listPreviewCameras: vi.fn(),
  listSafetyAlerts: vi.fn(),
  listSafetyFrameInbox: vi.fn(),
  readSafetyEpisodeInbox: vi.fn(),
  getSafetyOverview: vi.fn(),
  listSafetyOverviewTeams: vi.fn(),
  listSafetyOverviewContractors: vi.fn(),
  listSafetyContractors: vi.fn(),
  getSafetyTeamOptions: vi.fn(),
  listSafetyChecklists: vi.fn(),
  listContractors: vi.fn(),
  listTeams: vi.fn(),
}));

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mockClient,
}));

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_LAPTOP = '22222222-2222-4222-8222-222222222201';
const CAM_GATE = '22222222-2222-4222-8222-222222222202';
const SHA = 'a'.repeat(64);

const officerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'token-officer-1',
  user: {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'demo.safety',
    displayName: 'Cán bộ an toàn demo',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
  },
};

function makeFrameItem(
  seq: number,
  capturedAt: string,
  options: {
    cameraId?: string;
    cameraName?: string;
    contentRevision?: number;
    findingCount?: number;
  } = {},
): SafetyFrameInboxPage['items'][number] {
  const {
    cameraId = CAM_LAPTOP,
    cameraName = 'Camera laptop demo',
    contentRevision = 1,
    findingCount = 1,
  } = options;
  return {
    siteId: SITE_ID,
    cameraId,
    frameKey: `event:00000000-0000-4000-8000-00000000010${seq}`,
    siteName: 'Công trường demo local',
    cameraName,
    capturedAt,
    unread: true,
    findingCount,
    cases: [
      {
        recipientId: `00000000-0000-4000-8000-00000000020${seq}`,
        episodeId: `00000000-0000-4000-8000-00000000030${seq}`,
        findingCount,
        unread: true,
        contentRevision,
        source: {
          alertId: `00000000-0000-4000-8000-00000000040${seq}`,
          eventId: `00000000-0000-4000-8000-00000000010${seq}`,
          personObservationIndex: 0,
          evidenceIndex: 0,
          sha256: SHA,
        },
        zoneEntries: [],
      },
    ],
  };
}

describe('Safety Operations & Frame Inbox full-width workspace, grouped segmented nav, and contract-strict frame triage', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'vi');
    await i18n.changeLanguage('vi');
    vi.resetAllMocks();

    mockClient.listSites.mockResolvedValue({
      items: [
        {
          id: SITE_ID,
          code: 'LOCAL-DEMO',
          name: 'Công trường demo local',
          createdAt: '2026-11-19T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    mockClient.listCameras.mockResolvedValue({ items: [], total: 0 });
    mockClient.listPreviewCameras.mockResolvedValue({ items: [], total: 0 });
    mockClient.listSafetyAlerts.mockResolvedValue({ items: [], total: 0 });
    mockClient.getSafetyOverview.mockResolvedValue({
      site: { id: SITE_ID, code: 'LOCAL-DEMO', name: 'Công trường demo local' },
      date: '2026-11-19',
      timezone: 'Asia/Saigon',
      teams: { items: [], total: 0 },
      unassignedWorkers: { items: [], total: 0 },
    });
    mockClient.listSafetyOverviewTeams.mockResolvedValue({ items: [], total: 0 });
    mockClient.listSafetyOverviewContractors.mockResolvedValue({ items: [], total: 0 });
    mockClient.listSafetyContractors.mockResolvedValue({ items: [], total: 0 });
    mockClient.getSafetyTeamOptions.mockResolvedValue({ items: [], total: 0 });
    mockClient.listSafetyChecklists.mockResolvedValue({ items: [], total: 0 });
    mockClient.listContractors.mockResolvedValue({ items: [], total: 0 });
    mockClient.listTeams.mockResolvedValue({ items: [], total: 0 });
    mockClient.readSafetyEpisodeInbox.mockResolvedValue({
      id: 'ok',
      contentRevision: 1,
      seenRevision: 1,
      unread: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('groups SafetyEpisodeWorkspace mode buttons into one segmented action cluster, expands SafetyAlertsView to full width, and hides duplicate Sign-out in authenticated shell mode', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/incidents']}>
          <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={officerSession}>
            <SafetyAlertsView
              apiUrl="http://api.invalid"
              authenticatedSession={officerSession}
              onSignOut={vi.fn()}
            />
          </SafetyEpisodeWorkspace>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const modeBar = await screen.findByTestId('safety-workspace-mode-bar');
    const actionCluster = within(modeBar).getByTestId('safety-workspace-mode-actions');
    const linksInCluster = within(actionCluster).getAllByRole('link');
    expect(linksInCluster.length).toBeGreaterThanOrEqual(2);

    const operationsRoot = await screen.findByTestId('safety-operations-fullwidth-root');
    expect(operationsRoot.className).toContain('w-full');
    expect(operationsRoot.className).not.toContain('max-w-[1202px]');
    expect(operationsRoot.className).not.toContain('mx-auto');

    // Duplicate inline Sign-out button must not appear when mounted with authenticatedSession inside AppLayout
    expect(screen.queryByRole('button', { name: /Đăng xuất|Sign out/i })).toBeNull();
  });

  it('never merges distinct frameKeys/technical segments by time proximity, presents contentRevision > 1 as an updated case, and acknowledges only the target frame revision', async () => {
    const closeFrames = [
      makeFrameItem(1, '2026-11-19T10:38:17.000Z', { contentRevision: 3, findingCount: 2 }),
      makeFrameItem(2, '2026-11-19T10:38:15.000Z'),
      makeFrameItem(3, '2026-11-19T10:38:13.000Z', {
        cameraId: CAM_GATE,
        cameraName: 'Camera cổng chính',
      }),
    ];
    mockClient.listSafetyFrameInbox.mockResolvedValue({
      items: closeFrames,
      total: closeFrames.length,
      unreadCount: closeFrames.length,
    } satisfies SafetyFrameInboxPage);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/incidents?tab=ppe-frames&siteId=${SITE_ID}`]}>
          <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={officerSession}>
            <div>Fallback</div>
          </SafetyEpisodeWorkspace>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // 3 distinct frameKeys (even 2s apart on same camera) MUST remain 3 separate articles so tracker loss is never hidden
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(3);
    });
    expect(screen.getAllByTestId('frame-triage-columns')).toHaveLength(3);

    // Frame 1 has contentRevision = 3 -> explicitly surfaces Updated Case indicator
    const firstArticle = screen.getAllByRole('article')[0]!;
    expect(within(firstArticle).getByTestId('frame-updated-cases-pill').textContent).toMatch(/1/);

    // Expand Frame 1 -> person row shows explicit revision #3 badge without auto-acknowledging
    fireEvent.click(within(firstArticle).getByTestId('frame-triage-columns'));
    const revisionBadge = await within(firstArticle).findByTestId('frame-subject-revision-1');
    expect(revisionBadge.textContent).toContain('#3');
    expect(mockClient.readSafetyEpisodeInbox).not.toHaveBeenCalled();

    // Mark Frame 1 read -> acknowledges ONLY Frame 1's recipient with displayed seenRevision = 3
    fireEvent.click(
      within(firstArticle).getByRole('button', { name: /Đánh dấu cả khung đã đọc|Mark frame as read/i }),
    );
    await waitFor(() => {
      expect(mockClient.readSafetyEpisodeInbox).toHaveBeenCalledTimes(1);
    });
    expect(mockClient.readSafetyEpisodeInbox).toHaveBeenCalledWith(
      'token-officer-1',
      '00000000-0000-4000-8000-000000000201',
      { seenRevision: 3 },
    );
  });

  it('keeps all permitted SafetyEpisodeWorkspace mode tabs in a stable segmented bar with aria-current="page" only on the active mode, and supports selective/page-scoped batch Mark-Read', async () => {
    const pageFrames = [
      makeFrameItem(1, '2026-11-19T10:40:10.000Z', { contentRevision: 4 }),
      makeFrameItem(2, '2026-11-19T10:40:05.000Z', { contentRevision: 2 }),
      makeFrameItem(3, '2026-11-19T10:40:00.000Z', { contentRevision: 1 }),
    ];
    mockClient.listSafetyFrameInbox.mockResolvedValue({
      items: pageFrames,
      total: 3,
      unreadCount: 3,
    } satisfies SafetyFrameInboxPage);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/incidents?siteId=${SITE_ID}`]}>
          <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={officerSession}>
            <SafetyAlertsView
              apiUrl="http://api.invalid"
              authenticatedSession={officerSession}
              onSignOut={vi.fn()}
            />
          </SafetyEpisodeWorkspace>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const actionCluster = within(await screen.findByTestId('safety-workspace-mode-bar')).getByTestId(
      'safety-workspace-mode-actions',
    );
    const opsLink = within(actionCluster).getByRole('link', { name: 'Xử lý an toàn' });
    const frameLink = within(actionCluster).getByRole('link', { name: 'Thông báo theo khung hình' });
    const episodeLink = within(actionCluster).getByRole('link', { name: 'Hồ sơ theo người' });
    expect(opsLink.getAttribute('aria-current')).toBe('page');
    expect(frameLink.getAttribute('aria-current')).toBeNull();
    expect(episodeLink.getAttribute('aria-current')).toBeNull();

    // Dead 0-0 pager must not render when Overview has 0 teams, and natural Vietnamese copy is rendered
    await screen.findByText(/Chưa có tổ đội nào được xếp lịch/i);
    expect(screen.queryByText(/0–0 trên 0|0-0 trên 0/)).toBeNull();

    // Switch to Frame Inbox -> Frame tab becomes active while Episode & Operations tabs stay visible in place!
    fireEvent.click(frameLink);
    await waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(3);
    });
    expect(
      within(screen.getByTestId('safety-workspace-mode-actions'))
        .getByRole('link', { name: 'Thông báo theo khung hình' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(screen.getByTestId('safety-workspace-mode-actions'))
        .getByRole('link', { name: 'Hồ sơ theo người' })
        .getAttribute('aria-current'),
    ).toBeNull();

    // Header title row and scope note must never be shrink-starved by the Tour invitation banner at 1440px
    const titleRow = screen.getByTestId('frame-inbox-title-row');
    expect(titleRow.className).toContain('min-w-[min(100%,20rem)]');
    expect(titleRow.className).toContain('flex-1');
    const scopeNote = screen.getByTestId('frame-inbox-header-scope-note');
    expect(scopeNote.className).toContain('w-full');

    // Select Frame 1 & Frame 2 checkboxes -> Batch Mark-Read acknowledges ONLY those 2 selected frames with their exact displayed revisions (4 and 2)
    const articles = screen.getAllByRole('article');
    fireEvent.click(within(articles[0]!).getByRole('checkbox'));
    fireEvent.click(within(articles[1]!).getByRole('checkbox'));
    const batchBtn = screen.getByTestId('frame-inbox-mark-visible-read');
    expect(batchBtn.textContent).toMatch(/2/);
    fireEvent.click(batchBtn);

    await waitFor(() => {
      expect(mockClient.readSafetyEpisodeInbox).toHaveBeenCalledTimes(2);
    });
    expect(mockClient.readSafetyEpisodeInbox).toHaveBeenCalledWith(
      'token-officer-1',
      '00000000-0000-4000-8000-000000000201',
      { seenRevision: 4 },
    );
    expect(mockClient.readSafetyEpisodeInbox).toHaveBeenCalledWith(
      'token-officer-1',
      '00000000-0000-4000-8000-000000000202',
      { seenRevision: 2 },
    );
  });
});
