// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { CreateChecklistForm, ReportChecklistForm } from './ChecklistForms';
import { localInput } from './safety-context';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountCreate(zones = ['zone'], assignees = ['rep'], windows = 1) {
  const client = new SmartSiteManagementClient('http://local');
  const team = {
    id: 'team',
    name: 'Crew',
    contractorId: 'contractor',
    contractorName: 'Contractor',
    description: '',
    isActive: true,
  };
  const workWindows = Array.from({ length: windows }, (_, i) => ({
    shiftName: 'Shift ' + i,
    startsAt: `2026-10-20T0${i + 1}:00:00Z`,
    endsAt: `2026-10-20T0${i + 2}:00:00Z`,
  }));
  vi.spyOn(client, 'listSafetyContractors').mockResolvedValue({
    items: [{ id: 'contractor', name: 'Contractor' }],
    total: 1,
  });
  vi.spyOn(client, 'getSafetyTeamOptions').mockResolvedValue({ items: [team], total: 1 });
  vi.spyOn(client, 'listSafetyAssignees').mockResolvedValue({
    items: assignees.map((id) => ({ id, displayName: id })),
    total: assignees.length,
  });
  vi.spyOn(client, 'getSafetyTeam').mockResolvedValue({
    ...team,
    workerCount: 0,
    scheduledWorkerCount: 0,
    date: '2026-10-20',
    timezone: 'UTC',
    workers: { items: [], total: 0 },
    zones: zones.map((id) => ({
      id,
      name: id,
      code: id,
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2027-01-01T00:00:00Z',
    })),
    cameras: [],
    workWindows,
  });
  const submit = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreateChecklistForm
        client={client}
        apiUrl="http://local"
        token="token"
        scope="scope"
        siteId="site"
        user={{
          id: 'safety',
          username: 'safety',
          displayName: 'Safety',
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site' }],
        }}
        draft={{ teamId: 'team', day: '2026-10-20' }}
        pending={false}
        onSubmit={submit}
      />
    </QueryClientProvider>,
  );
  return { submit, client, workWindows };
}

it('prefills only the single eligible zone and assignee and sends the planned local window', async () => {
  const { submit, workWindows } = mountCreate();
  await screen.findByRole('option', { name: 'rep' });
  await waitFor(() =>
    expect((screen.getByLabelText('Zone') as HTMLSelectElement).value).toBe('zone'),
  );
  expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe('rep');
  expect((screen.getByLabelText('Work starts') as HTMLInputElement).value).toBe(
    localInput(workWindows[0]!.startsAt),
  );
  fireEvent.change(screen.getByLabelText('Work description'), { target: { value: 'Paint wall' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Assign checklist' }).closest('form')!);
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      teamId: 'team',
      zoneId: 'zone',
      assignedTo: 'rep',
      startsAt: workWindows[0]!.startsAt.replace('Z', '.000Z'),
    }),
  );
});

it.each([0, 2])('does not guess from %i zones or assignees', async (count) => {
  mountCreate(
    Array.from({ length: count }, (_, i) => 'zone' + i),
    Array.from({ length: count }, (_, i) => 'rep' + i),
    2,
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Team') as HTMLSelectElement).value).toBe('team'),
  );
  expect((screen.getByLabelText('Zone') as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('Work starts') as HTMLInputElement).value).toBe('');
});

it('switching a template does not overwrite edited criteria until replacement is confirmed', async () => {
  mountCreate();
  fireEvent.change(screen.getByLabelText('Criterion 1'), {
    target: { value: 'Inspect paint tools' },
  });
  fireEvent.change(screen.getByLabelText('Suggested checklist'), {
    target: { value: 'ELECTRICAL' },
  });
  expect((screen.getByLabelText('Criterion 1') as HTMLTextAreaElement).value).toBe(
    'Inspect paint tools',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
  expect((screen.getByLabelText('Criterion 1') as HTMLTextAreaElement).value).toBe(
    'Inspect paint tools',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Replace criteria' }));
  expect((screen.getByLabelText('Criterion 1') as HTMLTextAreaElement).value).not.toBe(
    'Inspect paint tools',
  );
});

it('reporting shows progress and only requires explanations and evidence where applicable', () => {
  const submit = vi.fn();
  render(
    <ReportChecklistForm
      items={[{ id: 'item', position: 0, text: 'Tools', evidenceRequired: false }]}
      pending={false}
      onSubmit={submit}
    />,
  );
  expect(screen.getByText('0 / 1 answered')).not.toBeNull();
  expect(screen.queryByLabelText('Notes: Tools')).toBeNull();
  fireEvent.change(screen.getByLabelText('Result: Tools'), { target: { value: 'PASS' } });
  expect(screen.getByText('1 / 1 answered')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  fireEvent.change(screen.getByLabelText('Notes: Tools'), { target: { value: 'Checked' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Submit checklist' }).closest('form')!);
  expect(submit).toHaveBeenCalledWith(
    [{ itemId: 'item', answer: 'PASS', note: 'Checked', fileIndexes: [] }],
    [],
  );
  fireEvent.change(screen.getByLabelText('Result: Tools'), { target: { value: 'FAIL' } });
  expect((screen.getByLabelText('Notes: Tools') as HTMLTextAreaElement).required).toBe(true);
});
