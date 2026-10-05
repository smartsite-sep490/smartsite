// @vitest-environment jsdom
import { BlobImage, ConfirmedAlerts, ResultFields, Assignee, Dialog } from './SafetyWorkflowUi';

import { SafetyAlertsView } from '../alerts/SafetyAlertsView';

import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IncidentView } from './IncidentView';
import { SafetyTasksView } from './SafetyTasksView';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const props = {
  client: new SmartSiteManagementClient('http://local'),
  apiUrl: 'http://local',
  token: 'test-token',
  scope: 'scope',
  siteId: 'site',
  user: {
    id: 'security',
    username: 'security',
    displayName: 'Security',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SECURITY_OFFICER' as const, siteId: 'site' }],
  },
};
function mount(child: React.ReactNode) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return { ...render(<QueryClientProvider client={cache}>{child}</QueryClientProvider>), cache };
}
describe('MF08 role screens', () => {
  it('Security sees own incidents without create controls, and supports retry', async () => {
    vi.spyOn(props.client, 'listIncidents')
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValue({ items: [], total: 0 });
    mount(<IncidentView {...props} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No incidents found.')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create incident' })).toBeNull();
  });
  it('Manager can create SafetyTask and preserves receiver role lookup', async () => {
    const user = {
      ...props.user,
      id: 'manager',
      roleAssignments: [{ role: 'SITE_MANAGER' as const, siteId: 'site' }],
    };
    vi.spyOn(props.client, 'listSafetyTasks').mockResolvedValue({ items: [], total: 0 });
    const lookup = vi
      .spyOn(props.client, 'listSafetyAssignees')
      .mockResolvedValue({ items: [{ id: 'safety', displayName: 'Safety A' }], total: 1 });
    mount(<SafetyTasksView {...props} user={user} />);
    fireEvent.click(screen.getByRole('button', { name: 'New safety task' }));
    expect(
      await within(screen.getByRole('dialog')).findByRole('option', { name: 'Safety A' }),
    ).not.toBeNull();
    expect(lookup).toHaveBeenCalledWith(
      'test-token',
      'site',
      'SAFETY_OFFICER',
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'Create task' })).not.toBeNull();
  });
});

const timestamp = '2026-10-02T10:00:00Z';
it('Security can resubmit a rejected action while retaining the earlier submission', async () => {
  const action = {
    id: 'action',
    incidentId: 'incident',
    assignedTo: 'security',
    assignedBy: 'safety',
    description: 'Fix barrier',
    dueAt: null,
    status: 'IN_PROGRESS' as const,
    version: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    submissions: [
      {
        id: 'old',
        correctiveActionId: 'action',
        submittedBy: 'security',
        resultDescription: 'Old result',
        submittedAt: timestamp,
        status: 'REJECTED' as const,
        evidence: null,
        reviewedBy: 'safety',
        reviewedAt: timestamp,
        reviewNote: 'Incomplete',
      },
    ],
  };
  const initial = {
    id: 'incident',
    siteId: 'site',
    zoneId: null,
    title: 'Synthetic incident',
    description: 'Hazard',
    severity: 'HIGH' as const,
    status: 'IN_PROGRESS' as const,
    occurredAt: timestamp,
    reportedBy: 'safety',
    closedBy: null,
    closedAt: null,
    version: 5,
    createdAt: timestamp,
    updatedAt: timestamp,
    alerts: [],
    actions: [action],
    audit: [],
  };
  const updated = {
    ...initial,
    version: 6,
    actions: [
      {
        ...action,
        status: 'SUBMITTED' as const,
        version: 5,
        submissions: [
          ...action.submissions,
          {
            ...action.submissions[0]!,
            id: 'new',
            resultDescription: 'New result',
            status: 'PENDING' as const,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
          },
        ],
      },
    ],
  };
  vi.spyOn(props.client, 'listIncidents').mockResolvedValue({ items: [initial], total: 1 });
  vi.spyOn(props.client, 'getIncident').mockResolvedValueOnce(initial).mockResolvedValue(updated);
  const command = vi
    .spyOn(props.client, 'incidentCommand')
    .mockResolvedValue({ resource: updated, replayed: false });
  mount(<IncidentView {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic incident/ }));
  expect(await screen.findByText(/Review: Incomplete/)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit result' }));
  fireEvent.change(screen.getByLabelText('Result description'), {
    target: { value: 'New result' },
  });
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit result' }),
  );
  expect(await screen.findByText('New result')).not.toBeNull();
  expect(screen.getByText('Old result')).not.toBeNull();
  expect(command).toHaveBeenCalledWith(
    'test-token',
    'site',
    'incident',
    'submit',
    expect.objectContaining({
      expectedVersion: 4,
      resultDescription: 'New result',
      commandId: expect.any(String),
    }),
    'action',
    undefined,
    expect.anything(),
  );
});
it('Manager conflict requests reload and next review uses the refreshed version', async () => {
  const p = {
    ...props,
    user: {
      ...props.user,
      id: 'manager',
      roleAssignments: [{ role: 'SITE_MANAGER' as const, siteId: 'site' }],
    },
  };
  const task = {
    id: 'task',
    siteId: 'site',
    zoneId: null,
    kind: 'SAFETY_PATROL' as const,
    sourceAlertId: null,
    sourceIncidentId: null,
    assignedTo: 'safety',
    assignedBy: 'manager',
    description: 'Patrol check',
    dueAt: null,
    status: 'COMPLETED' as const,
    resultSummary: 'Checked',
    resultEvidence: null,
    completedAt: timestamp,
    verifiedBy: null,
    verifiedAt: null,
    version: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
    audit: [],
  };
  vi.spyOn(props.client, 'listSafetyTasks').mockResolvedValue({ items: [task], total: 1 });
  vi.spyOn(props.client, 'listSafetyAssignees').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(props.client, 'getSafetyTask')
    .mockResolvedValueOnce(task)
    .mockResolvedValue({ ...task, version: 4 });
  const command = vi
    .spyOn(props.client, 'safetyTaskCommand')
    .mockRejectedValueOnce(new ApiError('http', 'Conflict', 409))
    .mockResolvedValue({
      resource: {
        ...task,
        status: 'VERIFIED',
        verifiedBy: 'manager',
        verifiedAt: timestamp,
        version: 5,
      },
      replayed: false,
    });
  mount(<SafetyTasksView {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: /Patrol check/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review task' }));
  fireEvent.change(await screen.findByLabelText('Task review reason'), {
    target: { value: 'Confirmed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record task review' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reload');
  fireEvent.click(screen.getByRole('button', { name: 'Reload data' }));
  await waitFor(() => expect(screen.getByText(/Version 4/)).not.toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Record task review' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[1]?.[4]).toMatchObject({ expectedVersion: 4, reason: 'Confirmed' });
});
it('Logout cancels MF08 queries and removes sensitive caches before switching account', async () => {
  const login = {
    accessToken: 'security-token',
    tokenType: 'Bearer' as const,
    accessTokenExpiresAt: timestamp,
    refreshTokenExpiresAt: timestamp,
    user: props.user,
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(login);
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined);
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'A', name: 'A', createdAt: timestamp }],
    total: 1,
  });
  let signal: AbortSignal | undefined;
  let finish: ((value: { items: never[]; total: number }) => void) | undefined;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listIncidents').mockImplementation(
    (_token, _site, _page, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  const { cache } = mount(<SafetyAlertsView apiUrl="http://local" />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'security' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(signal).toBeDefined());
  expect(screen.queryByLabelText('Alert type')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Sign out Security/ }));
  await waitFor(() => expect(signal?.aborted).toBe(true));
  finish?.({ items: [], total: 0 });
  await waitFor(() =>
    expect(
      cache
        .getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'safety-workflow'),
    ).toHaveLength(0),
  );
  expect(screen.queryByText('My corrective work')).toBeNull();
});

it('Evidence switches the displayed object URL when the Blob changes', async () => {
  const first = new Blob(['first'], { type: 'image/jpeg' }),
    second = new Blob(['second'], { type: 'image/jpeg' });
  const create = vi.fn((blob: Blob) => (blob === first ? 'blob:first' : 'blob:second'));
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const view = render(<BlobImage blob={first} alt="Evidence" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('blob:first');
  view.rerender(<BlobImage blob={second} alt="Evidence" />);
  expect(screen.getByRole('img').getAttribute('src')).toBe('blob:second');
  expect(revoke).toHaveBeenCalledWith('blob:first');
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:second');
  vi.unstubAllGlobals();
});
it('Confirmed alert picker removes an already linked navigation selection', async () => {
  const p = {
    ...props,
    user: { ...props.user, roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: 'site' }] },
  };
  vi.spyOn(props.client, 'listSafetyAlerts').mockResolvedValue({
    items: [
      {
        id: 'linked',
        siteId: 'site',
        zoneId: null,
        incidentId: 'existing',
        candidateWorkerId: null,
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'CONFIRMED',
        firstDetectedAt: timestamp,
        lastDetectedAt: timestamp,
        detectionCount: 1,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    total: 1,
  });
  let chosen: string[] | undefined;
  mount(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        chosen = new FormData(e.currentTarget).getAll('alertIds').map(String);
      }}
    >
      <ConfirmedAlerts p={p} initialAlertId="linked" />
      <button>Submit selection</button>
    </form>,
  );
  await screen.findByText(/No unlinked confirmed alert/);
  fireEvent.click(screen.getByRole('button', { name: 'Submit selection' }));
  expect(chosen).toEqual([]);
});
it('Create-from-alert navigation does not carry a hidden Alert into another Site', async () => {
  const officer = {
    ...props.user,
    id: 'safety',
    roleAssignments: [
      { role: 'SAFETY_OFFICER' as const, siteId: 'site' },
      { role: 'SAFETY_OFFICER' as const, siteId: 'other' },
    ],
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue({
    accessToken: 'token',
    tokenType: 'Bearer',
    accessTokenExpiresAt: timestamp,
    refreshTokenExpiresAt: timestamp,
    user: officer,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined);
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      { id: 'site', code: 'A', name: 'A', createdAt: timestamp },
      { id: 'other', code: 'B', name: 'B', createdAt: timestamp },
    ],
    total: 2,
  });
  const alert = {
    id: 'alert-a',
    siteId: 'site',
    zoneId: null,
    incidentId: null,
    candidateWorkerId: null,
    alertType: 'PPE_VIOLATION' as const,
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    status: 'CONFIRMED' as const,
    firstDetectedAt: timestamp,
    lastDetectedAt: timestamp,
    detectionCount: 1,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
    async (_token, site) => ({
      items: site === 'site' ? [alert] : [],
      total: site === 'site' ? 1 : 0,
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue({
    ...alert,
    detections: [],
    detectionsTotal: 0,
    reviews: [],
    reviewsTotal: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listIncidents').mockResolvedValue({
    items: [],
    total: 0,
  });
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createIncident')
    .mockRejectedValue(new ApiError('network', 'Simulated response loss'));
  mount(<SafetyAlertsView apiUrl="http://local" />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'safety' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create incident from alert' }));
  fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'other' } });
  await screen.findByText('No incidents found.');
  fireEvent.click(screen.getByRole('button', { name: 'New incident' }));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Manual B' } });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Manual description' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create incident' }));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0]?.[1]).toBe('other');
  expect(create.mock.calls[0]?.[2].alertIds).toEqual([]);
});

it('Refresh tasks loads the selected task changed by another officer within the cache window', async () => {
  const p = {
    ...props,
    user: {
      ...props.user,
      id: 'manager',
      roleAssignments: [{ role: 'SITE_MANAGER' as const, siteId: 'site' }],
    },
  };
  const task = {
    id: 'task',
    siteId: 'site',
    zoneId: null,
    kind: 'SAFETY_PATROL' as const,
    sourceAlertId: null,
    sourceIncidentId: null,
    assignedTo: 'safety',
    assignedBy: 'manager',
    description: 'External officer update',
    dueAt: null,
    status: 'ASSIGNED' as const,
    resultSummary: null,
    resultEvidence: null,
    completedAt: null,
    verifiedBy: null,
    verifiedAt: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    audit: [],
  };
  const updated = {
    ...task,
    status: 'COMPLETED' as const,
    resultSummary: 'Officer submitted work',
    completedAt: timestamp,
    version: 3,
  };
  vi.spyOn(props.client, 'listSafetyTasks').mockResolvedValue({ items: [task], total: 1 });
  vi.spyOn(props.client, 'listSafetyAssignees').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(props.client, 'getSafetyTask').mockResolvedValueOnce(task).mockResolvedValue(updated);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  render(
    <QueryClientProvider client={cache}>
      <SafetyTasksView {...p} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /External officer update/ }));
  await screen.findByText(/Version 1/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh tasks' }));
  expect(await screen.findByText('Officer submitted work')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Review task' })).not.toBeNull();
});

it('Task creation opens on demand and Cancel returns focus without losing the list', async () => {
  const p = {
    ...props,
    user: { ...props.user, roleAssignments: [{ role: 'SITE_MANAGER' as const, siteId: 'site' }] },
  };
  vi.spyOn(props.client, 'listSafetyTasks').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(props.client, 'listSafetyAssignees').mockResolvedValue({ items: [], total: 0 });
  mount(<SafetyTasksView {...p} />);
  await screen.findByText('No safety tasks found.');
  expect(screen.queryByLabelText('Task description')).toBeNull();
  const trigger = screen.getByRole('button', { name: 'New safety task' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'New safety task' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByText('No safety tasks found.')).not.toBeNull();
});
it('Result photo preview rejects oversized files and Remove photo clears the submitted file', () => {
  const create = vi.fn(() => 'blob:preview'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  let submitted: FormData | undefined;
  render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitted = new FormData(e.currentTarget);
      }}
    >
      <ResultFields />
      <button>Send</button>
    </form>,
  );
  const input = screen.getByLabelText('Photo (optional JPEG, max 1 MiB)');
  fireEvent.change(input, {
    target: { files: [new File(['abc'], 'result.jpg', { type: 'image/jpeg' })] },
  });
  expect(screen.getByRole('img', { name: 'Selected result photo' }).getAttribute('src')).toBe(
    'blob:preview',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:preview');
  fireEvent.change(screen.getByLabelText('Result description'), {
    target: { value: 'Synthetic result' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect((submitted?.get('file') as File).size).toBe(0);
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array(1048577)], 'large.jpg', { type: 'image/jpeg' })] },
  });
  expect(screen.getByRole('alert').textContent).toContain('1 MiB');
  expect(screen.queryByRole('img')).toBeNull();
});

it('Assignee selection survives paging through other active officers', async () => {
  const p = {
    ...props,
    user: { ...props.user, roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: 'site' }] },
  };
  vi.spyOn(props.client, 'listSafetyAssignees').mockImplementation(
    async (_token, _site, _role, page) => ({
      items: page?.offset
        ? [{ id: 'second', displayName: 'Second officer' }]
        : [{ id: 'first', displayName: 'First officer' }],
      total: 21,
    }),
  );
  mount(<Assignee p={p} role="SECURITY_OFFICER" />);
  await screen.findByRole('option', { name: 'First officer' });
  fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'first' } });
  fireEvent.click(screen.getByRole('button', { name: 'More assignees' }));
  await screen.findByRole('option', { name: 'Second officer' });
  expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe('first');
});

it('Confirming a filtered alert keeps its detail available for creating an Incident', async () => {
  const officer = {
    ...props.user,
    id: 'safety',
    roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: 'site' }],
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue({
    accessToken: 'token',
    tokenType: 'Bearer',
    accessTokenExpiresAt: timestamp,
    refreshTokenExpiresAt: timestamp,
    user: officer,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'A', name: 'A', createdAt: timestamp }],
    total: 1,
  });
  const alert = {
    id: 'reviewed-alert',
    siteId: 'site',
    zoneId: null,
    incidentId: null,
    candidateWorkerId: null,
    alertType: 'PPE_VIOLATION' as const,
    candidateSubtype: 'NO_HARD_HAT',
    status: 'PENDING_REVIEW' as const,
    firstDetectedAt: timestamp,
    lastDetectedAt: timestamp,
    detectionCount: 1,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  let reviewed = false;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockImplementation(
    async () => ({ items: reviewed ? [] : [alert], total: reviewed ? 0 : 1 }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(async () => ({
    ...alert,
    status: reviewed ? 'CONFIRMED' : 'PENDING_REVIEW',
    revision: reviewed ? 2 : 1,
    detections: [],
    detectionsTotal: 0,
    reviews: [],
    reviewsTotal: 0,
  }));
  vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockImplementation(
    async () => {
      reviewed = true;
      return {
        alert: { ...alert, status: 'CONFIRMED', revision: 2 },
        review: {
          id: 'review',
          alertId: alert.id,
          siteId: alert.siteId,
          actorUserId: 'safety',
          fromStatus: 'PENDING_REVIEW',
          toStatus: 'CONFIRMED',
          reason: 'Synthetic confirmed evidence',
          alertRevision: 2,
          createdAt: timestamp,
        },
        replayed: false,
      };
    },
  );
  mount(<SafetyAlertsView apiUrl="http://local" initialStatus="PENDING_REVIEW" />);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'safety' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Fake123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.change(await screen.findByLabelText('Decision reason (minimum 5 characters)'), {
    target: { value: 'Synthetic confirmed evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm violation' }));
  expect(await screen.findByText('No alerts match the selected Site and filters.')).not.toBeNull();
  expect(await screen.findByRole('button', { name: 'Create incident from alert' })).not.toBeNull();
});

it('Reopened Incident can close after its new action is verified while old actions remain Closed', async () => {
  const p = {
    ...props,
    user: {
      ...props.user,
      id: 'safety',
      roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: 'site' }],
    },
  };
  const action = (id: string, status: 'CLOSED' | 'VERIFIED') => ({
    id,
    incidentId: 'incident',
    assignedTo: 'security',
    assignedBy: 'safety',
    description: id === 'old' ? 'Previously closed work' : 'Verified follow-up',
    dueAt: null,
    status,
    version: 4,
    createdAt: timestamp,
    updatedAt: timestamp,
    submissions: [
      {
        id: 'result-' + id,
        correctiveActionId: id,
        submittedBy: 'security',
        resultDescription: 'Synthetic verified result',
        submittedAt: timestamp,
        status: 'APPROVED' as const,
        evidence: null,
        reviewedBy: 'safety',
        reviewedAt: timestamp,
        reviewNote: 'Verified',
      },
    ],
  });
  const incident = {
    id: 'incident',
    siteId: 'site',
    zoneId: null,
    title: 'Reopened verified case',
    description: 'Follow-up completed',
    severity: 'LOW' as const,
    status: 'VERIFIED' as const,
    occurredAt: timestamp,
    reportedBy: 'safety',
    closedBy: null,
    closedAt: null,
    version: 12,
    createdAt: timestamp,
    updatedAt: timestamp,
    alerts: [],
    actions: [action('old', 'CLOSED'), action('new', 'VERIFIED')],
    audit: [],
  };
  vi.spyOn(props.client, 'listIncidents').mockResolvedValue({ items: [incident], total: 1 });
  vi.spyOn(props.client, 'getIncident').mockResolvedValue(incident);
  vi.spyOn(props.client, 'listSafetyAssignees').mockResolvedValue({ items: [], total: 0 });
  mount(<IncidentView {...p} />);
  fireEvent.click(await screen.findByRole('button', { name: /Reopened verified case/ }));
  await screen.findByText('Follow-up completed');
  expect(
    (screen.getByRole('button', { name: 'Close incident' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

it('Dialog keeps keyboard focus cycling between its first and last control', () => {
  mount(
    <Dialog title="Keyboard form" onClose={() => {}}>
      <input aria-label="Example" />
      <button type="button">Send</button>
    </Dialog>,
  );
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const send = screen.getByRole('button', { name: 'Send' });
  cancel.focus();
  fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(send);
  fireEvent.keyDown(send, { key: 'Tab' });
  expect(document.activeElement).toBe(cancel);
});
