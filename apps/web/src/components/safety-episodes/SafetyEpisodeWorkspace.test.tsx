// @vitest-environment jsdom
import React from 'react';

import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyEpisode } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './SafetyEpisodeWorkspace';
import i18n from '../../i18n';
beforeEach(async () => {
  await i18n.changeLanguage('vi');
});
afterEach(cleanup);

const client = vi.hoisted(() => ({
  listSites: vi.fn(),
  listSafetyEpisodeInbox: vi.fn(),
  getSafetyEpisode: vi.fn(),
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
});
