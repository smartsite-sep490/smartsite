// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type ChecklistDetailResponse,
} from '@smartsite/api-client';
import { IncidentView } from './IncidentView';
import { SafetyChecklistsView } from './SafetyChecklistsView';
import { createSafetyFixture, siteId, repId } from '../../../e2e/safety-workflow-fixture';
import i18n from '../../i18n';

const client = new SmartSiteManagementClient('https://example.test');
let fixture: ReturnType<typeof createSafetyFixture>;
let checklist: ChecklistDetailResponse;
beforeEach(async () => {
  await i18n.changeLanguage('en');
  fixture = createSafetyFixture();
  fixture.setRole('CONTRACTOR_REPRESENTATIVE');
  checklist = {
    id: 'checklist-a',
    siteId,
    contractorId: 'contractor',
    contractorName: 'Synthetic contractor',
    teamId: 'team',
    teamName: 'Synthetic team',
    zoneId: 'zone',
    zoneName: 'Synthetic zone',
    assignedTo: repId,
    assignedToName: 'Representative',
    assignedBy: 'safety',
    assignedByName: 'Safety',
    description: 'Inspect the barrier',
    status: 'ASSIGNED',
    version: 1,
    startsAt: '2026-11-23T01:00:00Z',
    endsAt: '2026-11-23T10:00:00Z',
    createdAt: '',
    updatedAt: '',
    items: [{ id: 'item-a', position: 0, text: 'Barrier installed', evidenceRequired: false }],
    submissions: [],
    audit: [],
  };
  vi.spyOn(client, 'listIncidents').mockImplementation(async () => ({
    items: structuredClone(fixture.incidents.slice(0, 20)),
    total: 48,
  }));
  vi.spyOn(client, 'getIncident').mockImplementation(async (_token, _site, id) =>
    structuredClone(fixture.incidents.find((item) => item.id === id)!),
  );
  vi.spyOn(client, 'listSafetyChecklists').mockImplementation(async () => ({
    items: [structuredClone(checklist)],
    total: 1,
  }));
  vi.spyOn(client, 'getSafetyChecklist').mockImplementation(async () => structuredClone(checklist));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(kind: 'incident' | 'checklist') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const p = {
    client,
    apiUrl: 'https://example.test',
    token: 'synthetic',
    scope: repId,
    siteId,
    user: fixture.user(),
  };
  return render(
    <QueryClientProvider client={cache}>
      {kind === 'incident' ? (
        <IncidentView
          {...p}
          initialIncidentId={fixture.incidents[1]!.id}
          initialActionId={fixture.incidents[1]!.actions[0]?.id}
        />
      ) : (
        <SafetyChecklistsView
          {...p}
          active
          initialChecklistId={checklist.id}
          onDraftConsumed={() => {}}
          onIncident={() => {}}
        />
      )}
    </QueryClientProvider>,
  );
}
function unconfirmedSafety() {
  fixture.setRole('SAFETY_OFFICER');
  const record = fixture.incidents[1]!;
  record.contractorId = null;
  record.contractorName = null;
  record.actions = [];
  record.responsibilityConfirmedAt = null;
  record.responsibilityConfirmedBy = null;
  vi.spyOn(client, 'listSafetyContractors').mockResolvedValue({
    items: [{ id: 'contractor-a', name: 'Contractor A' }],
    total: 1,
  });
  vi.spyOn(client, 'listIncidentWorkers').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(client, 'listSafetyAssignees').mockResolvedValue({
    items: [{ id: repId, displayName: 'Representative' }],
    total: 1,
  });
  return record;
}
async function fillHandover() {
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm and hand over' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Contractor A' });
  fireEvent.change(within(dialog).getByLabelText('Responsible contractor'), {
    target: { value: 'contractor-a' },
  });
  await within(dialog).findByRole('option', { name: 'Representative' });
  fireEvent.change(within(dialog).getByLabelText('Assignee'), { target: { value: repId } });
  fireEvent.change(within(dialog).getByLabelText('Verification reason'), {
    target: { value: 'Verified with contractor representative' },
  });
  fireEvent.change(within(dialog).getByLabelText('Handling request'), {
    target: { value: 'Repair the barrier' },
  });
  return dialog;
}
it('keeps a partially confirmed handover open and retries only assignment with the same command', async () => {
  const record = unconfirmedSafety();
  let assignments = 0;
  const command = vi
    .spyOn(client, 'incidentCommand')
    .mockImplementation(async (_token, _site, _id, operation) => {
      if (operation === 'responsibility') {
        record.contractorId = 'contractor-a';
        record.version++;
      }
      if (operation === 'assign' && assignments++ === 0)
        throw new ApiError('network', 'Connection lost');
      return { resource: structuredClone(record), replayed: false };
    });
  mount('incident');
  const dialog = await fillHandover();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and hand over' }));
  await within(dialog).findByText('Contractor confirmed. Handover is not complete yet.');
  expect((within(dialog).getByLabelText('Handling request') as HTMLTextAreaElement).value).toBe(
    'Repair the barrier',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hand over to contractor' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(command.mock.calls.map((call) => call[3])).toEqual(['responsibility', 'assign', 'assign']);
  expect(command.mock.calls[1]![4].commandId).toBe(command.mock.calls[2]![4].commandId);
  expect(command.mock.calls[1]![4].expectedVersion).toBe(record.version);
});
it('allows confirming responsibility without entering a handover', async () => {
  unconfirmedSafety();
  const command = vi
    .spyOn(client, 'incidentCommand')
    .mockResolvedValue({ resource: fixture.incidents[1]!, replayed: false });
  mount('incident');
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm and hand over' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Contractor A' });
  fireEvent.change(within(dialog).getByLabelText('Responsible contractor'), {
    target: { value: 'contractor-a' },
  });
  fireEvent.change(within(dialog).getByLabelText('Verification reason'), {
    target: { value: 'Confirmed owner' },
  });
  const only = within(dialog).getByRole('button', { name: 'Only confirm responsibility' });
  fireEvent(
    only.closest('form')!,
    new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: only }),
  );
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  expect(command.mock.calls[0]![3]).toBe('responsibility');
});
function incidentStart() {
  return vi
    .spyOn(client, 'incidentCommand')
    .mockImplementation(async (_token, _site, id, operation) => {
      const record = fixture.incidents.find((item) => item.id === id)!;
      const action = record.actions[0]!;
      action.status = operation === 'start' ? 'IN_PROGRESS' : 'SUBMITTED';
      action.version++;
      record.version++;
      return { resource: structuredClone(record), replayed: false };
    });
}
it('opens the action report after Start and submits with the returned action version', async () => {
  const command = incidentStart();
  mount('incident');
  fireEvent.click(await screen.findByRole('button', { name: 'Start handling' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Result description'), {
    target: { value: 'Barrier repaired' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Report handling outcome' }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command.mock.calls[1]![3]).toBe('submit');
  expect(command.mock.calls[1]![4]).toEqual(
    expect.objectContaining({ expectedVersion: 2, resultDescription: 'Barrier repaired' }),
  );
});
it('opens the checklist report after Start, and cancelling leaves it in progress', async () => {
  const start = vi.spyOn(client, 'checklistCommand').mockImplementation(async () => {
    checklist.status = 'IN_PROGRESS';
    checklist.version = 2;
    return { resource: structuredClone(checklist), replayed: false };
  });
  mount('checklist');
  fireEvent.click(await screen.findByRole('button', { name: 'Start checklist' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Report checklist' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(start).toHaveBeenCalledTimes(1);
  expect(checklist.status).toBe('IN_PROGRESS');
});
it('does not open an old action report after selecting another incident during Start', async () => {
  let finish!: () => void;
  vi.spyOn(client, 'incidentCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => {
          const record = fixture.incidents[1]!;
          record.actions[0]!.status = 'IN_PROGRESS';
          resolve({ resource: structuredClone(record), replayed: false });
        };
      }),
  );
  mount('incident');
  fireEvent.click(await screen.findByRole('button', { name: 'Start handling' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(fixture.incidents[2]!.title) }));
  await act(async () => finish());
  await screen.findByRole('heading', { name: fixture.incidents[2]!.title });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not open a report when Start fails', async () => {
  vi.spyOn(client, 'incidentCommand').mockRejectedValue(
    new ApiError('http', 'Start conflict', 409),
  );
  mount('incident');
  fireEvent.click(await screen.findByRole('button', { name: 'Start handling' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('replays an uncertain confirmation before handing over with its returned version', async () => {
  const record = unconfirmedSafety();
  let confirmations = 0;
  const command = vi
    .spyOn(client, 'incidentCommand')
    .mockImplementation(async (_token, _site, _id, operation) => {
      if (operation === 'responsibility' && confirmations++ === 0) {
        record.contractorId = 'contractor-a';
        record.version = 2;
        throw new ApiError('network', 'Lost confirmation response');
      }
      return { resource: structuredClone(record), replayed: operation === 'responsibility' };
    });
  mount('incident');
  const dialog = await fillHandover();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and hand over' }));
  const retry = await within(dialog).findByRole('button', { name: 'Retry previous request' });
  expect(within(dialog).queryByRole('button', { name: 'Only confirm responsibility' })).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(command.mock.calls.map((c) => c[3])).toEqual([
    'responsibility',
    'responsibility',
    'assign',
  ]);
  expect(command.mock.calls[0]![4]).toEqual(command.mock.calls[1]![4]);
  expect(command.mock.calls[2]![4].expectedVersion).toBe(2);
});

it('does not open a stale checklist report after the site changes during Start', async () => {
  let finish!: () => void;
  vi.spyOn(client, 'checklistCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            resource: { ...checklist, status: 'IN_PROGRESS', version: 2 },
            replayed: false,
          });
      }),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (site: string) => (
    <QueryClientProvider client={cache}>
      <SafetyChecklistsView
        client={client}
        apiUrl="https://example.test"
        token="synthetic"
        scope={repId}
        siteId={site}
        user={fixture.user()}
        active
        initialChecklistId={checklist.id}
        onDraftConsumed={() => {}}
        onIncident={() => {}}
      />
    </QueryClientProvider>
  );
  const mounted = render(view(siteId));
  fireEvent.click(await screen.findByRole('button', { name: 'Start checklist' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  mounted.rerender(view('another-site'));
  await act(async () => finish());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('reloads a conflicting partial handover without losing its draft or confirming again', async () => {
  const record = unconfirmedSafety();
  let assigned = 0;
  const command = vi
    .spyOn(client, 'incidentCommand')
    .mockImplementation(async (_token, _site, _id, operation) => {
      if (operation === 'responsibility') {
        record.contractorId = 'contractor-a';
        record.version = 2;
      }
      if (operation === 'assign' && assigned++ === 0) {
        record.version = 3;
        throw new ApiError('http', 'Version conflict', 409);
      }
      return { resource: structuredClone(record), replayed: false };
    });
  mount('incident');
  const dialog = await fillHandover();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and hand over' }));
  fireEvent.click(await within(dialog).findByRole('button', { name: 'Reload data' }));
  await waitFor(() =>
    expect(
      (within(dialog).getByRole('button', { name: 'Hand over to contractor' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect((within(dialog).getByLabelText('Handling request') as HTMLTextAreaElement).value).toBe(
    'Repair the barrier',
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hand over to contractor' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(command.mock.calls.map((c) => c[3])).toEqual(['responsibility', 'assign', 'assign']);
  expect(command.mock.calls[2]![4].expectedVersion).toBe(3);
});

it('does not open a checklist report after its mounted workspace becomes inactive', async () => {
  let finish!: () => void;
  vi.spyOn(client, 'checklistCommand').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            resource: { ...checklist, status: 'IN_PROGRESS', version: 2 },
            replayed: false,
          });
      }),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = (active: boolean) => (
    <QueryClientProvider client={cache}>
      <SafetyChecklistsView
        client={client}
        apiUrl="https://example.test"
        token="synthetic"
        scope={repId}
        siteId={siteId}
        user={fixture.user()}
        active={active}
        initialChecklistId={checklist.id}
        onDraftConsumed={() => {}}
        onIncident={() => {}}
      />
    </QueryClientProvider>
  );
  const mounted = render(view(true));
  fireEvent.click(await screen.findByRole('button', { name: 'Start checklist' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  mounted.rerender(view(false));
  await act(async () => finish());
  mounted.rerender(view(true));
  expect(screen.queryByRole('dialog')).toBeNull();
});
