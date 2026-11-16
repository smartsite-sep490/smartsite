// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, type SafetyIdentificationRequest } from '@smartsite/api-client';
import {
  ALL_FIXTURE_UUIDS,
  API_URL,
  CONTRACTOR_1_ID,
  EPISODE_1_ID,
  EPISODE_2_ID,
  FORM_EN,
  MANAGER_A_ID,
  MANAGER_A_TOKEN,
  OFFICER_ID,
  OFFICER_TOKEN,
  REQUEST_1_ID,
  REQUEST_3_ID,
  SITE_A_ID,
  SITE_B_ID,
  UUID_PATTERN,
  WORKER_1_ID,
  WORKSPACE_EN,
  atIndex,
  escapeRegExp,
  makeRequest,
  managerSession,
  officerSession,
  type ChangeRequestArgs,
  type CreateRequestArgs,
  type GetRequestArgs,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

describe('SafetyIdentificationWorkspace — role boundaries, intake, and Manager response (C02 Web)', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  it('shows Site Manager only their assigned queue and response form without Officer create/review/history controls', async () => {
    const spies = getSpies();

    expect(new Set(ALL_FIXTURE_UUIDS).size).toBe(ALL_FIXTURE_UUIDS.length);
    for (const id of ALL_FIXTURE_UUIDS) {
      expect(id).toMatch(UUID_PATTERN);
    }

    const assignedRequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Assigned walkway PPE subject check for Manager Quan',
    });

    spies.listRequests.mockResolvedValue({ items: [assignedRequest], total: 1 });
    spies.getRequest.mockResolvedValue(assignedRequest);

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(assignedRequest);

    expect(await screen.findByRole('heading', { name: FORM_EN.response.title })).toBeTruthy();
    expect(
      screen.getAllByText(WORKSPACE_EN.waitingByStatus.OPEN.waitingActor).length,
    ).toBeGreaterThan(0);

    expect(spies.listRequests).toHaveBeenCalledWith(
      MANAGER_A_TOKEN,
      SITE_A_ID,
      expect.objectContaining({ offset: 0 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(spies.getRequest).toHaveBeenCalledWith(
      MANAGER_A_TOKEN,
      SITE_A_ID,
      REQUEST_1_ID,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Manager must never see Officer create, review, reassign, cancel, or Officer-only history controls.
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.header.newFromEpisode })).toBeNull();
    expect(screen.queryByRole('heading', { name: FORM_EN.create.title })).toBeNull();
    expect(screen.queryByRole('button', { name: FORM_EN.create.submitLabel })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.acceptButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.returnButton })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.reassignToggle })).toBeNull();
    expect(screen.queryByRole('button', { name: WORKSPACE_EN.detail.cancelToggle })).toBeNull();
    expect(screen.queryByText(WORKSPACE_EN.detail.historyTitle)).toBeNull();

    // Officer-only client methods must not be invoked by Site Manager.
    expect(spies.getAssignee).not.toHaveBeenCalled();
    expect(spies.listHistory).not.toHaveBeenCalled();
    expect(spies.createRequest).not.toHaveBeenCalled();
    expect(spies.listSafetyContractors).not.toHaveBeenCalled();
  });

  it('creates an Officer request using the actual eligible Site Manager from getSafetyIdentificationAssignee and blocks when none exists', async () => {
    const spies = getSpies();
    let storedRequests: SafetyIdentificationRequest[] = [];

    spies.listRequests.mockImplementation(async () => ({
      items: storedRequests,
      total: storedRequests.length,
    }));
    spies.getRequest.mockImplementation(
      async (_token: GetRequestArgs[0], _siteId: GetRequestArgs[1], id: GetRequestArgs[2]) => {
        const match = storedRequests.find((item) => item.id === id);
        if (!match) throw new ApiError('http', 'Not found', 404);
        return match;
      },
    );

    spies.createRequest.mockImplementation(
      async (
        _token: CreateRequestArgs[0],
        siteId: CreateRequestArgs[1],
        input: CreateRequestArgs[2],
      ) => {
        const created = makeRequest({
          id: REQUEST_1_ID,
          siteId,
          episodeId: input.episodeId,
          assignedTo: input.assignedTo,
          requestedBy: OFFICER_ID,
          reason: input.reason,
          status: 'OPEN',
          version: 1,
          evidenceRefs: input.evidenceRefs,
        });
        storedRequests = [created];
        return { request: created, replayed: false };
      },
    );

    const { unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_A_ID], OFFICER_TOKEN),
      initialSiteId: SITE_A_ID,
      initialEpisodeId: EPISODE_1_ID,
    });

    if (!screen.queryByRole('heading', { name: FORM_EN.create.title })) {
      fireEvent.click(
        await screen.findByRole('button', { name: WORKSPACE_EN.header.newFromEpisode }),
      );
    }

    expect(await screen.findByRole('heading', { name: FORM_EN.create.title })).toBeTruthy();
    expect(await screen.findByText('Tran Minh Quan')).toBeTruthy();
    expect(spies.getAssignee).toHaveBeenCalledWith(OFFICER_TOKEN, SITE_A_ID, expect.anything());

    // Must never ask Safety Officer to type or paste a raw Manager UUID.
    const textInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="text"]'),
    );
    expect(
      textInputs.some((input) => /manager|assignee|uuid/i.test(input.placeholder || input.name)),
    ).toBe(false);

    const reasonField = screen.getByLabelText(FORM_EN.create.reasonLabel);
    fireEvent.change(reasonField, {
      target: { value: '  Verify subject missing chin-strap at North Crane Bay 2  ' },
    });

    const submitButton = screen.getByRole('button', {
      name: FORM_EN.create.submitLabel,
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(spies.createRequest).toHaveBeenCalledTimes(1);
    });

    const createCall = atIndex(spies.createRequest.mock.calls, 0, 'createRequest call');
    expect(createCall[0]).toBe(OFFICER_TOKEN);
    expect(createCall[1]).toBe(SITE_A_ID);
    expect(createCall[2]).toEqual(
      expect.objectContaining({
        commandId: expect.stringMatching(UUID_PATTERN),
        episodeId: EPISODE_1_ID,
        assignedTo: MANAGER_A_ID,
        reason: 'Verify subject missing chin-strap at North Crane Bay 2',
        evidenceRefs: [],
      }),
    );

    // Newly created OPEN request surfaces in the workspace state.
    expect(
      (await screen.findAllByText(/Verify subject missing chin-strap at North Crane Bay 2/i))
        .length,
    ).toBeGreaterThan(0);

    unmount();

    // When no eligible Site Manager is assigned to the Site, creation is blocked explicitly.
    storedRequests = [];
    spies.getAssignee.mockResolvedValue({ assignee: null });

    renderWorkspace({
      apiUrl: API_URL,
      session: officerSession([SITE_B_ID], OFFICER_TOKEN),
      initialSiteId: SITE_B_ID,
      initialEpisodeId: EPISODE_2_ID,
    });

    if (!screen.queryByRole('heading', { name: FORM_EN.create.title })) {
      fireEvent.click(
        await screen.findByRole('button', { name: WORKSPACE_EN.header.newFromEpisode }),
      );
    }

    expect(await screen.findByText(FORM_EN.create.assigneeUnavailable)).toBeTruthy();
    const blockedSubmit = screen.getByRole('button', {
      name: FORM_EN.create.submitLabel,
    }) as HTMLButtonElement;
    expect(blockedSubmit.disabled).toBe(true);
    expect(spies.createRequest).toHaveBeenCalledTimes(1);
  });

  it('submits UNRESOLVED response without forcing Worker selection and transitions OPEN -> RESPONDED (while IDENTIFIED enforces Site Worker selection)', async () => {
    const spies = getSpies();
    let currentRequest = makeRequest({
      id: REQUEST_1_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      result: null,
      reason: 'Check afternoon scaffolding crew member identity',
    });

    spies.listRequests.mockImplementation(async () => ({ items: [currentRequest], total: 1 }));
    spies.getRequest.mockImplementation(async () => currentRequest);
    spies.changeRequest.mockImplementation(
      async (
        _token: ChangeRequestArgs[0],
        _siteId: ChangeRequestArgs[1],
        _id: ChangeRequestArgs[2],
        command: ChangeRequestArgs[3],
      ) => {
        if (command.action !== 'respond') {
          throw new Error(`Unexpected action ${command.action}`);
        }
        currentRequest = {
          ...currentRequest,
          status: 'RESPONDED',
          version: currentRequest.version + 1,
          updatedAt: '2026-11-11T03:10:00.000Z',
          result: {
            outcome: command.input.outcome,
            workerId: command.input.workerId,
            contractorId: command.input.contractorId,
            reason: command.input.reason,
            evidenceRefs: command.input.evidenceRefs,
            respondedBy: MANAGER_A_ID,
            respondedAt: '2026-11-11T03:10:00.000Z',
          },
        };
        return { request: currentRequest, replayed: false };
      },
    );

    const { unmount } = renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(currentRequest);
    expect(await screen.findByRole('heading', { name: FORM_EN.response.title })).toBeTruthy();

    // Default outcome is UNRESOLVED and neither Worker nor Contractor selection is forced or rendered.
    const unresolvedRadio = screen.getByRole('radio', {
      name: new RegExp(escapeRegExp(FORM_EN.response.outcomes.UNRESOLVED.label), 'i'),
    }) as HTMLInputElement;
    expect(unresolvedRadio.checked).toBe(true);
    expect(screen.queryByLabelText(FORM_EN.response.contractorLabel)).toBeNull();
    expect(screen.queryByLabelText(FORM_EN.response.workerLabel)).toBeNull();

    // Wait for asynchronous Site candidate queries to settle so IDENTIFIED radio is enabled before clicking.
    const identifiedRadio = screen.getByRole('radio', {
      name: new RegExp(escapeRegExp(FORM_EN.response.outcomes.IDENTIFIED.label), 'i'),
    }) as HTMLInputElement;
    await waitFor(() => {
      expect(identifiedRadio.disabled).toBe(false);
    });
    fireEvent.click(identifiedRadio);

    const contractorSelect = screen.getByLabelText(
      FORM_EN.response.contractorLabel,
    ) as HTMLSelectElement;
    const workerSelect = screen.getByLabelText(FORM_EN.response.workerLabel) as HTMLSelectElement;
    expect(contractorSelect.disabled).toBe(false);
    expect(workerSelect.disabled).toBe(false);

    const responseReasonInput = screen.getByLabelText(FORM_EN.response.reasonLabel);
    fireEvent.change(responseReasonInput, {
      target: { value: 'Back-of-helmet view only; two crews crossed Zone B simultaneously' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    expect(await screen.findByText(FORM_EN.errors.workerRequired)).toBeTruthy();
    expect(spies.changeRequest).not.toHaveBeenCalled();

    // Switch back to UNRESOLVED: Worker & Contractor selectors are cleared/omitted and null in payload.
    fireEvent.click(unresolvedRadio);
    expect(unresolvedRadio.checked).toBe(true);
    expect(screen.queryByLabelText(FORM_EN.response.workerLabel)).toBeNull();
    expect(screen.queryByLabelText(FORM_EN.response.contractorLabel)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledTimes(1);
    });

    expect(spies.changeRequest).toHaveBeenCalledWith(
      MANAGER_A_TOKEN,
      SITE_A_ID,
      REQUEST_1_ID,
      {
        action: 'respond',
        input: {
          commandId: expect.stringMatching(UUID_PATTERN),
          expectedVersion: 1,
          outcome: 'UNRESOLVED',
          workerId: null,
          contractorId: null,
          reason: 'Back-of-helmet view only; two crews crossed Zone B simultaneously',
          evidenceRefs: [],
        },
      },
      expect.anything(),
    );

    // After transitioning OPEN -> RESPONDED (v2), response form closes and read-only notice renders.
    expect(await screen.findByText(WORKSPACE_EN.detail.managerReadOnlyStatusNotice)).toBeTruthy();
    expect(screen.queryByRole('button', { name: FORM_EN.response.submitLabel })).toBeNull();

    unmount();

    // Verify IDENTIFIED with valid Site Worker & Contractor submits exact candidate IDs.
    currentRequest = makeRequest({
      id: REQUEST_3_ID,
      siteId: SITE_A_ID,
      assignedTo: MANAGER_A_ID,
      status: 'OPEN',
      version: 1,
      reason: 'Confirm welder candidate at East Truss Platform',
    });

    renderWorkspace({
      apiUrl: API_URL,
      session: managerSession(MANAGER_A_ID, [SITE_A_ID], MANAGER_A_TOKEN),
      initialSiteId: SITE_A_ID,
    });

    await openRequestRow(currentRequest);
    await screen.findByRole('heading', { name: FORM_EN.response.title });

    const identifiedRadioSecond = screen.getByRole('radio', {
      name: new RegExp(escapeRegExp(FORM_EN.response.outcomes.IDENTIFIED.label), 'i'),
    }) as HTMLInputElement;
    await waitFor(() => {
      expect(identifiedRadioSecond.disabled).toBe(false);
    });
    fireEvent.click(identifiedRadioSecond);

    await waitFor(() => {
      const workerOptions = Array.from(
        (screen.getByLabelText(FORM_EN.response.workerLabel) as HTMLSelectElement).options,
      );
      expect(workerOptions.some((opt) => opt.value === WORKER_1_ID)).toBe(true);
    });

    fireEvent.change(screen.getByLabelText(FORM_EN.response.contractorLabel), {
      target: { value: CONTRACTOR_1_ID },
    });
    fireEvent.change(screen.getByLabelText(FORM_EN.response.workerLabel), {
      target: { value: WORKER_1_ID },
    });
    fireEvent.change(screen.getByLabelText(FORM_EN.response.reasonLabel), {
      target: { value: 'Matched shift roster for Mekong Structural bay team' },
    });
    fireEvent.click(screen.getByRole('button', { name: FORM_EN.response.submitLabel }));

    await waitFor(() => {
      expect(spies.changeRequest).toHaveBeenCalledTimes(2);
    });
    expect(spies.changeRequest).toHaveBeenLastCalledWith(
      MANAGER_A_TOKEN,
      SITE_A_ID,
      REQUEST_3_ID,
      {
        action: 'respond',
        input: {
          commandId: expect.stringMatching(UUID_PATTERN),
          expectedVersion: 1,
          outcome: 'IDENTIFIED',
          workerId: WORKER_1_ID,
          contractorId: CONTRACTOR_1_ID,
          reason: 'Matched shift roster for Mekong Structural bay team',
          evidenceRefs: [],
        },
      },
      expect.anything(),
    );
  });
});
