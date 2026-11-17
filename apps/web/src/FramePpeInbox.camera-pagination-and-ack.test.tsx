// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LoginResponse,
  SafetyFrameInboxOptions,
  SafetyFrameInboxPage,
} from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './components/safety-episodes/SafetyEpisodeWorkspace';
import i18n from './i18n';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const CAM_GATE = '22222222-2222-4222-8222-222222222221';
const CAM_YARD = '22222222-2222-4222-8222-222222222222';
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

const officerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'test-token-camera-paging',
  user: {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_A }],
  },
};

function makeFrame(
  cameraId: string,
  cameraName: string,
  index: number,
  unreadStates: readonly boolean[] = [true, true, true],
): SafetyFrameInboxPage['items'][number] {
  return {
    siteId: SITE_A,
    cameraId,
    frameKey: `tracked:${'a'.repeat(64)}:frame-${cameraId.slice(-2)}-${index}`,
    siteName: 'Site Alpha',
    cameraName,
    capturedAt: `2026-11-15T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
    unread: unreadStates.some(Boolean),
    findingCount: unreadStates.length * 2,
    cases: unreadStates.map((isUnread, idx) => ({
      recipientId: `00000000-0000-4000-8000-${String(index * 10 + idx + 1).padStart(12, '0')}`,
      episodeId: `00000000-0000-4000-9000-${String(index * 10 + idx + 1).padStart(12, '0')}`,
      findingCount: 2,
      unread: isUnread,
      contentRevision: idx + 1,
      source: {
        alertId: `00000000-0000-4000-7000-${String(index * 10 + idx + 1).padStart(12, '0')}`,
        eventId: '00000000-0000-4000-8000-000000000200',
        personObservationIndex: idx,
        evidenceIndex: 0,
        sha256: FRAME_SHA,
      },
      zoneEntries: [],
    })),
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
        <SafetyEpisodeWorkspace apiUrl="http://api.invalid" session={officerSession}>
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
  api.getTrackedEpisode.mockResolvedValue({ findings: [] });
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
  queryClient?.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FramePpeInbox server-side cameraId pagination & per-case revision ACK', () => {
  it('sends selected cameraId to Backend BEFORE pagination, advances paged offsets in camera scope, binds queryKey, and sanitizes invalid cameraId params', async () => {
    // 20 newer Yard frames would push Gate frames out of unfiltered page 1 if filtering were client-only.
    const yardFrames = Array.from({ length: 20 }, (_, i) =>
      makeFrame(CAM_YARD, 'Yard Camera 02', i + 1, [true]),
    );
    const gateFrames = Array.from({ length: 25 }, (_, i) =>
      makeFrame(CAM_GATE, 'Gate Camera 01', i + 30, [i < 3]),
    );
    const allServerFrames = [...yardFrames, ...gateFrames];

    api.listSafetyFrameInbox.mockImplementation(
      async (_token: string, options?: SafetyFrameInboxOptions): Promise<SafetyFrameInboxPage> => {
        const scoped = allServerFrames.filter(
          (item) =>
            (!options?.siteId || item.siteId === options.siteId) &&
            (!options?.cameraId || item.cameraId === options.cameraId) &&
            (options?.readStatus !== 'UNREAD' || item.unread),
        );
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? 20;
        return {
          total: scoped.length,
          unreadCount: scoped.filter((item) => item.unread).length,
          items: scoped.slice(offset, offset + limit),
        };
      },
    );

    mountInbox(`/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId: SITE_A })}`);

    await screen.findAllByRole('article');
    expect(screen.getByText('23 unread frames')).toBeTruthy();
    expect(api.listSafetyFrameInbox.mock.calls.at(-1)?.[1]).toMatchObject({
      offset: 0,
      limit: 20,
      readStatus: 'ALL',
      siteId: SITE_A,
      cameraId: undefined,
    });

    // Select Gate Camera 01 -> must query server with cameraId BEFORE pagination!
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

    expect(await screen.findByText('3 unread frames')).toBeTruthy();
    const page1GateArticles = await screen.findAllByRole('article');
    expect(page1GateArticles).toHaveLength(20);
    expect(page1GateArticles[0]?.textContent).toContain('Gate Camera 01');
    expect(page1GateArticles[0]?.textContent).not.toContain('Yard Camera 02');

    // Verify TanStack Query key binds selected cameraId scope
    const frameQueryKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.queryKey)
      .filter((key) => Array.isArray(key) && key[0] === 'frame-ppe-inbox');
    expect(frameQueryKeys.some((key) => key.includes(CAM_GATE))).toBe(true);

    // Load page 2 -> offset 20 with cameraId preserved
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(api.listSafetyFrameInbox.mock.calls.at(-1)?.[1]).toMatchObject({
        offset: 20,
        limit: 20,
        readStatus: 'ALL',
        siteId: SITE_A,
        cameraId: CAM_GATE,
      }),
    );
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(25));

    cleanup();
    queryClient.clear();
    api.listSafetyFrameInbox.mockClear();

    // Malformed non-UUID cameraId in URL must be sanitized before calling SDK
    mountInbox(
      `/incidents?${new URLSearchParams({
        tab: 'ppe-frames',
        siteId: SITE_A,
        cameraId: 'not-a-valid-uuid',
      })}`,
    );
    await screen.findAllByRole('article');
    expect(api.listSafetyFrameInbox.mock.calls[0]?.[1]).toMatchObject({
      siteId: SITE_A,
      cameraId: undefined,
    });
  });

  it('keeps cards grouped per frame with separate per-case revision ACK and sends frame-level ACK only for remaining unread cases', async () => {
    let unreadByIndex = [true, true, true];
    const targetFrameKey = `tracked:${'a'.repeat(64)}:frame-21-1`;

    api.listSafetyFrameInbox.mockImplementation(async () => ({
      total: 1,
      unreadCount: unreadByIndex.some(Boolean) ? 1 : 0,
      items: [makeFrame(CAM_GATE, 'Gate Camera 01', 1, unreadByIndex)],
    }));
    api.readSafetyEpisodeInbox.mockImplementation(
      async (_token: string, recipientId: string, body: { seenRevision: number }) => {
        const idx = Number(recipientId.slice(-1)) - 1;
        if (idx >= 0 && idx < unreadByIndex.length) {
          unreadByIndex = unreadByIndex.map((prev, i) => (i === idx ? false : prev));
        }
        return {
          id: recipientId,
          contentRevision: body.seenRevision,
          seenRevision: body.seenRevision,
          unread: false,
        };
      },
    );

    mountInbox(
      `/incidents?${new URLSearchParams({
        tab: 'ppe-frames',
        siteId: SITE_A,
        cameraId: CAM_GATE,
        frameKey: targetFrameKey,
      })}`,
    );

    const row1 = await screen.findByTestId('frame-subject-row-1');
    expect(within(row1).getByText('Unread')).toBeTruthy();
    expect(screen.getByTestId('frame-check-scope-note').textContent).toMatch(
      /flagged cases, not current live person count/i,
    );

    // 1. Acknowledge ONLY Person 1's case revision
    const markCase1Btn = within(row1).getByTestId('frame-subject-mark-read-1');
    fireEvent.click(markCase1Btn);

    await waitFor(() => expect(api.readSafetyEpisodeInbox).toHaveBeenCalledTimes(1));
    expect(api.readSafetyEpisodeInbox).toHaveBeenCalledWith(
      'test-token-camera-paging',
      '00000000-0000-4000-8000-000000000011',
      { seenRevision: 1 },
    );

    // Frame stays grouped & unread because Cases 2 & 3 are still unread, while Case 1 is now Read
    await waitFor(() =>
      expect(within(screen.getByTestId('frame-subject-row-1')).getByText('Read')).toBeTruthy(),
    );
    expect(
      within(screen.getByTestId('frame-subject-row-1')).queryByTestId('frame-subject-mark-read-1'),
    ).toBeNull();
    expect(within(screen.getByTestId('frame-subject-row-2')).getByText('Unread')).toBeTruthy();
    expect(within(screen.getByTestId('frame-subject-row-3')).getByText('Unread')).toBeTruthy();

    // 2. Frame-level "Mark frame as read" acknowledges ONLY remaining unread Cases 2 & 3
    api.readSafetyEpisodeInbox.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Mark frame as read' }));

    await waitFor(() => expect(api.readSafetyEpisodeInbox).toHaveBeenCalledTimes(2));
    expect(api.readSafetyEpisodeInbox.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ['00000000-0000-4000-8000-000000000012', { seenRevision: 2 }],
      ['00000000-0000-4000-8000-000000000013', { seenRevision: 3 }],
    ]);
    await waitFor(() => expect(screen.getByText('0 unread frames')).toBeTruthy());
  });
});
