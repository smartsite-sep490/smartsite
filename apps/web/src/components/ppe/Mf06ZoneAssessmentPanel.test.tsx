// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mf06ZoneAssessmentPanel } from './Mf06ZoneAssessmentPanel';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06RequestStatusResponse,
  type Mf06RequestStatusPage,
  type Mf06AssessmentPage,
} from '@smartsite/api-client';

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_1 = 'cred-test-1';
const TOKEN_1 = 'token-test-1';

function createRequestStatus(
  overrides?: Partial<Mf06RequestStatusResponse>,
): Mf06RequestStatusResponse {
  return {
    requestId: '22222222-2222-4222-8222-222222222222',
    siteId: SITE_1,
    eventId: '44444444-4444-4444-8444-444444444444',
    cameraId: '55555555-5555-4555-8555-555555555555',
    zoneId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-12T10:00:00.000Z',
    requestedAt: '2026-10-12T10:00:01.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    jobStatus: 'PENDING',
    attemptCount: 1,
    deadlineAt: '2026-10-12T10:00:05.000Z',
    deadlinePassed: false,
    assessmentId: null,
    ...overrides,
  };
}

function create20Requests(startOffset = 0, siteId = SITE_1): Mf06RequestStatusResponse[] {
  return Array.from({ length: 20 }, (_, i) =>
    createRequestStatus({
      requestId: `22222222-2222-4222-8222-${String(startOffset + i).padStart(12, '0')}`,
      siteId,
    }),
  );
}

function createRequestPage(
  items: Mf06RequestStatusResponse[] = [createRequestStatus()],
  total = items.length,
  offset = 0,
  limit = 20,
): Mf06RequestStatusPage {
  return { items, total, offset, limit };
}

const emptyAssessmentPage: Mf06AssessmentPage = {
  items: [],
  total: 0,
  offset: 0,
  limit: 20,
};

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mount(ui: (queries: QueryClient) => React.ReactElement) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  clients.push(queries);
  const view = render(<QueryClientProvider client={queries}>{ui(queries)}</QueryClientProvider>);
  return {
    ...view,
    queries,
  };
}

describe('Mf06ZoneAssessmentPanel (B5 Requests & Assessments)', () => {
  let mockListMf06Assessments: ReturnType<typeof vi.fn>;
  let mockListMf06RequestStatuses: ReturnType<typeof vi.fn>;
  let mockClient: SmartSiteManagementClient;

  beforeEach(() => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    mockListMf06Assessments = vi.fn().mockResolvedValue(emptyAssessmentPage);
    mockListMf06RequestStatuses = vi.fn().mockResolvedValue(createRequestPage());
    mockClient = {
      listMf06Assessments: mockListMf06Assessments,
      listMf06RequestStatuses: mockListMf06RequestStatuses,
    } as unknown as SmartSiteManagementClient;
  });

  it('renders with Assessments tab active by default and does not fetch requests initially', () => {
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(screen.getByRole('tab', { name: 'Assessments' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Requests' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(mockListMf06Assessments).toHaveBeenCalledWith(
      TOKEN_1,
      SITE_1,
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockListMf06RequestStatuses).not.toHaveBeenCalled();
  });

  it('switches to Requests tab and fetches request status data', async () => {
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const requestsTab = screen.getByRole('tab', { name: 'Requests' });
    fireEvent.click(requestsTab);

    expect(requestsTab.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(mockListMf06RequestStatuses).toHaveBeenCalledWith(
        TOKEN_1,
        SITE_1,
        { offset: 0, limit: 20 },
        expect.any(Object),
      );
    });
    expect(await screen.findByText('Pending')).toBeTruthy();
  });

  it('displays paused banner when VITE_AI_WORK_PAUSED is true with technical disclaimer', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText(/AI Monitoring Paused · Technical Request State/i)).toBeTruthy();
    expect(screen.getByText(/no new AI evaluations are performed while paused/i)).toBeTruthy();
    expect(screen.getByText(/request enqueue is inactive/i)).toBeTruthy();
    expect(
      screen.getByText(
        /persisted CLAIMED states represent historical records, not active worker execution/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/do not convey access permissions or worker identity/i)).toBeTruthy();
  });

  it('displays metadata-only banner when VITE_AI_WORK_PAUSED is false with technical disclaimer', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText(/Technical Request State · Metadata Only/i)).toBeTruthy();
    expect(screen.queryByText(/no new AI evaluations are performed while paused/i)).toBeNull();
    expect(
      screen.getByText(
        /persisted CLAIMED states represent historical records, not active worker execution/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/do not convey access permissions or worker identity/i)).toBeTruthy();
  });

  it('correctly displays NOT_QUEUED jobStatus with null fields and without deadline', async () => {
    mockListMf06RequestStatuses.mockResolvedValue(
      createRequestPage([
        createRequestStatus({
          jobStatus: 'NOT_QUEUED',
          attemptCount: null,
          deadlineAt: null,
          deadlinePassed: false,
          assessmentId: null,
        }),
      ]),
    );

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('Not Queued')).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.queryByText(/Attempts:/i)).toBeNull();
  });

  it('correctly displays SUCCEEDED jobStatus with linked assessmentId', async () => {
    mockListMf06RequestStatuses.mockResolvedValue(
      createRequestPage([
        createRequestStatus({
          jobStatus: 'SUCCEEDED',
          assessmentId: '11111111-1111-4111-8111-111111111111',
        }),
      ]),
    );

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('Succeeded')).toBeTruthy();
    const assessmentField = screen.getByText('Assessment ID:').parentElement;
    if (!assessmentField) throw new Error('Linked assessment field missing');
    expect(within(assessmentField).getByText('11111111-1111-4111-8111-111111111111')).toBeTruthy();
  });

  it('opens the linked recorded assessment without treating successful processing as access permission', async () => {
    const request = createRequestStatus({
      jobStatus: 'SUCCEEDED',
      assessmentId: '11111111-1111-4111-8111-111111111111',
    });
    const record = {
      assessmentId: request.assessmentId,
      requestId: request.requestId,
      siteId: request.siteId,
      eventId: request.eventId,
      cameraId: request.cameraId,
      zoneId: request.zoneId,
      capturedAt: request.capturedAt,
      assessedAt: '2026-10-12T10:00:03.000Z',
      purpose: request.purpose,
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      evaluatorVersion: 'SYNTHETIC_READ_V1',
      provenance: 'UNAVAILABLE',
    };
    const get = vi.fn().mockResolvedValue(record);
    mockListMf06RequestStatuses.mockResolvedValue(createRequestPage([request]));
    Object.assign(mockClient, { getMf06Assessment: get });
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));
    fireEvent.click(await screen.findByRole('button', { name: 'View assessment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();
    expect(within(dialog).queryByText('Allowed')).toBeNull();
    expect(get).toHaveBeenCalledWith(
      TOKEN_1,
      SITE_1,
      request.assessmentId,
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it.each([401, 403])(
    'revokes parent request metadata after detail access failure %s',
    async (status) => {
      const request = createRequestStatus({
        jobStatus: 'SUCCEEDED',
        assessmentId: '11111111-1111-4111-8111-111111111111',
      });
      mockListMf06RequestStatuses.mockResolvedValue(createRequestPage([request]));
      Object.assign(mockClient, {
        getMf06Assessment: vi.fn().mockRejectedValue(new ApiError('http', 'Access denied', status)),
      });
      const unauthorized = vi.fn();
      const unrelatedKey = [
        'mf06-requests',
        'https://other-synthetic-api.invalid',
        -99,
        'other-site',
        'other-credential',
        -99,
      ];
      const unrelatedData = {
        pages: [{ items: [], offset: 0, total: 0, limit: 20 }],
        pageParams: [0],
      };
      const { queries, container } = mount((cache) => {
        cache.setQueryDefaults(unrelatedKey, { gcTime: Infinity });
        cache.setQueryData(unrelatedKey, unrelatedData);
        return (
          <Mf06ZoneAssessmentPanel
            token={TOKEN_1}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            client={mockClient}
            initialTab="requests"
            onUnauthorized={unauthorized}
          />
        );
      });
      fireEvent.click(await screen.findByRole('button', { name: 'View assessment' }));
      await waitFor(() =>
        expect(
          queries
            .getQueriesData({ queryKey: ['mf06-requests'] })
            .some(([key, data]) => key[1] !== unrelatedKey[1] && data !== undefined),
        ).toBe(false),
      );
      expect(container.textContent).not.toContain(request.requestId);
      expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0));
      expect(queries.getQueryData(unrelatedKey)).toEqual(unrelatedData);
    },
  );

  it('displays CLAIMED status with Claimed (recorded) and deadlinePassed=true without turning into FAILED', async () => {
    mockListMf06RequestStatuses.mockResolvedValue(
      createRequestPage([
        createRequestStatus({
          jobStatus: 'CLAIMED',
          deadlinePassed: true,
        }),
      ]),
    );

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('Claimed (recorded)')).toBeTruthy();
    expect(screen.getByText('Deadline Passed')).toBeTruthy();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('triggers manual refresh on Refresh button click', async () => {
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    await screen.findByText('Pending');
    expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(1);

    const refreshButton = screen.getByRole('button', { name: /Refresh/i });
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(2);
    });
  });

  it('supports explicit 20-row pagination with Load more (20)', async () => {
    mockListMf06RequestStatuses
      .mockResolvedValueOnce(createRequestPage(create20Requests(0), 25, 0, 20))
      .mockResolvedValueOnce(createRequestPage(create20Requests(20).slice(0, 5), 25, 20, 20));

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('Load more (20)')).toBeTruthy();
    fireEvent.click(screen.getByText('Load more (20)'));

    await waitFor(() => {
      expect(mockListMf06RequestStatuses).toHaveBeenCalledWith(
        TOKEN_1,
        SITE_1,
        { offset: 20, limit: 20 },
        expect.any(Object),
      );
    });
  });

  it('preserves prior rows on transient next-page error with retry button', async () => {
    mockListMf06RequestStatuses
      .mockResolvedValueOnce(createRequestPage(create20Requests(0), 25, 0, 20))
      .mockRejectedValueOnce(new ApiError('network', 'Connection dropped.'));

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    await screen.findByText('Load more (20)');
    fireEvent.click(screen.getByText('Load more (20)'));

    expect(await screen.findByText('Failed to load additional requests.')).toBeTruthy();
    expect(screen.getByText(/22222222-2222-4222-8222-000000000000/)).toBeTruthy();
    expect(screen.getByText('Retry loading next page')).toBeTruthy();
  });

  it('next-page retry uses same offset and prevents duplicate pending calls', async () => {
    let resolveRetry: (page: Mf06RequestStatusPage) => void = () => {};
    const retryPromise = new Promise<Mf06RequestStatusPage>((resolve) => {
      resolveRetry = resolve;
    });

    mockListMf06RequestStatuses
      .mockResolvedValueOnce(createRequestPage(create20Requests(0), 40, 0, 20))
      .mockRejectedValueOnce(new ApiError('network', 'Drop on p2'))
      .mockImplementationOnce(() => retryPromise);

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('Load more (20)')).toBeTruthy();
    fireEvent.click(screen.getByText('Load more (20)'));

    const retryBtn = await screen.findByRole('button', { name: /Retry loading next page/i });
    expect(retryBtn).toBeTruthy();

    fireEvent.click(retryBtn);

    expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(3);
    expect(mockListMf06RequestStatuses).toHaveBeenLastCalledWith(
      TOKEN_1,
      SITE_1,
      { offset: 20, limit: 20 },
      expect.any(Object),
    );

    fireEvent.click(retryBtn);
    fireEvent.click(retryBtn);
    expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveRetry(createRequestPage(create20Requests(20), 40, 20, 20));
    });

    expect(await screen.findByText(/22222222-2222-4222-8222-000000000020/i)).toBeTruthy();
  });

  it('hides rows and invokes onUnauthorized on hard 401 error, hiding refresh button', async () => {
    mockListMf06RequestStatuses.mockRejectedValue(new ApiError('http', 'Unauthorized', 401));
    const onUnauthorized = vi.fn();

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
        onUnauthorized={onUnauthorized}
      />
    ));

    expect(
      await screen.findByText('Session expired or unauthorized. Please sign in again.'),
    ).toBeTruthy();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Pending')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh/i })).toBeNull();
  });

  it('handles hard 403 Forbidden without logout, hides data and refresh button', async () => {
    mockListMf06RequestStatuses.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
    const onUnauthorized = vi.fn();

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
        onUnauthorized={onUnauthorized}
      />
    ));

    expect(
      await screen.findByText('You do not have permission to view requests for this site.'),
    ).toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.queryByText('Pending')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh/i })).toBeNull();
  });

  it('handles hard 404 Not Found without logout, hides data and refresh button', async () => {
    mockListMf06RequestStatuses.mockRejectedValue(new ApiError('http', 'Not Found', 404));
    const onUnauthorized = vi.fn();

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
        onUnauthorized={onUnauthorized}
      />
    ));

    expect(
      await screen.findByText('Site or assessment request resource unavailable.'),
    ).toBeTruthy();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(screen.queryByText('Pending')).toBeNull();
    expect(screen.queryByRole('button', { name: /Refresh/i })).toBeNull();
  });

  it('hides old cached data when token is rotated with SAME credentialId', async () => {
    mockListMf06RequestStatuses.mockImplementation(async (token: string) => {
      if (token === 'token-old') {
        return createRequestPage([createRequestStatus({ requestId: 'req-old-token' })]);
      }
      return createRequestPage([createRequestStatus({ requestId: 'req-new-token' })]);
    });

    function Harness() {
      const [token, setToken] = React.useState('token-old');
      return (
        <div>
          <button type="button" onClick={() => setToken('token-new')}>
            Rotate Token
          </button>
          <Mf06ZoneAssessmentPanel
            token={token}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            client={mockClient}
            initialTab="requests"
          />
        </div>
      );
    }

    mount(() => <Harness />);

    expect(await screen.findByText(/req-old-token/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Rotate Token'));

    expect(await screen.findByText(/req-new-token/i)).toBeTruthy();
    expect(screen.queryByText(/req-old-token/i)).toBeNull();
  });

  it('aborts a pending old token and rejects its late result with reused credentialId', async () => {
    let releaseOld!: (page: Mf06RequestStatusPage) => void;
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise<Mf06RequestStatusPage>((resolve) => {
      releaseOld = resolve;
    });
    mockListMf06RequestStatuses.mockImplementation(
      (token: string, _site: string, _page: unknown, options: { signal: AbortSignal }) => {
        if (token === 'token-old') {
          oldSignal = options.signal;
          return pending;
        }
        return Promise.resolve(
          createRequestPage([createRequestStatus({ requestId: 'new-token-result' })]),
        );
      },
    );
    function Harness() {
      const [token, setToken] = React.useState('token-old');
      return (
        <>
          <button onClick={() => setToken('token-new')}>Rotate pending token</button>
          <Mf06ZoneAssessmentPanel
            token={token}
            siteId={SITE_1}
            credentialId={CREDENTIAL_1}
            client={mockClient}
            initialTab="requests"
          />
        </>
      );
    }
    mount(() => <Harness />);
    await waitFor(() => expect(oldSignal).toBeDefined());
    fireEvent.click(screen.getByText('Rotate pending token'));
    expect(await screen.findByText('new-token-result')).toBeTruthy();
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    await act(async () =>
      releaseOld(createRequestPage([createRequestStatus({ requestId: 'late-old-token-result' })])),
    );
    expect(screen.queryByText('late-old-token-result')).toBeNull();
    expect(screen.getByText('new-token-result')).toBeTruthy();
  });

  it('a failure on page two during BASE refresh hides both previously loaded pages', async () => {
    let refreshing = false;
    mockListMf06RequestStatuses.mockImplementation(
      async (_token: string, _site: string, options: { offset: number }) => {
        if (refreshing && options.offset === 20)
          throw new ApiError('http', 'Fixture unavailable', 503);
        return createRequestPage(create20Requests(options.offset, SITE_1), 40, options.offset);
      },
    );
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));
    fireEvent.click(await screen.findByText('Load more (20)'));
    await waitFor(() => expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(40));
    refreshing = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(
      await screen.findByText('Request status service temporarily unavailable (503).'),
    ).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText('Retry loading next page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('suppresses late response and cancels pending requests from prior site when siteId switches', async () => {
    const SITE_2 = '33333333-3333-4333-8333-333333333332';
    let resolveSite1: (page: Mf06RequestStatusPage) => void = () => {};
    const site1Promise = new Promise<Mf06RequestStatusPage>((resolve) => {
      resolveSite1 = resolve;
    });

    mockListMf06RequestStatuses.mockImplementation(async (_token: string, siteId: string) => {
      if (siteId === SITE_1) {
        return site1Promise;
      }
      return createRequestPage([createRequestStatus({ requestId: 'req-site-2', siteId: SITE_2 })]);
    });

    function Harness() {
      const [siteId, setSiteId] = React.useState(SITE_1);
      return (
        <div>
          <button type="button" onClick={() => setSiteId(SITE_2)}>
            Switch Site
          </button>
          <Mf06ZoneAssessmentPanel
            token={TOKEN_1}
            siteId={siteId}
            credentialId={CREDENTIAL_1}
            client={mockClient}
            initialTab="requests"
          />
        </div>
      );
    }

    mount(() => <Harness />);

    fireEvent.click(screen.getByText('Switch Site'));

    expect(await screen.findByText(/req-site-2/i)).toBeTruthy();

    await act(async () => {
      resolveSite1(
        createRequestPage([createRequestStatus({ requestId: 'req-site-1', siteId: SITE_1 })]),
      );
    });

    expect(screen.queryByText(/req-site-1/i)).toBeNull();
    expect(screen.getByText(/req-site-2/i)).toBeTruthy();
  });

  it('hides stale rows when subsequent BASE-refetch encounters an error', async () => {
    mockListMf06RequestStatuses
      .mockResolvedValueOnce(
        createRequestPage([createRequestStatus({ requestId: 'req-initial-settled' })]),
      )
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503));

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText(/req-initial-settled/i)).toBeTruthy();

    const refreshBtn = screen.getByRole('button', { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    expect(
      await screen.findByText('Request status service temporarily unavailable (503).'),
    ).toBeTruthy();
    expect(screen.queryByText(/req-initial-settled/i)).toBeNull();
  });

  it.each([
    { label: '401', next: () => Promise.reject(new ApiError('http', 'Unauthorized', 401)) },
    { label: '403', next: () => Promise.reject(new ApiError('http', 'Forbidden', 403)) },
    { label: '404', next: () => Promise.reject(new ApiError('http', 'Not found', 404)) },
    { label: '503', next: () => Promise.reject(new ApiError('http', 'Unavailable', 503)) },
    { label: 'removed-row', next: () => Promise.resolve(createRequestPage([], 0, 0, 20)) },
  ])(
    'closes an open recorded assessment detail dialog when parent request refresh resolves with $label',
    async ({ label, next }) => {
      const request = createRequestStatus({
        requestId: '22222222-2222-4222-8222-222222222222',
        jobStatus: 'SUCCEEDED',
        assessmentId: '11111111-1111-4111-8111-111111111111',
      });
      const record = {
        assessmentId: request.assessmentId!,
        requestId: request.requestId,
        siteId: request.siteId,
        eventId: request.eventId,
        cameraId: request.cameraId,
        zoneId: request.zoneId,
        capturedAt: request.capturedAt,
        assessedAt: '2026-10-12T10:00:03.000Z',
        purpose: request.purpose,
        outcome: 'UNAVAILABLE' as const,
        reasonCode: 'IDENTITY_UNAVAILABLE' as const,
        evaluatorVersion: 'SYNTHETIC_READ_V1',
        provenance: 'UNAVAILABLE' as const,
      };
      mockListMf06RequestStatuses
        .mockResolvedValueOnce(createRequestPage([request]))
        .mockImplementationOnce(next);
      Object.assign(mockClient, {
        getMf06Assessment: vi.fn().mockResolvedValue(record),
      });

      const { container, queries } = mount(() => (
        <Mf06ZoneAssessmentPanel
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
          initialTab="requests"
        />
      ));

      fireEvent.click(await screen.findByRole('button', { name: 'View assessment' }));
      const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
      expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();

      await act(async () => {
        await queries.invalidateQueries({ queryKey: ['mf06-requests'], refetchType: 'active' });
      });

      await waitFor(() => {
        expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(2);
      });
      if (label === '403') {
        expect(
          await screen.findByText('You do not have permission to view requests for this site.'),
        ).toBeTruthy();
      }
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
      });
      expect(container.textContent).not.toContain(request.assessmentId!);
    },
  );

  it('preserves an open recorded assessment detail dialog while parent request refresh is pending, then closes when the row is removed', async () => {
    const request = createRequestStatus({
      requestId: '22222222-2222-4222-8222-222222222222',
      jobStatus: 'SUCCEEDED',
      assessmentId: '11111111-1111-4111-8111-111111111111',
    });
    const record = {
      assessmentId: request.assessmentId!,
      requestId: request.requestId,
      siteId: request.siteId,
      eventId: request.eventId,
      cameraId: request.cameraId,
      zoneId: request.zoneId,
      capturedAt: request.capturedAt,
      assessedAt: '2026-10-12T10:00:03.000Z',
      purpose: request.purpose,
      outcome: 'UNAVAILABLE' as const,
      reasonCode: 'IDENTITY_UNAVAILABLE' as const,
      evaluatorVersion: 'SYNTHETIC_READ_V1',
      provenance: 'UNAVAILABLE' as const,
    };
    let resolveRefresh!: (page: Mf06RequestStatusPage) => void;
    const pendingRefresh = new Promise<Mf06RequestStatusPage>((resolve) => {
      resolveRefresh = resolve;
    });
    mockListMf06RequestStatuses
      .mockResolvedValueOnce(createRequestPage([request]))
      .mockImplementationOnce(() => pendingRefresh);
    Object.assign(mockClient, {
      getMf06Assessment: vi.fn().mockResolvedValue(record),
    });

    const { container, queries } = mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    fireEvent.click(await screen.findByRole('button', { name: 'View assessment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();

    act(() => {
      void queries.invalidateQueries({ queryKey: ['mf06-requests'], refetchType: 'active' });
    });

    await waitFor(() => {
      expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('dialog', { name: 'Recorded assessment' })).toBeTruthy();
    expect(within(dialog).getByText('Identity Unavailable')).toBeTruthy();

    await act(async () => {
      resolveRefresh(createRequestPage([], 0, 0, 20));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
    });
    expect(container.textContent).not.toContain(request.assessmentId!);
  });

  it('generates unique useId-based IDs for tabs and panels across multiple instances', () => {
    mount(() => (
      <div>
        <Mf06ZoneAssessmentPanel
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId="cred-1"
          client={mockClient}
        />
        <Mf06ZoneAssessmentPanel
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId="cred-2"
          client={mockClient}
        />
      </div>
    ));

    const tabs = screen.getAllByRole('tab', { name: 'Assessments' });
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.id).toBeTruthy();
    expect(tabs[1]!.id).toBeTruthy();
    expect(tabs[0]!.id).not.toBe(tabs[1]!.id);

    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(2);
    expect(panels[0]!.id).not.toBe(panels[1]!.id);
    expect(tabs[0]!.getAttribute('aria-controls')).toBe(panels[0]!.id);
    expect(tabs[1]!.getAttribute('aria-controls')).toBe(panels[1]!.id);
  });

  it('supports keyboard tab navigation with ArrowLeft, ArrowRight, Home, End and roving tabIndex', () => {
    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const assessmentsTab = screen.getByRole('tab', { name: 'Assessments' });
    const requestsTab = screen.getByRole('tab', { name: 'Requests' });

    expect(assessmentsTab.tabIndex).toBe(0);
    expect(requestsTab.tabIndex).toBe(-1);

    assessmentsTab.focus();
    fireEvent.keyDown(assessmentsTab, { key: 'ArrowRight' });

    expect(requestsTab.getAttribute('aria-selected')).toBe('true');
    expect(requestsTab.tabIndex).toBe(0);
    expect(assessmentsTab.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(requestsTab);

    fireEvent.keyDown(requestsTab, { key: 'ArrowLeft' });
    expect(assessmentsTab.getAttribute('aria-selected')).toBe('true');
    expect(assessmentsTab.tabIndex).toBe(0);
    expect(document.activeElement).toBe(assessmentsTab);

    fireEvent.keyDown(assessmentsTab, { key: 'End' });
    expect(requestsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(requestsTab);

    fireEvent.keyDown(requestsTab, { key: 'Home' });
    expect(assessmentsTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(assessmentsTab);
  });

  it('renders a busy status live region while refreshing settled empty requests instead of collapsing content', async () => {
    let resolveRefresh!: (page: Mf06RequestStatusPage) => void;
    const pendingRefresh = new Promise<Mf06RequestStatusPage>((resolve) => {
      resolveRefresh = resolve;
    });

    mockListMf06RequestStatuses
      .mockResolvedValueOnce(createRequestPage([], 0, 0, 20))
      .mockImplementationOnce(() => pendingRefresh);

    mount(() => (
      <Mf06ZoneAssessmentPanel
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
        initialTab="requests"
      />
    ));

    expect(await screen.findByText('No recorded assessment requests.')).toBeTruthy();
    const settledEmptyStatus = screen.getByRole('status');
    expect(settledEmptyStatus.getAttribute('aria-busy')).not.toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(mockListMf06RequestStatuses).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText('No recorded assessment requests.')).toBeNull();
    const refreshingStatus = screen.getByRole('status');
    expect(refreshingStatus.getAttribute('aria-live')).toBe('polite');
    expect(refreshingStatus.getAttribute('aria-busy')).toBe('true');
    expect(within(refreshingStatus).getByText('Loading assessment requests...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refreshing...' }).hasAttribute('disabled')).toBe(
      true,
    );

    await act(async () => {
      resolveRefresh(createRequestPage([], 0, 0, 20));
    });

    expect(await screen.findByText('No recorded assessment requests.')).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-busy')).not.toBe('true');
  });
});
