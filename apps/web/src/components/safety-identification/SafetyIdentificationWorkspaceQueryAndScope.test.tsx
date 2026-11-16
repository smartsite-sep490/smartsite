// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SafetyIdentificationRequest } from '@smartsite/api-client';
import i18n from '../../i18n';
import {
  API_URL,
  CONTRACTOR_1_ID,
  EVENT_2_ID,
  FORM_EN,
  FORM_VI,
  MANAGER_A_ID,
  MANAGER_A_TOKEN,
  MANAGER_B_ID,
  MANAGER_B_TOKEN,
  OFFICER_TOKEN,
  REQUEST_1_ID,
  REQUEST_2_ID,
  REQUEST_3_ID,
  SEGMENT_1_ID,
  SITE_A_ID,
  SITE_B_ID,
  WORKSPACE_EN,
  WORKSPACE_VI,
  atIndex,
  makeRequest,
  makeUuidForIndex,
  managerSession,
  type GetRequestArgs,
  type ListRequestsArgs,
} from './safetyIdentificationTestFixtures';
import {
  createTestQueryClient,
  openRequestRow,
  renderWorkspace,
  selectSiteInWorkspace,
  selectStatusInWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — queue pagination, Site/auth scope, i18n, and metadata-only evidence (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('supports explicit queue pagination and resets offset when filtering by SafetyIdentificationStatus', async () => {
    const spies = getSpies();

    spies.listRequests.mockImplementation(
      async (
        _token: ListRequestsArgs[0],
        siteId: ListRequestsArgs[1],
        options: NonNullable<ListRequestsArgs[2]> = {},
      ) => {
        const limit = options.limit ?? 20;
        const offset = options.offset ?? 0;
        const status = options.status;

        if (status === 'RESPONDED') {
          const respondedRow = makeRequest({
            id: REQUEST_2_ID,
            siteId,
            assignedTo: MANAGER_A_ID,
            status: 'RESPONDED',
            version: 2,
            reason: 'Responded queue row awaiting Officer decision',
            result: {
              outcome: 'PARTIAL',
              workerId: null,
              contractorId: CONTRACTOR_1_ID,
              reason: 'Contractor crew confirmed',
              evidenceRefs: [],
              respondedBy: MANAGER_A_ID,
              respondedAt: '2026-11-11T04:00:00.000Z',
            },
          });
          return { items: offset === 0 ? [respondedRow] : [], total: 1 };
        }

        if (status === 'CLOSED') {
          const closedRow = makeRequest({
            id: REQUEST_3_ID,
            siteId,
            assignedTo: MANAGER_A_ID,
            status: 'CLOSED',
            version: 3,
            reason: 'Closed identification record after Officer review',
          });
          return { items: offset === 0 ? [closedRow] : [], total: 1 };
        }

        const total = limit + 2;
        const count = Math.max(0, Math.min(limit, total - offset));
        const items = Array.from({ length: count }, (_, idx) => {
          const rowNumber = offset + idx + 1;
          return makeRequest({
            id: makeUuidForIndex(rowNumber),
            siteId,
            assignedTo: MANAGER_A_ID,
            status: 'OPEN',
            reason: `Paginated queue item #${rowNumber}`,
          });
        });
        return { items, total };
      },
    );

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    expect((await screen.findAllByText(/Paginated queue item #1\b/i)).length).toBeGreaterThan(0);

    const firstListCall = atIndex(spies.listRequests.mock.calls, 0, 'initial listRequests call');
    const configuredLimit = firstListCall[2]?.limit ?? 20;

    // Advance to page 2 via explicit Next page control.
    const nextButtons = await screen.findAllByRole('button', {
      name: WORKSPACE_EN.queue.nextPage,
    });
    const enabledNext = nextButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(enabledNext).toBeDefined();
    if (!enabledNext) throw new Error('Expected enabled queue Next button');
    fireEvent.click(enabledNext);

    await waitFor(() => {
      expect(spies.listRequests).toHaveBeenCalledWith(
        MANAGER_A_TOKEN,
        SITE_A_ID,
        expect.objectContaining({ offset: configuredLimit, limit: configuredLimit }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(
      (
        await screen.findAllByText(
          new RegExp(`Paginated queue item #${configuredLimit + 1}\\b`, 'i'),
        )
      ).length,
    ).toBeGreaterThan(0);

    // Filtering by status='RESPONDED' resets pagination offset back to 0 and queries exact status.
    selectStatusInWorkspace('RESPONDED');

    await waitFor(() => {
      expect(spies.listRequests).toHaveBeenCalledWith(
        MANAGER_A_TOKEN,
        SITE_A_ID,
        expect.objectContaining({ offset: 0, status: 'RESPONDED' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(
      (await screen.findAllByText(/Responded queue row awaiting Officer decision/i)).length,
    ).toBeGreaterThan(0);

    selectStatusInWorkspace('CLOSED');
    await waitFor(() => {
      expect(spies.listRequests).toHaveBeenCalledWith(
        MANAGER_A_TOKEN,
        SITE_A_ID,
        expect.objectContaining({ offset: 0, status: 'CLOSED' }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(
      (await screen.findAllByText(/Closed identification record after Officer review/i)).length,
    ).toBeGreaterThan(0);
  });

  it('aborts in-flight requests and clears selection, drafts, and old results on Site or auth switch without leaking raw tokens in query keys', async () => {
    const spies = getSpies();

    const siteARequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      reason: 'North Tower exclusive identification row',
    });
    // Assigned to current session Manager A on Site B so Site-switch draft clearing is verified under strict assignee enforcement.
    const siteBManagerARequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_B_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      reason: 'South Depot Manager A identification row',
    });
    // Separate fixture assigned to Manager B for the subsequent auth-rotation check.
    const siteBManagerBRequest = makeRequest({
      id: REQUEST_3_ID,
      siteId: SITE_B_ID,
      assignedTo: MANAGER_B_ID,
      status: 'OPEN',
      reason: 'South Depot Manager B rotated identification row',
    });

    const capturedSignals: Array<{ siteId: string; token: string; signal?: AbortSignal }> = [];
    let holdSiteADetailOpen = false;

    spies.listRequests.mockImplementation(
      async (
        token: ListRequestsArgs[0],
        siteId: ListRequestsArgs[1],
        _options?: ListRequestsArgs[2],
        requestOptions?: ListRequestsArgs[3],
      ) => {
        capturedSignals.push({ siteId, token, signal: requestOptions?.signal });
        if (siteId === SITE_A_ID) {
          return { items: [siteARequest], total: 1 };
        }
        if (siteId === SITE_B_ID) {
          return token === MANAGER_B_TOKEN
            ? { items: [siteBManagerBRequest], total: 1 }
            : { items: [siteBManagerARequest], total: 1 };
        }
        return { items: [], total: 0 };
      },
    );

    spies.getRequest.mockImplementation(
      (
        token: GetRequestArgs[0],
        siteId: GetRequestArgs[1],
        id: GetRequestArgs[2],
        requestOptions?: GetRequestArgs[3],
      ) => {
        capturedSignals.push({ siteId, token, signal: requestOptions?.signal });
        if (holdSiteADetailOpen && siteId === SITE_A_ID) {
          return new Promise<SafetyIdentificationRequest>(() => {
            // Intentionally stays pending so switching Site/auth must abort its AbortSignal.
          });
        }
        if (id === REQUEST_3_ID) {
          return Promise.resolve(siteBManagerBRequest);
        }
        if (id === REQUEST_2_ID) {
          return Promise.resolve(siteBManagerARequest);
        }
        return Promise.resolve(siteARequest);
      },
    );

    const queryClient = createTestQueryClient();
    const { rerenderWorkspace } = renderWorkspace(
      {
        apiUrl: API_URL,
        session: managerSession(
          MANAGER_A_ID,
          [SITE_A_ID, SITE_B_ID],
          MANAGER_A_TOKEN,
          'Tran Minh Quan',
        ),
        initialSiteId: SITE_A_ID,
      },
      { queryClient },
    );

    await openRequestRow(siteARequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    // Type a Manager draft on Site A, then start an in-flight refresh on Site A before switching to Site B.
    const siteADraft = 'Draft note typed only for North Tower Site';
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: siteADraft },
    });
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      siteADraft,
    );

    holdSiteADetailOpen = true;
    void queryClient.refetchQueries();

    const pendingSiteASignal = capturedSignals
      .filter((entry) => entry.siteId === SITE_A_ID && entry.signal && !entry.signal.aborted)
      .at(-1)?.signal;

    // Switch Site A -> Site B while still signed in as Manager A.
    selectSiteInWorkspace(SITE_B_ID);

    if (pendingSiteASignal) {
      await waitFor(() => {
        expect(pendingSiteASignal.aborted).toBe(true);
      });
    }

    await waitFor(() => {
      expect(spies.listRequests).toHaveBeenCalledWith(
        MANAGER_A_TOKEN,
        SITE_B_ID,
        expect.anything(),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    // Old Site A row and Site A draft must be gone; Manager A's assigned Site B row opens with an empty draft.
    expect(screen.queryByText(/North Tower exclusive identification row/i)).toBeNull();
    await openRequestRow(siteBManagerARequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      '',
    );

    // Rotate auth session (Manager A -> Manager B with new accessToken) and verify old results/drafts reset.
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Temporary Manager A draft on Site B' },
    });

    rerenderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_B_ID, [SITE_B_ID], MANAGER_B_TOKEN, 'Pham Quoc Bao'),
      initialSiteId: SITE_B_ID,
    });

    await waitFor(() => {
      expect(spies.listRequests).toHaveBeenCalledWith(
        MANAGER_B_TOKEN,
        SITE_B_ID,
        expect.anything(),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(screen.queryByText(/South Depot Manager A identification row/i)).toBeNull();
    await openRequestRow(siteBManagerBRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      '',
    );

    // Raw bearer tokens must NEVER appear inside TanStack Query cache keys.
    const serializedKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    for (const keyText of serializedKeys) {
      expect(keyText).not.toContain(MANAGER_A_TOKEN);
      expect(keyText).not.toContain(MANAGER_B_TOKEN);
      expect(keyText).not.toContain(OFFICER_TOKEN);
    }

    // Switching UI language to Vietnamese updates both workspace and form localized copy cleanly.
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(await screen.findByRole('heading', { name: FORM_VI.response.title })).toBeTruthy();
    expect(screen.getAllByText(WORKSPACE_VI.header.title).length).toBeGreaterThan(0);
  });

  it('renders explicit metadata-only evidence unavailable state without image fallback or media requests', async () => {
    const spies = getSpies();

    const trackedMetadataOnlyRequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      evidenceRefs: [],
      evidenceAvailability: {
        status: 'UNAVAILABLE',
        reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
      },
      subject: {
        kind: 'TRACKED',
        segmentId: SEGMENT_1_ID,
        scopeSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      reason: 'Tracked subject derivative unavailable verification case',
    });

    const eventLocalMetadataOnlyRequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      evidenceRefs: [],
      evidenceAvailability: {
        status: 'UNAVAILABLE',
        reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE',
      },
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: EVENT_2_ID,
        personObservationIndex: 2,
      },
      reason: 'Event-local subject derivative unavailable verification case',
    });

    spies.listRequests.mockResolvedValue({
      items: [trackedMetadataOnlyRequest, eventLocalMetadataOnlyRequest],
      total: 2,
    });
    spies.getRequest.mockImplementation(
      async (_token: GetRequestArgs[0], _siteId: GetRequestArgs[1], id: GetRequestArgs[2]) =>
        id === REQUEST_2_ID ? eventLocalMetadataOnlyRequest : trackedMetadataOnlyRequest,
    );

    const { container } = renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(trackedMetadataOnlyRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    // Explicit unavailable / metadata-only notice must be shown, with zero fallback <img> elements.
    expect(
      screen.getAllByText(WORKSPACE_EN.detail.evidenceUnavailableBadge).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(WORKSPACE_EN.detail.evidenceUnavailableBody).length).toBeGreaterThan(
      0,
    );
    expect(container.querySelectorAll('img').length).toBe(0);

    await openRequestRow(eventLocalMetadataOnlyRequest);
    expect(container.querySelectorAll('img').length).toBe(0);

    // Zero calls to any source-frame, alert-crop, or camera-reference media endpoints.
    expect(spies.readTrackedEpisodeMedia).not.toHaveBeenCalled();
    expect(spies.getSafetyAlertEvidence).not.toHaveBeenCalled();
    expect(spies.getCameraConfigurationImage).not.toHaveBeenCalled();
  });
});
