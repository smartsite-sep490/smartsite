// @vitest-environment jsdom
import React from 'react';

import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyEpisode } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './SafetyEpisodeWorkspace';
import i18n from '../../i18n';
beforeEach(async () => {
  await i18n.changeLanguage('vi');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const client = vi.hoisted(() => ({
  listSites: vi.fn(),
  listSafetyEpisodeInbox: vi.fn(),
  listSafetyFrameInbox: vi.fn(),
  getSafetyEpisode: vi.fn(),
  getTrackedEpisode: vi.fn(),
  listTrackedEpisodeObservations: vi.fn(),
  readSafetyEpisodeInbox: vi.fn(),
  getSafetyAlert: vi.fn(),
}));
const evidencePanel = vi.hoisted(() => vi.fn());
vi.mock('../alerts/SafetyAlertEvidencePanel', () => ({
  SafetyAlertEvidencePanel: (props: unknown) => {
    evidencePanel(props);
    return <div>Authorized evidence</div>;
  },
}));
vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => client }));

const site = '11111111-1111-4111-8111-111111111111';
const recipientUuid = '55555555-5555-4555-8555-555555555555';
const session = (token = 'synthetic-session-A'): Pick<LoginResponse, 'accessToken' | 'user'> => ({
  accessToken: token,
  user: {
    id: 'officer',
    username: 'officer',
    displayName: 'Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: site }],
  },
});
const episode: SafetyEpisode = {
  id: '22222222-2222-4222-8222-222222222222',
  siteId: site,
  cameraId: '33333333-3333-4333-8333-333333333333',
  subject: {
    kind: 'EVENT_LOCAL',
    eventId: '44444444-4444-4444-8444-444444444444',
    personObservationIndex: 0,
  },
  configurationBundleId: null,
  firstObservedAt: '2026-10-31T10:00:00Z',
  lastObservedAt: '2026-10-31T10:00:00Z',
  contentRevision: 7,
  collectionState: 'COLLECTING',
  findingCount: 2,
  identityDecision: null,
  findings: [
    {
      alertId: 'hat',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      status: 'PENDING_REVIEW',
      alertRevision: 0,
      zoneId: null,
      evidenceRefs: [],
    },
    {
      alertId: 'vest',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
      status: 'CONFIRMED',
      alertRevision: 2,
      zoneId: null,
      evidenceRefs: [],
    },
  ],
  workflowLinks: [],
};
function setup() {
  vi.resetAllMocks();
  client.listSites.mockResolvedValue({
    items: [{ id: site, code: 'SITE-A', name: 'Công trường A' }],
    total: 1,
  });
  client.listSafetyEpisodeInbox.mockResolvedValue({
    items: [
      {
        id: 'inbox-1',
        episode: { ...episode, contentRevision: 8 },
        seenRevision: 6,
        unread: true,
        firstDeliveredAt: episode.firstObservedAt,
        updatedAt: episode.firstObservedAt,
      },
    ],
    total: 1,
    unreadCount: 1,
  });
  client.getSafetyEpisode.mockResolvedValue(episode);
  client.readSafetyEpisodeInbox.mockResolvedValue({
    id: 'inbox-1',
    contentRevision: 8,
    seenRevision: 7,
    unread: true,
  });
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = (auth = session(), path = '/incidents?tab=episodes') => (
    <QueryClientProvider client={query}>
      <MemoryRouter initialEntries={[path]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={auth}>
          <div>Legacy workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { query, view };
}
describe('recipient episode workspace', () => {
  it('labels a tracked person without inventing an event-local ordinal or Worker identity', async () => {
    const { view } = setup();
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: 'tracked-inbox',
          episode: {
            ...episode,
            subject: {
              kind: 'TRACKED',
              segmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              scopeSha256: 'a'.repeat(64),
            },
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.firstObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    render(view());
    expect(await screen.findByRole('button', { name: /Người đang theo dõi/ })).toBeTruthy();
    expect(screen.queryByText(/NaN|aaaaaaaa-aaaa|Chủ thể 1/)).toBeNull();
  });
  it('links persisted incidents and corrective actions without treating read status as completion', async () => {
    const { view } = setup();
    client.getSafetyEpisode.mockResolvedValue({
      ...episode,
      workflowLinks: [
        {
          incidentId: 'incident-A',
          status: 'ASSIGNED',
          actions: [{ actionId: 'action-A', status: 'IN_PROGRESS' }],
        },
      ],
    });
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    expect(
      (await screen.findByRole('link', { name: 'Mở sự cố liên quan' })).getAttribute('href'),
    ).toContain(`siteId=${site}&incidentId=incident-A`);
    expect(
      screen.getByRole('link', { name: 'Mở hành động khắc phục' }).getAttribute('href'),
    ).toContain('incidentId=incident-A&actionId=action-A');
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
  });
  it('keeps the working list stable when window focus returns', async () => {
    const { view } = setup();
    render(view());
    await screen.findByRole('button', { name: /Chủ thể 1/ });
    const before = client.listSafetyEpisodeInbox.mock.calls.length;
    try {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      expect(client.listSafetyEpisodeInbox).toHaveBeenCalledTimes(before);
    } finally {
      focusManager.setFocused(undefined);
    }
  });
  it('retains the working list when an explicit update check has a transient failure', async () => {
    const { view } = setup();
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    client.listSafetyEpisodeInbox.mockRejectedValue(new Error('temporary check error'));
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await screen.findByText('Chưa kiểm tra được bản mới. Danh sách đang xem vẫn được giữ.');
    expect(screen.getByRole('button', { name: /Chủ thể 1/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Xem phát hiện.*mũ/i })).toBeTruthy();
  });
  it('announces a newly checked first page without replacing the selected episode until accepted', async () => {
    const { view } = setup();
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: 'new-inbox',
          episode: {
            ...episode,
            id: 'new-episode',
            subject: { ...episode.subject, personObservationIndex: 5 },
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.firstObservedAt,
        },
      ],
      total: 2,
      unreadCount: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    expect(await screen.findByText('Có hồ sơ mới hoặc nội dung đã thay đổi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chủ thể 1/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Chủ thể 6/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Xem phát hiện.*mũ/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải danh sách mới' }));
    expect(await screen.findByRole('button', { name: /Chủ thể 6/ })).toBeTruthy();
  });
  it('opens only authorized evidence indices from the exact episode event', async () => {
    const { view } = setup();
    client.getSafetyEpisode.mockResolvedValue({
      ...episode,
      findings: [
        {
          ...episode.findings[0],
          evidenceRefs: [
            {
              eventId: episode.subject.eventId,
              personObservationIndex: 0,
              evidenceIndex: 1,
              sha256: 'a'.repeat(64),
              available: true,
            },
          ],
        },
      ],
    });
    client.getSafetyAlert.mockResolvedValue({
      id: 'hat',
      siteId: site,
      detections: [
        { eventId: 'other', evidence: [{ index: 0, kind: 'FRAME', available: true }] },
        {
          eventId: episode.subject.eventId,
          cameraExternalId: 'camera',
          capturedAt: episode.firstObservedAt,
          processingStatus: 'PROCESSED',
          evidence: [
            { index: 0, kind: 'FRAME', available: true },
            { index: 1, kind: 'CROP', available: true },
          ],
        },
      ],
    });
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Dấu hiệu thiếu mũ/ }));
    await screen.findByText('Authorized evidence');
    const props = evidencePanel.mock.calls.at(-1)![0] as {
      detection: { eventId: string; evidence: { index: number }[] };
    };
    expect(props.detection.eventId).toBe(episode.subject.eventId);
    expect(props.detection.evidence.map((e) => e.index)).toEqual([1]);
  });
  it('never falls back to another event image when exact evidence is unavailable', async () => {
    const { view } = setup();
    client.getSafetyEpisode.mockResolvedValue({
      ...episode,
      findings: [
        {
          ...episode.findings[0],
          evidenceRefs: [
            {
              eventId: episode.subject.eventId,
              personObservationIndex: 0,
              evidenceIndex: 0,
              sha256: 'a'.repeat(64),
              available: true,
            },
          ],
        },
      ],
    });
    client.getSafetyAlert.mockResolvedValue({
      id: 'hat',
      siteId: site,
      detections: [{ eventId: 'other', evidence: [{ index: 0, kind: 'FRAME', available: true }] }],
    });
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Dấu hiệu thiếu mũ/ }));
    await screen.findByText('Chưa có bằng chứng được phép xem cho quan sát này.');
    expect(evidencePanel).not.toHaveBeenCalled();
  });
  it('does not allow manual refresh to bypass a denied URL Site scope', async () => {
    const { view } = setup();
    render(view(session(), '/incidents?tab=episodes&siteId=foreign'));
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await act(async () => {});
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
  });
  it('reconciles an ambiguous read instead of sending another automatic acknowledgement', async () => {
    const { view } = setup();
    client.readSafetyEpisodeInbox.mockRejectedValue(new Error('timeout'));
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' }));
    await screen.findByText('Chưa rõ trạng thái đọc. Cần đối chiếu trước khi thử lại.');
    expect(screen.queryByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu trạng thái đọc' }));
    await screen.findByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' });
    expect(client.readSafetyEpisodeInbox).toHaveBeenCalledTimes(1);
    expect(client.getSafetyEpisode).toHaveBeenCalledTimes(2);
  });
  it('keeps selection on transient next-page failure and retries the same raw offset', async () => {
    const { view } = setup();
    const first = {
      id: 'inbox-1',
      episode,
      seenRevision: 0,
      unread: true,
      firstDeliveredAt: episode.firstObservedAt,
      updatedAt: episode.firstObservedAt,
    };
    client.listSafetyEpisodeInbox
      .mockResolvedValueOnce({ items: [first], total: 2, unreadCount: 2 })
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({
        items: [
          first,
          {
            ...first,
            id: 'inbox-2',
            episode: {
              ...episode,
              id: 'other',
              subject: { ...episode.subject, personObservationIndex: 3 },
            },
          },
        ],
        total: 2,
        unreadCount: 2,
      });
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm hồ sơ' }));
    await screen.findByText('Không tải được trang tiếp. Hồ sơ đã tải vẫn được giữ.');
    expect(screen.getByRole('link', { name: /Xem phát hiện.*mũ/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tải thêm hồ sơ' }));
    await screen.findByRole('button', { name: /Chủ thể 4/ });
    expect(
      client.listSafetyEpisodeInbox.mock.calls.slice(-2).map((call) => call[1].offset),
    ).toEqual([1, 1]);
    expect(screen.getAllByRole('button', { name: /Chủ thể 1/ })).toHaveLength(1);
  });
  it('hides cached rows and detail after a base refresh loses Site permission', async () => {
    const { view } = setup();
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    client.listSafetyEpisodeInbox.mockRejectedValue(new ApiError('http', 'Denied', 403));
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await screen.findByText('Không tải được hồ sơ. Làm mới để kiểm tra quyền truy cập.');
    expect(screen.queryByRole('button', { name: /Chủ thể 1/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Xem phát hiện.*mũ/i })).toBeNull();
  });
  it('keeps finding actions separate and reads only the detail revision explicitly viewed', async () => {
    const { view } = setup();
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    expect(
      (await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i })).getAttribute('href'),
    ).toContain('alertId=hat');
    expect(screen.getByRole('link', { name: /Xem phát hiện.*áo/i }).getAttribute('href')).toContain(
      'alertId=vest',
    );
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' }));
    await waitFor(() =>
      expect(client.readSafetyEpisodeInbox).toHaveBeenCalledWith('synthetic-session-A', 'inbox-1', {
        seenRevision: 7,
      }),
    );
    expect(await screen.findByText('Có nội dung mới hơn bản vừa đọc.')).toBeTruthy();
  });
  it('never exposes cached rows from a previous credential and keeps tokens out of query keys', async () => {
    const { view, query } = setup();
    const rendered = render(view());
    await screen.findByRole('button', { name: /Chủ thể 1/ });
    let finish: (value: unknown) => void = () => {};
    client.listSafetyEpisodeInbox.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    rendered.rerender(view(session('synthetic-session-B')));
    expect(screen.queryByRole('button', { name: /Chủ thể 1/ })).toBeNull();
    expect(
      JSON.stringify(
        query
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ),
    ).not.toContain('synthetic-session');
    await act(async () => finish({ items: [], total: 0, unreadCount: 0 }));
    expect(await screen.findByText('Chưa có hồ sơ trong phạm vi này.')).toBeTruthy();
  });
  it('does not call recipient APIs for a Site Manager', async () => {
    const { view } = setup();
    const manager = session();
    manager.user.roleAssignments = [{ role: 'SITE_MANAGER', siteId: site }];
    render(view(manager));
    expect(screen.getByText('Hộp thư này dành cho cán bộ an toàn được phân công.')).toBeTruthy();
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
  });
  it('looks up an exact recipientId from the URL with { recipientId, limit: 1 }, reuses Main detail, and requires explicit revision-aware read', async () => {
    const { view } = setup();
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: recipientUuid,
          episode: { ...episode, contentRevision: 8 },
          seenRevision: 6,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.firstObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    client.readSafetyEpisodeInbox.mockResolvedValue({
      id: recipientUuid,
      contentRevision: 8,
      seenRevision: 7,
      unread: true,
    });
    render(view(session(), `/incidents?tab=episodes&recipientId=${recipientUuid}`));
    const rowButton = await screen.findByRole('button', { name: /Chủ thể 1/ });
    expect(rowButton.getAttribute('aria-pressed')).toBe('true');
    expect(client.listSafetyEpisodeInbox).toHaveBeenCalledWith(
      'synthetic-session-A',
      { recipientId: recipientUuid, limit: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      (await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i })).getAttribute('href'),
    ).toContain(`siteId=${site}&alertId=hat`);
    expect(screen.getByRole('link', { name: /Xem phát hiện.*áo/i }).getAttribute('href')).toContain(
      `siteId=${site}&alertId=vest`,
    );
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' }));
    await waitFor(() =>
      expect(client.readSafetyEpisodeInbox).toHaveBeenCalledWith(
        'synthetic-session-A',
        recipientUuid,
        { seenRevision: 7 },
      ),
    );
  });
  it('opens a tracked recipient and acknowledges only the displayed detail revision', async () => {
    const { query, view } = setup();
    const subject = {
      kind: 'TRACKED',
      segmentId: '66666666-6666-4666-8666-666666666666',
      scopeSha256: 'a'.repeat(64),
    };
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: recipientUuid,
          episode: { ...episode, subject, contentRevision: 8 },
          seenRevision: 6,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.lastObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    client.getTrackedEpisode.mockResolvedValue({
      ...episode,
      episodeId: episode.id,
      subject,
      contentRevision: 7,
      findings: [],
    });
    client.listTrackedEpisodeObservations.mockResolvedValue({
      episodeId: episode.id,
      contentRevision: 7,
      throughSequence: '1',
      offset: 0,
      limit: 20,
      total: 0,
      hasMore: false,
      items: [],
    });
    client.readSafetyEpisodeInbox.mockResolvedValue({
      id: recipientUuid,
      contentRevision: 8,
      seenRevision: 7,
      unread: true,
    });
    render(
      view(
        session(),
        '/incidents?tab=episodes&siteId=' +
          site +
          '&frameKey=event%3Asource-frame&recipientId=' +
          recipientUuid,
      ),
    );

    const identification = await screen.findByRole('link', { name: 'Yêu cầu xác minh người' });
    expect(identification.getAttribute('href')).toBe(
      '/incidents?' +
        new URLSearchParams({
          tab: 'identification',
          siteId: site,
          episodeId: episode.id,
          originRecipientId: recipientUuid,
          frameKey: 'event:source-frame',
        }),
    );
    const markRead = await screen.findByRole('button', { name: 'Đánh dấu bản đang xem đã đọc' });
    expect(client.getTrackedEpisode).toHaveBeenCalledWith(
      'synthetic-session-A',
      site,
      episode.id,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.getSafetyEpisode).not.toHaveBeenCalled();
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
    fireEvent.click(markRead);
    await waitFor(() =>
      expect(client.readSafetyEpisodeInbox).toHaveBeenCalledWith(
        'synthetic-session-A',
        recipientUuid,
        { seenRevision: 7 },
      ),
    );

    client.getTrackedEpisode.mockRejectedValue(new ApiError('http', 'Denied', 403));
    await act(async () => {
      await query.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === 'tracked-episode-evidence-workspace' && queryKey.at(-1) === 'detail',
      });
    });
    expect(await screen.findByTestId('tracked-workspace-detail-forbidden')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Yêu cầu xác minh người' })).toBeNull();
  });

  it('forwards validated cameraId and frameKey to C02 identification and drops untrusted query parameters', async () => {
    const { view } = setup();
    const subject = {
      kind: 'TRACKED' as const,
      segmentId: '66666666-6666-4666-8666-666666666666',
      scopeSha256: 'a'.repeat(64),
    };
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: recipientUuid,
          episode: { ...episode, subject, contentRevision: 8 },
          seenRevision: 6,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.lastObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    client.getTrackedEpisode.mockResolvedValue({
      ...episode,
      episodeId: episode.id,
      subject,
      contentRevision: 7,
      findings: [],
    });
    client.listTrackedEpisodeObservations.mockResolvedValue({
      episodeId: episode.id,
      contentRevision: 7,
      throughSequence: '1',
      offset: 0,
      limit: 20,
      total: 0,
      hasMore: false,
      items: [],
    });

    const validUrl =
      '/incidents?' +
      new URLSearchParams({
        tab: 'episodes',
        siteId: site,
        cameraId: episode.cameraId,
        frameKey: 'event:source-frame',
        recipientId: recipientUuid,
      });
    render(view(session(), validUrl));

    const validIdentification = await screen.findByRole('link', { name: 'Yêu cầu xác minh người' });
    expect(
      Object.fromEntries(
        new URL(validIdentification.getAttribute('href')!, 'http://example.test').searchParams,
      ),
    ).toEqual({
      tab: 'identification',
      siteId: site,
      episodeId: episode.id,
      originRecipientId: recipientUuid,
      frameKey: 'event:source-frame',
      cameraId: episode.cameraId,
    });
    cleanup();

    const untrustedUrl =
      '/incidents?' +
      new URLSearchParams({
        tab: 'episodes',
        siteId: site,
        cameraId: '//evil.example/hijack',
        frameKey: 'javascript:alert(1)',
        recipientId: recipientUuid,
      });
    render(view(session(), untrustedUrl));

    const sanitizedIdentification = await screen.findByRole('link', {
      name: 'Yêu cầu xác minh người',
    });
    expect(
      Object.fromEntries(
        new URL(sanitizedIdentification.getAttribute('href')!, 'http://example.test').searchParams,
      ),
    ).toEqual({
      tab: 'identification',
      siteId: site,
      episodeId: episode.id,
      originRecipientId: recipientUuid,
    });
    expect(screen.queryByRole('link', { name: 'Quay lại khung đang xem' })).toBeNull();
  });

  it('blocks exact recipientId lookup when the returned episode belongs to an ungranted Site', async () => {
    const { view } = setup();
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: recipientUuid,
          episode: { ...episode, siteId: '99999999-9999-4999-8999-999999999999' },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: episode.firstObservedAt,
          updatedAt: episode.firstObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    render(view(session(), `/incidents?tab=episodes&recipientId=${recipientUuid}`));
    expect(await screen.findByText('Công trường này ngoài phạm vi được phân công.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Chủ thể 1/ })).toBeNull();
    expect(client.getSafetyEpisode).not.toHaveBeenCalled();
    expect(client.readSafetyEpisodeInbox).not.toHaveBeenCalled();
  });
  it('clears recipientId when changing standard filters or switching back to legacy alert workflow', async () => {
    const { view } = setup();
    client.listSafetyEpisodeInbox
      .mockResolvedValueOnce({
        items: [
          {
            id: recipientUuid,
            episode: { ...episode, contentRevision: 8 },
            seenRevision: 6,
            unread: true,
            firstDeliveredAt: episode.firstObservedAt,
            updatedAt: episode.firstObservedAt,
          },
        ],
        total: 1,
        unreadCount: 1,
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'inbox-1',
            episode: { ...episode, contentRevision: 8 },
            seenRevision: 6,
            unread: true,
            firstDeliveredAt: episode.firstObservedAt,
            updatedAt: episode.firstObservedAt,
          },
        ],
        total: 1,
        unreadCount: 1,
      });
    render(view(session(), `/incidents?tab=episodes&recipientId=${recipientUuid}`));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    expect(screen.getByRole('link', { name: 'Xử lý an toàn' }).getAttribute('href')).not.toContain(
      'recipientId',
    );
    fireEvent.change(screen.getByLabelText('Hiển thị'), { target: { value: 'UNREAD' } });
    await waitFor(() =>
      expect(client.listSafetyEpisodeInbox).toHaveBeenLastCalledWith(
        'synthetic-session-A',
        { offset: 0, limit: 20, readStatus: 'UNREAD' },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it('supports mixed-case canonical site IDs across Episode Inbox and rejects malformed recipientId query params before calling API', async () => {
    const { view } = setup();
    const upperSite = 'SITE-ALPHA-01';
    const upperAuth = session('synthetic-upper');
    upperAuth.user.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: upperSite }];
    const upperEpisode: SafetyEpisode = {
      ...episode,
      siteId: upperSite,
    };
    client.listSites.mockResolvedValue({
      items: [{ id: upperSite, code: 'ALPHA', name: 'Công trường Alpha Hoa' }],
      total: 1,
    });
    client.listSafetyEpisodeInbox.mockResolvedValue({
      items: [
        {
          id: recipientUuid,
          episode: { ...upperEpisode, contentRevision: 8 },
          seenRevision: 6,
          unread: true,
          firstDeliveredAt: upperEpisode.firstObservedAt,
          updatedAt: upperEpisode.firstObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    client.getSafetyEpisode.mockResolvedValue(upperEpisode);

    render(view(upperAuth, `/incidents?tab=episodes&siteId=${upperSite}`));
    const rowButton = await screen.findByRole('button', { name: /Chủ thể 1/ });
    expect(rowButton.textContent).toContain('Công trường Alpha Hoa');
    fireEvent.click(rowButton);
    expect(await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Yêu cầu xác minh người' }).getAttribute('href'),
    ).toContain(`siteId=${upperSite}`);
    cleanup();

    // Non-UUID originRecipientId on Episode Inbox row must hide Request identification (fail closed)
    client.listSafetyEpisodeInbox.mockResolvedValueOnce({
      items: [
        {
          id: 'non-uuid-row-slug',
          episode: { ...upperEpisode, contentRevision: 8 },
          seenRevision: 6,
          unread: true,
          firstDeliveredAt: upperEpisode.firstObservedAt,
          updatedAt: upperEpisode.firstObservedAt,
        },
      ],
      total: 1,
      unreadCount: 1,
    });
    render(view(upperAuth, '/incidents?tab=episodes'));
    fireEvent.click(await screen.findByRole('button', { name: /Chủ thể 1/ }));
    await screen.findByRole('link', { name: /Xem phát hiện.*mũ/i });
    expect(screen.queryByRole('link', { name: 'Yêu cầu xác minh người' })).toBeNull();
    cleanup();

    // Malformed recipientId in URL must be rejected client-side without calling listSafetyEpisodeInbox
    client.listSafetyEpisodeInbox.mockClear();
    render(view(upperAuth, '/incidents?tab=episodes&recipientId=//evil.example/hijack'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
  });
});

describe('frame Inbox entry', () => {
  it('returns from a person case to the same open frame within the assigned site', async () => {
    const { view } = setup();
    const frameKey = 'event:frame-A';
    client.listSafetyFrameInbox.mockResolvedValue({
      total: 1,
      unreadCount: 1,
      items: [
        {
          frameKey,
          siteId: site,
          cameraId: episode.cameraId,
          siteName: 'Site A',
          cameraName: 'Camera A',
          capturedAt: episode.firstObservedAt,
          unread: true,
          findingCount: 2,
          cases: [
            {
              recipientId: recipientUuid,
              episodeId: episode.id,
              findingCount: 2,
              contentRevision: 8,
              unread: true,
              source: null,
              zoneEntries: [],
            },
          ],
        },
      ],
    });
    render(
      view(
        session(),
        '/incidents?' + new URLSearchParams({ tab: 'ppe-frames', siteId: site, frameKey }),
      ),
    );
    const caseLink = await screen.findByRole('link', { name: 'Mở hồ sơ người 1' });
    fireEvent.click(caseLink);
    const back = screen.getByRole('link', { name: 'Quay lại khung đang xem' });
    expect(
      Object.fromEntries(new URL(back.getAttribute('href')!, 'http://example.test').searchParams),
    ).toEqual({ tab: 'ppe-frames', siteId: site, frameKey });
    fireEvent.click(back);
    await screen.findByRole('link', { name: 'Mở hồ sơ người 1' });
    expect(client.listSafetyFrameInbox.mock.calls.at(-1)?.[1]).toMatchObject({
      siteId: site,
      frameKey,
    });
    expect(
      screen.getByRole('button', { name: /1 người cần xem xét/ }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('opens the scoped frame Inbox from safety operations without a Bell notification', async () => {
    const { view } = setup();
    client.listSafetyFrameInbox.mockResolvedValue({ items: [], total: 0, unreadCount: 0 });
    render(view(session(), '/incidents?siteId=' + site + '&alertId=old-alert&tab=actions'));
    expect(screen.getByText('Legacy workflow')).toBeTruthy();
    const frameLink = screen.getByRole('link', { name: 'Thông báo theo khung hình' });
    const params = new URL(frameLink.getAttribute('href')!, 'http://example.test').searchParams;
    expect(Object.fromEntries(params)).toEqual({ tab: 'ppe-frames', siteId: site });
    expect(screen.getByRole('link', { name: 'Hồ sơ theo người' })).toBeTruthy();
    fireEvent.click(frameLink);
    await screen.findByText('0 khung chưa đọc');
    expect(client.listSafetyFrameInbox.mock.calls[0]?.[1]).toMatchObject({ siteId: site });
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
  });

  it('keeps the frame entry hidden for users without a scoped Safety Officer assignment', () => {
    const { view } = setup();
    const auth = session();
    render(view({ ...auth, user: { ...auth.user, roleAssignments: [] } }, '/incidents'));
    expect(screen.queryByRole('link', { name: 'Thông báo theo khung hình' })).toBeNull();
    expect(client.listSafetyFrameInbox).not.toHaveBeenCalled();
  });
  it('opens the frame Inbox for a scoped Safety Officer', async () => {
    const { view } = setup();
    client.listSafetyFrameInbox.mockResolvedValue({ items: [], total: 0, unreadCount: 0 });
    render(view(session(), '/incidents?tab=ppe-frames'));
    await screen.findByText('0 khung chưa đọc');
    expect(screen.getByRole('region', { name: 'Inbox PPE theo khung hình' })).toBeTruthy();
    expect(client.listSafetyEpisodeInbox).not.toHaveBeenCalled();
  });

  it('denies the frame Inbox without a Safety Officer assignment', () => {
    const { view } = setup();
    const auth = session();
    render(
      view({ ...auth, user: { ...auth.user, roleAssignments: [] } }, '/incidents?tab=ppe-frames'),
    );
    expect(screen.getByRole('alert').textContent).toContain(i18n.t('episodes.denied'));
    expect(client.listSafetyFrameInbox).not.toHaveBeenCalled();
  });
});
