// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type SafetyIdentificationHistoryEntry,
  type SafetyIdentificationMutation,
} from '@smartsite/api-client';
import {
  API_URL,
  CONTRACTOR_1_ID,
  EPISODE_1_ID,
  EVENT_2_ID,
  FORM_EN,
  MANAGER_A_ID,
  MANAGER_A_TOKEN,
  OFFICER_ID,
  OFFICER_TOKEN,
  REQUEST_1_ID,
  REQUEST_2_ID,
  SEGMENT_1_ID,
  SITE_A_ID,
  SITE_B_ID,
  WORKSPACE_EN,
  createDeferred,
  escapeRegExp,
  makeRequest,
  managerSession,
  officerSession,
  type GetRequestArgs,
  type ListRequestsArgs,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — 403/404 revocation and cross-Site pending mutation isolation (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('clears stale subject, actions, and Officer history when detail or queue base refetch returns 403 after an authorized request was displayed', async () => {
    const spies = getSpies();
    const scopeHash = '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d';
    const segmentIdPattern = new RegExp(escapeRegExp(SEGMENT_1_ID), 'i');
    const scopeHashPattern = new RegExp(escapeRegExp(scopeHash), 'i');
    const respondedRequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      episodeId: EPISODE_1_ID,
      assignedTo: MANAGER_A_ID,
      requestedBy: OFFICER_ID,
      status: 'RESPONDED',
      version: 2,
      subject: {
        kind: 'TRACKED',
        segmentId: SEGMENT_1_ID,
        scopeSha256: scopeHash,
      },
      reason: 'Authorized request before 403 detail refetch',
      result: {
        outcome: 'PARTIAL',
        workerId: null,
        contractorId: CONTRACTOR_1_ID,
        reason: 'Initial contractor proposal before 403',
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-11T07:00:00.000Z',
      },
    });

    const historyEntry: SafetyIdentificationHistoryEntry = {
      version: 1,
      kind: 'CREATE',
      actorId: OFFICER_ID,
      assignedTo: MANAGER_A_ID,
      reason: 'Sensitive Officer history entry before 403',
      proposal: null,
      recordedAt: '2026-11-11T06:50:00.000Z',
    };

    spies.listRequests.mockResolvedValue({ items: [respondedRequest], total: 1 });
    spies.getRequest.mockResolvedValue(respondedRequest);
    spies.listHistory.mockResolvedValue({ items: [historyEntry], total: 1 });

    // 1) Detail base refetch returns 403 while queue cache still holds respondedRequest.
    const { unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_A_ID], OFFICER_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(respondedRequest);
    const detailPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);
    const technicalDetails: HTMLElement = detailPanel.querySelector('details') ?? detailPanel;
    expect(within(technicalDetails).getAllByText(segmentIdPattern).length).toBeGreaterThan(0);
    expect(within(technicalDetails).getAllByText(scopeHashPattern).length).toBeGreaterThan(0);
    expect(within(detailPanel).getByText('Initial contractor proposal before 403')).toBeTruthy();
    expect(
      within(detailPanel).getByRole('button', { name: WORKSPACE_EN.detail.acceptButton }),
    ).toBeTruthy();
    expect(
      within(detailPanel).getByRole('button', { name: WORKSPACE_EN.detail.returnButton }),
    ).toBeTruthy();
    expect(
      within(detailPanel).getByRole('button', { name: WORKSPACE_EN.detail.reassignToggle }),
    ).toBeTruthy();
    expect(
      within(detailPanel).getByRole('button', { name: WORKSPACE_EN.detail.cancelToggle }),
    ).toBeTruthy();
    expect(
      await within(detailPanel).findByText('Sensitive Officer history entry before 403'),
    ).toBeTruthy();

    spies.getRequest.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
    fireEvent.click(
      within(detailPanel).getByRole('button', { name: WORKSPACE_EN.detail.refreshLabel }),
    );

    await waitFor(() => {
      expect(screen.queryByLabelText(WORKSPACE_EN.detail.title)).toBeNull();
    });
    expect(screen.queryAllByText(segmentIdPattern)).toHaveLength(0);
    expect(screen.queryAllByText(scopeHashPattern)).toHaveLength(0);
    expect(screen.queryByText('Initial contractor proposal before 403')).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.acceptButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.returnButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.reassignToggle })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.cancelToggle })).toBeNull();
    expect(screen.queryByText(WORKSPACE_EN.detail.historyTitle)).toBeNull();
    expect(screen.queryByText('Sensitive Officer history entry before 403')).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);

    unmount();

    // 2) Queue base refetch returns 403 after request detail, actions, and history were displayed.
    const queueTargetRequest = makeRequest({
      ...respondedRequest,
      reason: 'Authorized request before 403 queue refetch',
    });
    spies.listRequests.mockResolvedValue({ items: [queueTargetRequest], total: 1 });
    spies.getRequest.mockResolvedValue(queueTargetRequest);
    spies.listHistory.mockResolvedValue({ items: [historyEntry], total: 1 });

    renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_A_ID], OFFICER_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(queueTargetRequest);
    const secondDetailPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);
    const secondTechnicalDetails: HTMLElement =
      secondDetailPanel.querySelector('details') ?? secondDetailPanel;
    expect(within(secondTechnicalDetails).getAllByText(segmentIdPattern).length).toBeGreaterThan(0);
    expect(within(secondTechnicalDetails).getAllByText(scopeHashPattern).length).toBeGreaterThan(0);
    expect(
      within(secondDetailPanel).getByRole('button', { name: WORKSPACE_EN.detail.acceptButton }),
    ).toBeTruthy();
    expect(
      await within(secondDetailPanel).findByText('Sensitive Officer history entry before 403'),
    ).toBeTruthy();

    spies.listRequests.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
    fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.header.refreshQueue }));

    await waitFor(() => {
      expect(screen.queryByText('Authorized request before 403 queue refetch')).toBeNull();
    });
    expect(screen.queryByLabelText(WORKSPACE_EN.detail.title)).toBeNull();
    expect(screen.queryAllByText(segmentIdPattern)).toHaveLength(0);
    expect(screen.queryAllByText(scopeHashPattern)).toHaveLength(0);
    expect(screen.queryByText('Initial contractor proposal before 403')).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.acceptButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.returnButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.reassignToggle })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.cancelToggle })).toBeNull();
    expect(screen.queryByText(WORKSPACE_EN.detail.historyTitle)).toBeNull();
    expect(screen.queryByText('Sensitive Officer history entry before 403')).toBeNull();
    expect(screen.getByText(WORKSPACE_EN.detail.emptyTitle)).toBeTruthy();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('prevents delayed mutation success or error from an earlier Site after initialSiteId prop switches to a new Site', async () => {
    const spies = getSpies();
    const siteARequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Site A request with pending mutation before initialSiteId switch',
    });
    const siteBRequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_B_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Site B request active after initialSiteId prop switch',
    });

    spies.listRequests.mockImplementation(
      async (_token: ListRequestsArgs[0], siteId: ListRequestsArgs[1]) => ({
        items: siteId === SITE_B_ID ? [siteBRequest] : [siteARequest],
        total: 1,
      }),
    );
    spies.getRequest.mockImplementation(
      async (_token: GetRequestArgs[0], siteId: GetRequestArgs[1], id: GetRequestArgs[2]) =>
        siteId === SITE_B_ID || id === REQUEST_2_ID ? siteBRequest : siteARequest,
    );

    // Part A: Delayed success from Site A after initialSiteId switches to Site B.
    const deferredSiteASuccess = createDeferred<SafetyIdentificationMutation>();
    spies.changeRequest.mockImplementationOnce(() => deferredSiteASuccess.promise);

    const dualSiteManager = managerSession(
      MANAGER_A_ID,
      [SITE_A_ID, SITE_B_ID],
      MANAGER_A_TOKEN,
      'Tran Minh Quan',
    );

    const { rerenderWorkspace, unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: dualSiteManager,
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(siteARequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Site A response submitted just before prop switch' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    // Confirm Site A mutation is in flight.
    expect(
      await screen.findByRole('button', { name: FORM_EN.response.submittingLabel }),
    ).toBeTruthy();

    // Switch initialSiteId prop to Site B while Site A mutation is still pending.
    rerenderWorkspace({
      apiUrl: API_URL,
      session: dualSiteManager,
      initialSiteId: SITE_B_ID,
    });

    await waitFor(() => {
      expect(
        (screen.getByLabelText(WORKSPACE_EN.filters.siteLabel) as HTMLSelectElement).value,
      ).toBe(SITE_B_ID);
    });

    await openRequestRow(siteBRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    // Site B must NOT inherit Site A's pending state.
    const siteBSubmitBefore = screen.getByRole('button', {
      name: FORM_EN.response.submitLabel,
    }) as HTMLButtonElement;
    expect(siteBSubmitBefore.disabled).toBe(false);

    const siteBDraft = 'Site B active draft untouched by delayed Site A completion';
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: siteBDraft },
    });

    // Resolve delayed Site A mutation: must NOT hijack Site B selection, draft, or pending state.
    await act(async () => {
      deferredSiteASuccess.resolve({
        request: { ...siteARequest, status: 'RESPONDED', version: 2 },
        replayed: false,
      });
    });

    expect((screen.getByLabelText(WORKSPACE_EN.filters.siteLabel) as HTMLSelectElement).value).toBe(
      SITE_B_ID,
    );
    expect(screen.getAllByText(siteBRequest.reason).length).toBeGreaterThan(0);
    expect(screen.queryByText(siteARequest.reason)).toBeNull();
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      siteBDraft,
    );
    expect(
      (screen.getByRole('button', { name: FORM_EN.response.submitLabel }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    unmount();

    // Part B: Delayed 409 error from Site A while Site B has its own draft and pending mutation.
    const deferredSiteAError = createDeferred<SafetyIdentificationMutation>();
    const deferredSiteBPending = createDeferred<SafetyIdentificationMutation>();
    spies.changeRequest
      .mockImplementationOnce(() => deferredSiteAError.promise)
      .mockImplementationOnce(() => deferredSiteBPending.promise);

    const secondRender = renderWorkspace({
      apiUrl: API_URL,
      session: dualSiteManager,
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(siteARequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Site A response that will reject with 409 after prop switch' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    expect(
      await screen.findByRole('button', { name: FORM_EN.response.submittingLabel }),
    ).toBeTruthy();

    secondRender.rerenderWorkspace({
      apiUrl: API_URL,
      session: dualSiteManager,
      initialSiteId: SITE_B_ID,
    });

    await openRequestRow(siteBRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    const siteBPendingDraft = 'Site B in-flight draft isolated from Site A 409';
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: siteBPendingDraft },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    expect(
      await screen.findByRole('button', { name: FORM_EN.response.submittingLabel }),
    ).toBeTruthy();

    // Reject delayed Site A mutation with 409: must NOT clear Site B pending state or conflict-lock Site B.
    await act(async () => {
      deferredSiteAError.reject(
        new ApiError('http', 'Identification request version changed', 409),
      );
    });

    expect(screen.getByRole('button', { name: FORM_EN.response.submittingLabel })).toBeTruthy();
    expect(screen.queryByText(WORKSPACE_EN.detail.conflictBannerTitle)).toBeNull();
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      siteBPendingDraft,
    );

    // Complete Site B's own mutation cleanly.
    await act(async () => {
      deferredSiteBPending.resolve({
        request: {
          ...siteBRequest,
          status: 'RESPONDED',
          version: 2,
          result: {
            outcome: 'UNRESOLVED',
            workerId: null,
            contractorId: null,
            reason: siteBPendingDraft,
            evidenceRefs: [],
            respondedBy: MANAGER_A_ID,
            respondedAt: '2026-11-11T08:00:00.000Z',
          },
        },
        replayed: false,
      });
    });

    expect(await screen.findByText(WORKSPACE_EN.detail.managerReadOnlyStatusNotice)).toBeTruthy();
  });

  it('hides the denied request subject, form, and actions while keeping other queue rows when Manager response mutation returns 403 or 404, and restores on explicit reload', async () => {
    const spies = getSpies();
    const scopeHash = '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b';
    const segmentIdPattern = new RegExp(escapeRegExp(SEGMENT_1_ID), 'i');
    const scopeHashPattern = new RegExp(escapeRegExp(scopeHash), 'i');

    const targetRequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      subject: {
        kind: 'TRACKED',
        segmentId: SEGMENT_1_ID,
        scopeSha256: scopeHash,
      },
      reason: 'Target request revoked during Manager response submit',
    });
    const siblingRequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: EVENT_2_ID,
        personObservationIndex: 1,
      },
      reason: 'Other assigned queue row stays visible after scoped denial',
    });

    let deniedStatus: 403 | 404 | null = null;

    spies.listRequests.mockResolvedValue({ items: [targetRequest, siblingRequest], total: 2 });
    spies.getRequest.mockImplementation(
      async (_token: GetRequestArgs[0], _siteId: GetRequestArgs[1], id: GetRequestArgs[2]) => {
        if (id === REQUEST_1_ID && deniedStatus !== null) {
          throw new ApiError(
            'http',
            deniedStatus === 403 ? 'Forbidden' : 'Not found',
            deniedStatus,
          );
        }
        return id === REQUEST_2_ID ? siblingRequest : targetRequest;
      },
    );
    spies.changeRequest.mockImplementation(async () => {
      const status = deniedStatus ?? 403;
      throw new ApiError('http', status === 403 ? 'Forbidden' : 'Not found', status);
    });

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(targetRequest);
    const detailPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);
    const technicalDetails: HTMLElement = detailPanel.querySelector('details') ?? detailPanel;
    expect(within(technicalDetails).getAllByText(segmentIdPattern).length).toBeGreaterThan(0);
    expect(within(technicalDetails).getAllByText(scopeHashPattern).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: FORM_EN.response.title })).toBeTruthy();
    expect(screen.getByText(siblingRequest.reason)).toBeTruthy();

    // 1) Manager submits response -> HTTP 403: target subject/form/actions disappear while sibling queue row remains.
    deniedStatus = 403;
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Response rejected with 403 after reassignment' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: FORM_EN.response.title })).toBeNull();
    });
    expect(screen.queryByLabelText(WORKSPACE_EN.detail.title)).toBeNull();
    expect(screen.queryAllByText(segmentIdPattern)).toHaveLength(0);
    expect(screen.queryAllByText(scopeHashPattern)).toHaveLength(0);
    expect(screen.queryByLabelText(FORM_EN.response.reasonLabel)).toBeNull();
    expect(screen.queryByRole('button', { name: FORM_EN.response.submitLabel })).toBeNull();
    expect(screen.getByText(siblingRequest.reason)).toBeTruthy();

    // 2) Explicit successful reload restores the request detail and response form.
    deniedStatus = null;
    const detailReloadBtn =
      screen.queryByRole('button', { name: WORKSPACE_EN.queue.retryLabel }) ??
      screen.queryByRole('button', { name: WORKSPACE_EN.detail.refreshLabel }) ??
      screen.queryByRole('button', { name: WORKSPACE_EN.detail.conflictRefreshButton });
    if (detailReloadBtn) {
      fireEvent.click(detailReloadBtn);
    } else {
      fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.header.refreshQueue }));
      await openRequestRow(siblingRequest);
      await openRequestRow(targetRequest);
    }

    const restoredPanel = await screen.findByLabelText(WORKSPACE_EN.detail.title);
    const restoredTechnical: HTMLElement = restoredPanel.querySelector('details') ?? restoredPanel;
    expect(within(restoredTechnical).getAllByText(segmentIdPattern).length).toBeGreaterThan(0);
    expect(await screen.findByRole('heading', { name: FORM_EN.response.title })).toBeTruthy();

    // 3) Manager submits response -> HTTP 404: target subject/form/actions disappear again while sibling row remains.
    deniedStatus = 404;
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Response rejected with 404 for missing request' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: FORM_EN.response.title })).toBeNull();
    });
    expect(screen.queryByLabelText(WORKSPACE_EN.detail.title)).toBeNull();
    expect(screen.queryAllByText(segmentIdPattern)).toHaveLength(0);
    expect(screen.queryAllByText(scopeHashPattern)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: FORM_EN.response.submitLabel })).toBeNull();
    expect(screen.getByText(siblingRequest.reason)).toBeTruthy();
  });
});
