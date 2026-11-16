// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  type SafetyIdentificationHistoryEntry,
  type SafetyIdentificationHistoryPage,
} from '@smartsite/api-client';
import {
  API_URL,
  CONTRACTOR_1_ID,
  EPISODE_1_ID,
  FORM_EN,
  MANAGER_A_ID,
  MANAGER_A_TOKEN,
  MANAGER_B_ID,
  OFFICER_ID,
  OFFICER_TOKEN,
  REQUEST_1_ID,
  REQUEST_2_ID,
  REQUEST_3_ID,
  SITE_A_ID,
  UUID_PATTERN,
  WORKER_1_ID,
  WORKSPACE_EN,
  atIndex,
  makeHistoryEntry,
  makeRequest,
  managerSession,
  officerSession,
  type ChangeRequestArgs,
  type ListHistoryArgs,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
  submitOfficerCancel,
  submitOfficerReassign,
  submitOfficerReview,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — Officer review lifecycle, history, and 409/retry safety (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('loads Officer-only history with pagination and exercises RETURN, REASSIGN, ACCEPT, and CANCEL while keeping incident/identity facts separate', async () => {
    const spies = getSpies();
    let activeRequest = makeRequest({
      id: REQUEST_2_ID,
      siteId: SITE_A_ID,
      episodeId: EPISODE_1_ID,
      assignedTo: MANAGER_A_ID,
      requestedBy: OFFICER_ID,
      status: 'RESPONDED',
      version: 2,
      reason: 'Verify vest-missing subject near Excavation Ramp',
      result: {
        outcome: 'PARTIAL',
        workerId: null,
        contractorId: CONTRACTOR_1_ID,
        reason: 'Contractor vest color matches Mekong Structural crew',
        evidenceRefs: [],
        respondedBy: MANAGER_A_ID,
        respondedAt: '2026-11-11T04:15:00.000Z',
      },
    });

    // Current eligible Site Manager on Site A is now Manager B so Reassign is permitted.
    spies.getAssignee.mockResolvedValue({
      assignee: { id: MANAGER_B_ID, displayName: 'Pham Quoc Bao' },
    });

    spies.listRequests.mockImplementation(async () => ({ items: [activeRequest], total: 1 }));
    spies.getRequest.mockImplementation(async () => activeRequest);

    spies.listHistory.mockImplementation(
      async (
        _token: ListHistoryArgs[0],
        _siteId: ListHistoryArgs[1],
        _id: ListHistoryArgs[2],
        options: NonNullable<ListHistoryArgs[3]> = {},
      ): Promise<SafetyIdentificationHistoryPage> => {
        const limit = options.limit ?? 10;
        const offset = options.offset ?? 0;
        const total = limit + 1;

        if (offset === 0) {
          const firstEntries: SafetyIdentificationHistoryEntry[] = [
            makeHistoryEntry(
              1,
              'CREATE',
              'History v1 initial request from episode',
              activeRequest.assignedTo,
            ),
            makeHistoryEntry(
              2,
              'RESPOND',
              'History v2 partial contractor proposal',
              activeRequest.assignedTo,
              activeRequest.result ?? {
                outcome: 'PARTIAL',
                workerId: null,
                contractorId: CONTRACTOR_1_ID,
                reason: 'Contractor vest color matches Mekong Structural crew',
                evidenceRefs: [],
                respondedBy: MANAGER_A_ID,
                respondedAt: '2026-11-11T04:15:00.000Z',
              },
            ),
          ];
          while (firstEntries.length < limit) {
            const v = firstEntries.length + 1;
            firstEntries.push(
              makeHistoryEntry(v, 'RETURN', `History filler entry #${v}`, activeRequest.assignedTo),
            );
          }
          return { items: firstEntries, total };
        }

        return {
          items: [
            makeHistoryEntry(
              total,
              'RESPOND',
              'History page 2 overflow entry',
              activeRequest.assignedTo,
            ),
          ],
          total,
        };
      },
    );

    spies.changeRequest.mockImplementation(
      async (
        _token: ChangeRequestArgs[0],
        _siteId: ChangeRequestArgs[1],
        _id: ChangeRequestArgs[2],
        command: ChangeRequestArgs[3],
      ) => {
        if (command.action === 'review' && command.input.decision === 'RETURN') {
          activeRequest = {
            ...activeRequest,
            status: 'OPEN',
            version: command.input.expectedVersion + 1,
            result: null,
            updatedAt: '2026-11-11T05:00:00.000Z',
          };
          return { request: activeRequest, replayed: false };
        }
        if (command.action === 'reassign') {
          activeRequest = {
            ...activeRequest,
            assignedTo: command.input.assignedTo,
            status: 'OPEN',
            version: command.input.expectedVersion + 1,
            result: null,
            updatedAt: '2026-11-11T05:10:00.000Z',
          };
          return { request: activeRequest, replayed: false };
        }
        if (command.action === 'review' && command.input.decision === 'ACCEPT') {
          activeRequest = {
            ...activeRequest,
            status: 'CLOSED',
            version: command.input.expectedVersion + 1,
            updatedAt: '2026-11-11T05:30:00.000Z',
          };
          return { request: activeRequest, replayed: false };
        }
        if (command.action === 'cancel') {
          activeRequest = {
            ...activeRequest,
            status: 'CANCELLED',
            version: command.input.expectedVersion + 1,
            updatedAt: '2026-11-11T05:45:00.000Z',
          };
          return { request: activeRequest, replayed: false };
        }
        throw new Error(`Unhandled command in test: ${JSON.stringify(command)}`);
      },
    );

    const { unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_A_ID], OFFICER_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(activeRequest);

    await waitFor(() => {
      expect(spies.listHistory).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_2_ID,
        expect.objectContaining({ offset: 0 }),
        expect.anything(),
      );
    });

    expect(await screen.findByText(WORKSPACE_EN.detail.historyTitle)).toBeTruthy();
    expect(
      (await screen.findAllByText(/History v1 initial request from episode/i)).length,
    ).toBeGreaterThan(0);
    expect(
      (await screen.findAllByText(/History v2 partial contractor proposal/i)).length,
    ).toBeGreaterThan(0);

    // Queue has total=1 so the enabled Next button paginates Officer history to page 2.
    const historyFirstCall = atIndex(spies.listHistory.mock.calls, 0, 'initial listHistory call');
    const historyLimit = historyFirstCall[3]?.limit ?? 10;
    const enabledHistoryNext = screen
      .queryAllByRole('button', { name: WORKSPACE_EN.queue.nextPage })
      .find((btn) => !btn.hasAttribute('disabled'));
    expect(enabledHistoryNext).toBeDefined();
    if (!enabledHistoryNext) throw new Error('Expected enabled history Next button');
    fireEvent.click(enabledHistoryNext);

    await waitFor(() => {
      expect(spies.listHistory).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_2_ID,
        expect.objectContaining({ offset: historyLimit }),
        expect.anything(),
      );
    });
    expect((await screen.findAllByText(/History page 2 overflow entry/i)).length).toBeGreaterThan(
      0,
    );

    // 1) Officer RETURN reopens RESPONDED (v2) -> OPEN (v3) while history retains prior proposals.
    await submitOfficerReview(
      'RETURN',
      'Please verify against 08:00 gate entry log before closing',
    );

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_2_ID,
        {
          action: 'review',
          input: {
            commandId: expect.stringMatching(UUID_PATTERN),
            expectedVersion: 2,
            decision: 'RETURN',
            reason: 'Please verify against 08:00 gate entry log before closing',
          },
        },
        expect.anything(),
      );
    });

    // 2) Officer REASSIGN on OPEN (v3) assigns to current eligible Manager B -> v4.
    await submitOfficerReassign('Site Manager rotation shifted North Tower to Pham Quoc Bao');

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_2_ID,
        {
          action: 'reassign',
          input: {
            commandId: expect.stringMatching(UUID_PATTERN),
            expectedVersion: 3,
            assignedTo: MANAGER_B_ID,
            reason: 'Site Manager rotation shifted North Tower to Pham Quoc Bao',
          },
        },
        expect.anything(),
      );
    });

    // 3) Simulate Manager B responding -> RESPONDED (v5), refresh details, then Officer ACCEPT -> CLOSED (v6).
    activeRequest = {
      ...activeRequest,
      status: 'RESPONDED',
      version: 5,
      result: {
        outcome: 'IDENTIFIED',
        workerId: WORKER_1_ID,
        contractorId: CONTRACTOR_1_ID,
        reason: 'Confirmed Le Van Hung with shift supervisor',
        evidenceRefs: [],
        respondedBy: MANAGER_B_ID,
        respondedAt: '2026-11-11T05:20:00.000Z',
      },
    };

    fireEvent.click(screen.getByRole('button', { name: WORKSPACE_EN.detail.refreshLabel }));
    await screen.findByLabelText(WORKSPACE_EN.detail.reviewReasonLabel);

    await submitOfficerReview('ACCEPT', 'Accepted identification proposal for investigation file');

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_2_ID,
        {
          action: 'review',
          input: {
            commandId: expect.stringMatching(UUID_PATTERN),
            expectedVersion: 5,
            decision: 'ACCEPT',
            reason: 'Accepted identification proposal for investigation file',
          },
        },
        expect.anything(),
      );
    });

    expect(
      (await screen.findAllByText(WORKSPACE_EN.detail.closedFollowUpTitle)).length,
    ).toBeGreaterThan(0);

    // Accepting an identification request closes ONLY the identification request —
    // incident creation, corrective handover, and global observation identity stay untouched.
    expect(spies.createIncident).not.toHaveBeenCalled();
    expect(spies.incidentCommand).not.toHaveBeenCalled();
    expect(spies.decideObservationIdentity).not.toHaveBeenCalled();

    unmount();

    // 4) Officer CANCEL on an OPEN request moves it to CANCELLED.
    activeRequest = makeRequest({
      id: REQUEST_3_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_B_ID,
      requestedBy: OFFICER_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Open request to cancel after duplicate camera check',
    });

    renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_A_ID], OFFICER_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(activeRequest);
    await submitOfficerCancel('Duplicate episode check; identification no longer needed');

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledWith(
        OFFICER_TOKEN,
        SITE_A_ID,
        REQUEST_3_ID,
        {
          action: 'cancel',
          input: {
            commandId: expect.stringMatching(UUID_PATTERN),
            expectedVersion: 1,
            reason: 'Duplicate episode check; identification no longer needed',
          },
        },
        expect.anything(),
      );
    });
  });

  it('retains the operator draft on 409 conflict, requires refresh to load current version before retry, and never mints a fresh commandId on uncertain network retry', async () => {
    const spies = getSpies();
    let serverRequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Check crane signalman PPE observation',
    });

    spies.listRequests.mockImplementation(async () => ({ items: [serverRequest], total: 1 }));
    spies.getRequest.mockImplementation(async () => serverRequest);

    // Attempt 1 -> uncertain network failure.
    // Attempt 2 -> 409 conflict because server advanced to version 3.
    // Attempt 3 (after refresh loads version 3) -> succeeds at expectedVersion: 3.
    spies.changeRequest
      .mockRejectedValueOnce(new ApiError('network', 'Could not connect to the backend.'))
      .mockImplementationOnce(async () => {
        serverRequest = {
          ...serverRequest,
          version: 3,
          updatedAt: '2026-11-11T06:00:00.000Z',
        };
        throw new ApiError('http', 'Identification request version changed', 409);
      })
      .mockImplementationOnce(
        async (
          _token: ChangeRequestArgs[0],
          _siteId: ChangeRequestArgs[1],
          _id: ChangeRequestArgs[2],
          command: ChangeRequestArgs[3],
        ) => {
          if (command.action !== 'respond') throw new Error('Expected respond action');
          serverRequest = {
            ...serverRequest,
            status: 'RESPONDED',
            version: command.input.expectedVersion + 1,
            result: {
              outcome: command.input.outcome,
              workerId: command.input.workerId,
              contractorId: command.input.contractorId,
              reason: command.input.reason,
              evidenceRefs: command.input.evidenceRefs,
              respondedBy: MANAGER_A_ID,
              respondedAt: '2026-11-11T06:05:00.000Z',
            },
          };
          return { request: serverRequest, replayed: false };
        },
      );

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(serverRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    const draftReason = 'Signalman left shift early; unable to confirm from crane cab log';
    const reasonTextarea = screen.getByLabelText(
      FORM_EN.response.reasonLabel,
    ) as HTMLTextAreaElement;
    fireEvent.change(reasonTextarea, { target: { value: draftReason } });

    // Submit 1: uncertain network error -> draft stays intact.
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(reasonTextarea.value).toBe(draftReason);

    const firstCall = atIndex(spies.changeRequest.mock.calls, 0, 'first changeRequest call');
    const firstCommand = firstCall[3];
    expect(firstCommand.input.commandId).toMatch(UUID_PATTERN);

    // Submit 2 (retry after uncertain network error with identical payload):
    // must reuse the exact same commandId rather than generating a fresh one!
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledTimes(2);
    });

    const secondCall = atIndex(spies.changeRequest.mock.calls, 1, 'second changeRequest call');
    const secondCommand = secondCall[3];
    expect(secondCommand.input.commandId).toBe(firstCommand.input.commandId);
    expect(secondCommand.input.expectedVersion).toBe(1);

    // Second attempt rejected with HTTP 409: operator's draft reason MUST still be preserved!
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      draftReason,
    );

    // Refresh loads latest version (version 3) while keeping draft intact.
    const refreshButtons = screen.getAllByRole('button', {
      name: WORKSPACE_EN.detail.conflictRefreshButton,
    });
    const refreshLatestButton = atIndex(refreshButtons, 0, 'conflict refresh button');
    fireEvent.click(refreshLatestButton);

    await waitFor(() => {
      expect(spies.getRequest).toHaveBeenCalled();
    });
    expect((screen.getByLabelText(FORM_EN.response.reasonLabel) as HTMLTextAreaElement).value).toBe(
      draftReason,
    );

    // Submit 3 after refresh -> sends current expectedVersion: 3 with preserved draft!
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: FORM_EN.response.submitLabel }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));
    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledTimes(3);
    });

    const thirdCall = atIndex(spies.changeRequest.mock.calls, 2, 'third changeRequest call');
    expect(thirdCall[3]).toEqual({
      action: 'respond',
      input: expect.objectContaining({
        commandId: expect.stringMatching(UUID_PATTERN),
        expectedVersion: 3,
        outcome: 'UNRESOLVED',
        workerId: null,
        contractorId: null,
        reason: draftReason,
        evidenceRefs: [],
      }),
    });
  });
});
