// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, type SafetyIdentificationRequest } from '@smartsite/api-client';
import {
  API_URL,
  FORM_EN,
  MANAGER_A_ID,
  MANAGER_A_TOKEN,
  REQUEST_1_ID,
  REQUEST_2_ID,
  SEGMENT_1_ID,
  SITE_A_ID,
  UUID_PATTERN,
  WORKSPACE_EN,
  atIndex,
  createDeferred,
  escapeRegExp,
  makeRequest,
  managerSession,
  type ChangeRequestArgs,
  type GetRequestArgs,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — idempotent command replay detail reconciliation (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('reconciles authoritative detail from GET after a replayed response instead of seeding the historical receipt, including read denial guards', async () => {
    const spies = getSpies();

    // 1) Replay when authoritative server state has already advanced past the historical receipt (v2 RESPONDED -> v3 CLOSED).
    const initialOpenV1 = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Verify crane signalman PPE observation before shift change',
    });

    const draftReason =
      'Signalman rotated to south yard before 08:10; unable to confirm from tower log';
    const historicalReceiptReason =
      'Historical v2 receipt snapshot that Officer already superseded';

    const historicalV2Receipt: SafetyIdentificationRequest = {
      ...initialOpenV1,
      status: 'RESPONDED',
      version: 2,
      result: {
        outcome: 'UNRESOLVED',
        workerId: null,
        contractorId: null,
        reason: historicalReceiptReason,
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-11T09:05:00.000Z',
      },
      updatedAt: '2026-11-11T09:05:00.000Z',
    };

    const authoritativeV3Closed: SafetyIdentificationRequest = {
      ...historicalV2Receipt,
      status: 'CLOSED',
      version: 3,
      result: {
        ...historicalV2Receipt.result!,
        reason: draftReason,
      },
      updatedAt: '2026-11-11T09:10:00.000Z',
    };

    let serverRequest: SafetyIdentificationRequest = initialOpenV1;
    const deferredReconcileGet = createDeferred<SafetyIdentificationRequest>();
    let interceptNextDetailGet = false;

    spies.listRequests.mockImplementation(async () => ({
      items: [serverRequest],
      total: 1,
    }));
    spies.getRequest.mockImplementation(
      async (_token: GetRequestArgs[0], _siteId: GetRequestArgs[1], id: GetRequestArgs[2]) => {
        if (id === REQUEST_1_ID && interceptNextDetailGet) {
          interceptNextDetailGet = false;
          return deferredReconcileGet.promise;
        }
        return serverRequest;
      },
    );

    spies.changeRequest
      .mockImplementationOnce(async () => {
        // Attempt 1 succeeded on backend and Officer subsequently accepted -> v3 CLOSED,
        // while Manager A's HTTP response was lost on the network.
        serverRequest = authoritativeV3Closed;
        throw new ApiError('network', 'Could not connect to the backend.');
      })
      .mockImplementationOnce(
        async (
          _token: ChangeRequestArgs[0],
          _siteId: ChangeRequestArgs[1],
          _id: ChangeRequestArgs[2],
          command: ChangeRequestArgs[3],
        ) => {
          if (command.action !== 'respond') {
            throw new Error('Expected respond command');
          }
          return { request: historicalV2Receipt, replayed: true };
        },
      );

    const { queryClient, unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(initialOpenV1);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    const reasonTextarea = screen.getByLabelText(
      FORM_EN.response.reasonLabel,
    ) as HTMLTextAreaElement;
    fireEvent.change(reasonTextarea, { target: { value: draftReason } });

    // Submit 1: network drop keeps draft and command receipt for retry.
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(reasonTextarea.value).toBe(draftReason);

    const firstCall = atIndex(spies.changeRequest.mock.calls, 0, 'first respond call');
    const firstCommand = firstCall[3];
    expect(firstCommand.input.commandId).toMatch(UUID_PATTERN);
    expect(firstCommand.input.expectedVersion).toBe(1);

    // Submit 2 (idempotent replay): reuses original commandId; backend returns historical v2 receipt.
    const getCallsBeforeReplay = spies.getRequest.mock.calls.length;
    interceptNextDetailGet = true;
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledTimes(2);
      expect(spies.getRequest.mock.calls.length).toBeGreaterThan(getCallsBeforeReplay);
    });

    const secondCall = atIndex(spies.changeRequest.mock.calls, 1, 'replayed respond call');
    const secondCommand = secondCall[3];
    expect(secondCommand.input.commandId).toBe(firstCommand.input.commandId);
    expect(secondCommand.input.expectedVersion).toBe(1);

    // Historical v2 receipt must NOT be seeded into cache or DOM while authoritative GET is reconciling.
    const cachedDetailSnapshots = queryClient
      .getQueriesData<SafetyIdentificationRequest>({ queryKey: [] })
      .map(([, data]) => data)
      .filter((data): data is SafetyIdentificationRequest =>
        Boolean(data && data.id === REQUEST_1_ID),
      );
    expect(cachedDetailSnapshots.some((item) => item.version === 2)).toBe(false);
    expect(screen.queryByText(historicalReceiptReason)).toBeNull();

    await act(async () => {
      deferredReconcileGet.resolve(authoritativeV3Closed);
    });

    // Reconciled detail panel shows authoritative CLOSED status and version 3, never historical v2 RESPONDED.
    expect(await screen.findByText(WORKSPACE_EN.detail.managerReadOnlyStatusNotice)).toBeTruthy();

    const detailPanel = screen.getByLabelText(WORKSPACE_EN.detail.title);
    const v3MetadataText = `${REQUEST_1_ID} · ${WORKSPACE_EN.queue.versionPrefix(3)}`;
    const v2MetadataText = `${REQUEST_1_ID} · ${WORKSPACE_EN.queue.versionPrefix(2)}`;

    expect(within(detailPanel).getByText(WORKSPACE_EN.filters.statuses.CLOSED)).toBeTruthy();
    expect(
      within(detailPanel).getByText(WORKSPACE_EN.waitingByStatus.CLOSED.nextAction),
    ).toBeTruthy();
    expect(
      within(detailPanel).getByText(new RegExp(escapeRegExp(v3MetadataText), 'i')),
    ).toBeTruthy();
    expect(
      within(detailPanel).queryByText(new RegExp(escapeRegExp(v2MetadataText), 'i')),
    ).toBeNull();
    expect(within(detailPanel).queryByText(historicalReceiptReason)).toBeNull();
    expect(within(detailPanel).getByText(draftReason)).toBeTruthy();

    unmount();

    // 2) Replay followed by 403 read denial on authoritative GET clears stale detail through existing guards.
    const scopeHash = '5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e';
    const segmentIdPattern = new RegExp(escapeRegExp(SEGMENT_1_ID), 'i');
    const scopeHashPattern = new RegExp(escapeRegExp(scopeHash), 'i');
    const deniedTargetV1 = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      subject: {
        kind: 'TRACKED',
        segmentId: SEGMENT_1_ID,
        scopeSha256: scopeHash,
      },
      reason: 'Request reassigned away before Manager response replay reconciles',
    });
    const deniedHistoricalV2: SafetyIdentificationRequest = {
      ...deniedTargetV1,
      status: 'RESPONDED',
      version: 2,
      result: {
        outcome: 'UNRESOLVED',
        workerId: null,
        contractorId: null,
        reason: 'Historical v2 proposal that must not surface when GET is 403',
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-11T09:30:00.000Z',
      },
    };

    let denyReadAfterLoss = false;
    spies.listRequests.mockImplementation(async () =>
      denyReadAfterLoss ? { items: [], total: 0 } : { items: [deniedTargetV1], total: 1 },
    );
    spies.getRequest.mockImplementation(async () => {
      if (denyReadAfterLoss) {
        throw new ApiError('http', 'Forbidden', 403);
      }
      return deniedTargetV1;
    });
    spies.changeRequest
      .mockImplementationOnce(async () => {
        denyReadAfterLoss = true;
        throw new ApiError('network', 'Could not connect to the backend.');
      })
      .mockResolvedValueOnce({ request: deniedHistoricalV2, replayed: true });

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(deniedTargetV1);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Retry response before discovering reassignment denial' },
    });

    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(screen.queryByLabelText(WORKSPACE_EN.detail.title)).toBeNull();
    });
    expect(screen.queryByRole('heading', { name: FORM_EN.response.title })).toBeNull();
    expect(screen.queryAllByText(segmentIdPattern)).toHaveLength(0);
    expect(screen.queryAllByText(scopeHashPattern)).toHaveLength(0);
    expect(
      screen.queryByText('Historical v2 proposal that must not surface when GET is 403'),
    ).toBeNull();
  });
});
