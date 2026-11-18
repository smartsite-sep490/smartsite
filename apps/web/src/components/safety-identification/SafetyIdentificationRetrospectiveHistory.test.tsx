// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import {
  API_URL,
  MANAGER_A_ID,
  REQUEST_2_ID,
  SITE_A_ID,
  SITE_B_ID,
  WORKER_1_ID,
  createDeferred,
  makeRequest,
  managerSession,
  officerSession,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  selectSiteInWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

const request = makeRequest({
  status: 'CLOSED',
  version: 3,
  result: {
    outcome: 'IDENTIFIED',
    workerId: WORKER_1_ID,
    contractorId: null,
    evidenceRefs: [],
    respondedBy: MANAGER_A_ID,
    respondedAt: '2026-11-17T09:00:00.000Z',
    reason: 'Supervisor confirmed the subject',
  },
});

describe('MF06 retrospective history in the C02 workspace', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  function showClosedCase() {
    getSpies().listRequests.mockResolvedValue({ items: [request], total: 1 });
    getSpies().getRequest.mockResolvedValue(request);
  }

  it('loads the selected C02 case on demand and shows original and retrospective outcomes', async () => {
    showClosedCase();
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            requestId: 'review-1',
            initialRequestId: 'initial-1',
            cameraId: 'camera-1',
            zoneId: 'zone-1',
            identificationVersion: 3,
            capturedAt: '2026-11-17T09:00:00.123456Z',
            status: 'ALLOWED',
            reasonCode: 'AUTHORIZED',
            originalOutcome: 'UNAVAILABLE',
          },
        ],
        total: 1,
      }),
    );
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    const show = await screen.findByRole('button', { name: 'View zone reassessments' });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(show);
    const section = await screen.findByRole('region', { name: 'Zone reassessments' });
    expect(await within(section).findByText('Access authorized')).toBeTruthy();
    expect(within(section).getByText('Original assessment')).toBeTruthy();
    expect(within(section).getByText('Unable to assess')).toBeTruthy();
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `/sites/${SITE_A_ID}/safety-identification-requests/${request.id}/retrospective-assessments`,
    );
  });

  it('keeps reassessment history out of the site manager view', async () => {
    showClosedCase();
    renderWorkspace({ apiUrl: API_URL, session: managerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    await screen.findByText(request.result!.reason);
    expect(screen.queryByRole('button', { name: 'View zone reassessments' })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requires an explicit choice and reuses the same command after a failed response', async () => {
    showClosedCase();
    const initialRequestId = '140e8400-e29b-41d4-a716-446655441100';
    const commands: Record<string, unknown>[] = [];
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/retrospective-assessment-options')) {
        return Response.json({
          episodeId: request.episodeId,
          identificationVersion: 3,
          items:
            commands.length >= 2
              ? []
              : [
                  {
                    initialRequestId,
                    cameraName: 'Gate camera',
                    zoneName: 'Loading bay',
                    capturedAt: '2026-11-17T09:00:00.123456Z',
                  },
                ],
        });
      }
      if (path.endsWith('/retrospective-assessment')) {
        expect(init?.method).toBe('POST');
        commands.push(JSON.parse(String(init?.body)));
        if (commands.length === 1) throw new Error('Connection lost');
        return Response.json({ requestId: 'review-queued' }, { status: 202 });
      }
      return Response.json({ items: [], total: 0 });
    });
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));
    const select = await screen.findByRole('combobox', { name: 'Zone entry to reassess' });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Request reassessment' });
    expect(submit.disabled).toBe(true);
    expect(commands).toHaveLength(0);
    fireEvent.change(select, { target: { value: initialRequestId } });
    fireEvent.click(submit);
    await screen.findByText('Could not request reassessment. You can retry.');
    fireEvent.click(submit);
    await screen.findByText('Reassessment queued.');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toMatchObject({
      commandId: expect.any(String),
      initialRequestId,
      identificationVersion: 3,
      episodeId: request.episodeId,
    });
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Zone entry to reassess' })).toBeNull(),
    );
  });

  it('removes cached results when refresh reports that the officer lost access', async () => {
    showClosedCase();
    let denied = false;
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
      if (denied)
        return Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
      if (String(url).includes('retrospective-assessment-options')) {
        return Response.json({ episodeId: request.episodeId, identificationVersion: 3, items: [] });
      }
      return Response.json({
        items: [
          {
            requestId: 'review-1',
            initialRequestId: 'initial-1',
            cameraId: 'camera-1',
            zoneId: 'zone-1',
            cameraName: 'Sensitive camera',
            zoneName: 'Sensitive zone',
            identificationVersion: 3,
            capturedAt: '2026-11-17T09:00:00.123456Z',
            status: 'ALLOWED',
            reasonCode: 'AUTHORIZED',
            originalOutcome: 'UNAVAILABLE',
          },
        ],
        total: 1,
      });
    });
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));
    const section = await screen.findByRole('region', { name: 'Zone reassessments' });
    await within(section).findByText('Access authorized');
    denied = true;
    fireEvent.click(within(section).getByRole('button', { name: 'Refresh' }));
    await within(section).findByText('Could not load zone reassessments.');
    expect(within(section).queryByText('Access authorized')).toBeNull();
    expect(within(section).queryByText(/Sensitive camera/)).toBeNull();
  });

  it('auto-refreshes queued and in-progress reassessments in the foreground until terminal, then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      showClosedCase();
      const initialRequestId = '140e8400-e29b-41d4-a716-446655441101';
      let submitted = false;
      let historyReadsAfterSubmit = 0;

      vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/retrospective-assessment-options')) {
          return Response.json({
            episodeId: request.episodeId,
            identificationVersion: 3,
            items: submitted
              ? []
              : [
                  {
                    initialRequestId,
                    cameraName: 'North crane cam',
                    zoneName: 'Restricted hoist bay',
                    capturedAt: '2026-11-17T09:00:00.123456Z',
                  },
                ],
          });
        }
        if (path.endsWith('/retrospective-assessment') && init?.method === 'POST') {
          submitted = true;
          return Response.json(
            { requestId: '140e8400-e29b-41d4-a716-446655441199' },
            { status: 202 },
          );
        }
        if (!submitted) {
          return Response.json({ items: [], total: 0 });
        }
        historyReadsAfterSubmit += 1;
        const stage =
          historyReadsAfterSubmit === 1
            ? { status: 'PENDING', reasonCode: null }
            : historyReadsAfterSubmit === 2
              ? { status: 'CLAIMED', reasonCode: null }
              : { status: 'DENIED', reasonCode: 'POLICY_PROHIBITED' };
        return Response.json({
          items: [
            {
              requestId: '140e8400-e29b-41d4-a716-446655441199',
              initialRequestId,
              cameraId: '770e8400-e29b-41d4-a716-446655440707',
              zoneId: '880e8400-e29b-41d4-a716-446655440777',
              cameraName: 'North crane cam',
              zoneName: 'Restricted hoist bay',
              identificationVersion: 3,
              capturedAt: '2026-11-17T09:00:00.123456Z',
              status: stage.status,
              reasonCode: stage.reasonCode,
              originalOutcome: 'UNAVAILABLE',
            },
          ],
          total: 1,
        });
      });

      renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
      await openRequestRow(request);
      fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));

      const select = await screen.findByRole('combobox', { name: 'Zone entry to reassess' });
      fireEvent.change(select, { target: { value: initialRequestId } });
      fireEvent.click(screen.getByRole('button', { name: 'Request reassessment' }));

      const section = await screen.findByRole('region', { name: 'Zone reassessments' });
      expect(await within(section).findByText('Queued')).toBeTruthy();
      expect(within(section).queryByText(/140e8400/i)).toBeNull();
      expect(within(section).queryByText(/POLICY_PROHIBITED/)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(await within(section).findByText('In progress')).toBeTruthy();

      // Pause foreground polling while document is hidden.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      const readsWhileHidden = historyReadsAfterSubmit;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(historyReadsAfterSubmit).toBe(readsWhileHidden);

      // Returning to foreground resumes and lands terminal policy-specific outcome vs original result.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(await within(section).findByText('Entry prohibited for everyone')).toBeTruthy();
      expect(within(section).getByText('Original assessment')).toBeTruthy();
      expect(within(section).getByText('Unable to assess')).toBeTruthy();

      // Once terminal, no further polling occurs.
      const readsAtTerminal = historyReadsAfterSubmit;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      expect(historyReadsAfterSubmit).toBe(readsAtTerminal);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      vi.useRealTimers();
    }
  });

  it('stops polling and clears restricted history/options cache on 401/403/404 without leaking across site switches', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const siteBRequest = makeRequest({
        id: REQUEST_2_ID,
        siteId: SITE_B_ID,
        status: 'CLOSED',
        version: 3,
        reason: 'Site B closed identification case',
        result: request.result,
      });
      getSpies().listRequests.mockImplementation(async (_token, siteId) => ({
        items: siteId === SITE_B_ID ? [siteBRequest] : [request],
        total: 1,
      }));
      getSpies().getRequest.mockImplementation(async (_token, siteId) =>
        siteId === SITE_B_ID ? siteBRequest : request,
      );

      let pollStatus: 200 | 401 = 200;
      let historyCalls = 0;
      const onSignOut = vi.fn();

      vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
        const path = new URL(String(url)).pathname;
        if (path.includes(`/sites/${SITE_B_ID}/`)) {
          return Response.json({ items: [], total: 0 });
        }
        if (path.endsWith('/retrospective-assessment-options')) {
          return Response.json({
            episodeId: request.episodeId,
            identificationVersion: 3,
            items: [
              {
                initialRequestId: '140e8400-e29b-41d4-a716-446655441102',
                cameraName: 'Secret Site A camera',
                zoneName: 'Secret Site A zone',
                capturedAt: '2026-11-17T09:00:00.123456Z',
              },
            ],
          });
        }
        historyCalls += 1;
        if (pollStatus === 401) {
          return Response.json({ code: 'UNAUTHORIZED', message: 'Expired' }, { status: 401 });
        }
        return Response.json({
          items: [
            {
              requestId: '140e8400-e29b-41d4-a716-446655441200',
              initialRequestId: '140e8400-e29b-41d4-a716-446655441102',
              cameraId: '770e8400-e29b-41d4-a716-446655440707',
              zoneId: '880e8400-e29b-41d4-a716-446655440777',
              cameraName: 'Pending Site A camera',
              zoneName: 'Pending Site A zone',
              identificationVersion: 3,
              capturedAt: '2026-11-17T09:00:00.123456Z',
              status: 'PENDING',
              reasonCode: null,
              originalOutcome: 'UNAVAILABLE',
            },
          ],
          total: 1,
        });
      });

      const { queryClient } = renderWorkspace({
        apiUrl: API_URL,
        session: officerSession([SITE_A_ID, SITE_B_ID]),
        initialSiteId: SITE_A_ID,
        onSignOut,
      });
      await openRequestRow(request);
      fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));
      const section = await screen.findByRole('region', { name: 'Zone reassessments' });
      expect(await within(section).findByText('Queued')).toBeTruthy();
      expect(
        within(section).getByRole('combobox', { name: 'Zone entry to reassess' }),
      ).toBeTruthy();

      // Hard 401 on poll triggers workspace onSignOut, purges cached entries/options, and stops polling.
      pollStatus = 401;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
      });
      await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
      expect(within(section).queryByText(/Pending Site A zone/)).toBeNull();
      expect(
        within(section).queryByRole('combobox', { name: 'Zone entry to reassess' }),
      ).toBeNull();
      expect(
        queryClient
          .getQueriesData({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              (q.queryKey.includes('zone-reassessments') ||
                q.queryKey.includes('zone-reassessment-options')),
          })
          .every(([, data]) => data === undefined),
      ).toBe(true);

      const callsAfterDenial = historyCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(historyCalls).toBe(callsAfterDenial);

      // Switching to Site B resets panel and never leaks Site A data.
      pollStatus = 200;
      selectSiteInWorkspace(SITE_B_ID);
      await openRequestRow(siteBRequest);
      expect(screen.queryByRole('region', { name: 'Zone reassessments' })).toBeNull();
      expect(screen.queryByText(/Pending Site A/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prevents duplicate submissions while pending, never shows success on failure, and renders Vietnamese states cleanly', async () => {
    await i18n.changeLanguage('vi');
    showClosedCase();
    const initialRequestId = '140e8400-e29b-41d4-a716-446655441103';
    const postGate = createDeferred<Response>();
    let postCount = 0;

    vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/retrospective-assessment-options')) {
        return Response.json({
          episodeId: request.episodeId,
          identificationVersion: 3,
          items: [
            {
              initialRequestId,
              cameraName: 'Camera cổng Bắc',
              zoneName: 'Khu cẩu tháp',
              capturedAt: '2026-11-17T09:00:00.123456Z',
            },
          ],
        });
      }
      if (path.endsWith('/retrospective-assessment') && init?.method === 'POST') {
        postCount += 1;
        return postGate.promise;
      }
      return Response.json({ items: [], total: 0 });
    });

    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    fireEvent.click(await screen.findByRole('button', { name: 'Xem lịch sử đánh giá lại' }));

    const select = await screen.findByRole('combobox', {
      name: 'Lượt vào vùng cần đánh giá lại',
    });
    fireEvent.change(select, { target: { value: initialRequestId } });
    const form = select.closest('form')!;

    // Synchronous double-submit in the same tick must only send one POST.
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(postCount).toBeGreaterThan(0));
    expect(postCount).toBe(1);

    await act(async () => {
      postGate.reject(new Error('Network down'));
    });

    const section = screen.getByRole('region', {
      name: 'Lịch sử đánh giá lại quyền vào vùng',
    });
    expect(
      await within(section).findByText('Chưa gửi được yêu cầu. Bạn có thể thử lại.'),
    ).toBeTruthy();
    expect(within(section).queryByText('Đã gửi yêu cầu đánh giá lại.')).toBeNull();
  });
});
