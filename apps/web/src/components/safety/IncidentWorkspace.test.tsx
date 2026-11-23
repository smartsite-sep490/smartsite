// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type IncidentDetailResponse } from '@smartsite/api-client';
import { IncidentView } from './IncidentView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const client = new SmartSiteManagementClient('https://example.test');
const fixture: IncidentDetailResponse = {
  id: 'incident-a',
  siteId: 'site-a',
  contractorId: 'contractor-a',
  title: 'Repair the barrier',
  description: 'Repair description',
  severity: 'HIGH',
  status: 'ASSIGNED',
  zoneId: null,
  occurredAt: '2026-11-22T01:00:00Z',
  reportedBy: 'safety-id',
  reportedByName: 'Safety Officer',
  contractorName: 'Contractor',
  closedBy: null,
  closedAt: null,
  version: 7,
  createdAt: '',
  updatedAt: '',
  workerIds: [],
  responsibilityReason: 'Verified',
  responsibilityConfirmedBy: 'safety-id',
  responsibilityConfirmedAt: '2026-11-22T01:00:00Z',
  alerts: [],
  audit: [],
  actions: [
    {
      id: 'action-a',
      incidentId: 'incident-a',
      assignedTo: 'rep',
      assignedBy: 'safety-id',
      description: 'Install a barrier',
      dueAt: null,
      status: 'ASSIGNED',
      version: 1,
      createdAt: '',
      updatedAt: '',
      submissions: [],
    },
  ],
};
function mount(actionId?: string, safety = false, record = fixture) {
  const other = {
    ...fixture,
    id: 'incident-b',
    title: 'Another incident',
    actions: [{ ...fixture.actions[0]!, id: 'action-b' }],
  };
  vi.spyOn(client, 'listIncidents').mockResolvedValue({ items: [record, other], total: 2 });
  vi.spyOn(client, 'getIncident').mockImplementation(async (_token, _site, id) =>
    id === 'incident-b' ? other : record,
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <IncidentView
        client={client}
        apiUrl="https://example.test"
        token="synthetic"
        scope="rep"
        siteId="site-a"
        user={{
          id: safety ? 'safety' : 'rep',
          username: 'rep',
          displayName: 'Representative',
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [
            { role: safety ? 'SAFETY_OFFICER' : 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' },
          ],
        }}
        initialIncidentId="incident-a"
        initialActionId={actionId}
      />
    </QueryClientProvider>,
  );
}
it('opens summary first and separates handling, evidence and history without raw IDs', async () => {
  mount();
  expect(await screen.findByRole('tab', { name: 'Summary' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Summary' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('button', { name: 'Start handling' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Handling' }));
  expect(await screen.findByRole('button', { name: 'Start handling' })).toBeTruthy();
  expect(screen.queryByText('Technical details')).toBeNull();
  expect(screen.queryByText(/safety-id/)).toBeNull();
});
it('opens the linked handover on Handling and reports an unavailable action without choosing another', async () => {
  mount('missing-action');
  expect(await screen.findByText('This handover is no longer available.')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Handling' }).getAttribute('aria-selected')).toBe('true');
});

it('releases the notification action when another incident is selected manually', async () => {
  mount('action-a');
  await screen.findByRole('button', { name: 'Start handling' });
  fireEvent.click(screen.getByRole('button', { name: /Another incident/ }));
  await screen.findByRole('heading', { name: 'Another incident' });
  fireEvent.click(screen.getByRole('tab', { name: 'Handling' }));
  expect(await screen.findByRole('button', { name: 'Start handling' })).toBeTruthy();
  expect(screen.queryByText('This handover is no longer available.')).toBeNull();
});

it('reviews only the submission belonging to the handover selected in the fixed footer', async () => {
  const record: IncidentDetailResponse = {
    ...fixture,
    actions: ['a', 'b'].map((suffix) => ({
      ...fixture.actions[0]!,
      id: 'action-' + suffix,
      description: 'Repair ' + suffix,
      status: 'SUBMITTED',
      submissions: [
        {
          id: 'submission-' + suffix,
          correctiveActionId: 'action-' + suffix,
          submittedBy: 'rep',
          resultDescription: 'Completed ' + suffix,
          submittedAt: '2026-11-22T01:00:00Z',
          status: 'PENDING',
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          evidence: null,
        },
      ],
    })),
  };
  const command = vi
    .spyOn(client, 'incidentCommand')
    .mockResolvedValue({ resource: record, replayed: false });
  mount('action-a', true, record);
  fireEvent.click(await screen.findByRole('button', { name: 'Repair b' }));
  const footer = document.querySelector('.workflow-detail-footer')! as HTMLElement;
  expect(footer.textContent).toContain('Handover 2');
  fireEvent.click(within(footer).getByRole('button', { name: 'Request rework' }));
  expect(
    (screen.getByRole('combobox', { name: 'Review decision' }) as HTMLSelectElement).value,
  ).toBe('REJECTED');
  fireEvent.change(screen.getByLabelText('Recording note'), {
    target: { value: 'Please recheck the second handover' },
  });
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Record handling outcome',
    }),
  );
  await waitFor(() => expect(command).toHaveBeenCalled());
  expect(command.mock.calls[0]?.[4]).toMatchObject({
    submissionId: 'submission-b',
    decision: 'REJECTED',
  });
  expect(command.mock.calls[0]?.[5]).toBe('action-b');
});
