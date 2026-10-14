import { SafetyOverviewView } from './SafetyOverviewView';
import { ReportChecklistForm } from './ChecklistForms';
// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SafetyAlertsView } from '../alerts/SafetyAlertsView';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const siteId = 'site-a';
const user = {
  id: 'safety',
  username: 'safety',
  displayName: 'Safety Officer',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId }],
};
function mount(initialType?: 'PPE_VIOLATION') {
  const prototype = SmartSiteManagementClient.prototype;
  vi.spyOn(prototype, 'listSites').mockResolvedValue({
    items: [{ id: siteId, code: 'A', name: 'Site A', createdAt: '2026-10-13T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(prototype, 'listSafetyAlerts').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(prototype, 'listSafetyOverviewContractors').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(prototype, 'listSafetyContractors').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(prototype, 'getSafetyOverview').mockResolvedValue({
    site: { id: siteId, code: 'A', name: 'Site A' },
    date: '2026-10-13',
    timezone: 'Asia/Ho_Chi_Minh',
    teams: { items: [], total: 0 },
    unassignedWorkers: { items: [], total: 0 },
  });
  vi.spyOn(prototype, 'listSafetyChecklists').mockResolvedValue({ items: [], total: 0 });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (initialChecklistId?: string) => (
    <QueryClientProvider client={cache}>
      <SafetyAlertsView
        apiUrl="http://local"
        authenticatedSession={{ accessToken: 'token', user }}
        initialType={initialType}
        initialChecklistId={initialChecklistId}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return (id: string) => view.rerender(tree(id));
}
it('Safety opens the overview and has a checklist queue; alert filters stay inside Alerts', async () => {
  mount();
  const overview = await screen.findByRole('button', { name: 'Overview' });
  expect(overview.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByRole('heading', { name: 'Safety overview' })).not.toBeNull();
  expect(screen.queryByLabelText('Alert type')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Checklists' }));
  expect(await screen.findByText('No checklists found.')).not.toBeNull();
});
it('PPE navigation still opens Alerts instead of Overview', async () => {
  mount('PPE_VIOLATION');
  expect((await screen.findByRole('button', { name: 'Alerts' })).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(await screen.findByLabelText('Alert type')).not.toBeNull();
});

it('checklist report keeps missing evidence editable and previews/removes a selected image', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-checklist');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const submit = vi.fn();
  const { container, unmount } = render(
    <ReportChecklistForm
      items={[{ id: 'item', position: 0, text: 'Fall protection', evidenceRequired: true }]}
      pending={false}
      onSubmit={submit}
    />,
  );
  fireEvent.change(screen.getByLabelText('Result: Fall protection'), { target: { value: 'PASS' } });
  fireEvent.submit(container.querySelector('form')!);
  expect(
    await screen.findByText('Add required evidence or report the missing evidence as Fail'),
  ).not.toBeNull();
  expect(submit).not.toHaveBeenCalled();
  const file = new File(['synthetic'], 'proof.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText(/Evidence: Fall protection/), {
    target: { files: [file] },
  });
  expect(await screen.findByAltText('Selected evidence for Fall protection')).not.toBeNull();
  expect(create).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole('button', { name: 'Remove proof.png' }));
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-checklist');
  fireEvent.change(screen.getByLabelText('Result: Fall protection'), { target: { value: 'FAIL' } });
  fireEvent.change(screen.getByLabelText('Notes: Fall protection'), {
    target: { value: 'Equipment missing' },
  });
  fireEvent.submit(container.querySelector('form')!);
  expect(submit).toHaveBeenCalledWith(
    [{ itemId: 'item', answer: 'FAIL', note: 'Equipment missing', fileIndexes: [] }],
    [],
  );
  unmount();
});

it('Overview exposes independent unassigned pagination and opens the counted team alert/checklist context', async () => {
  const client = new SmartSiteManagementClient('http://local');
  const team = {
    id: 'team-a',
    name: 'Height team',
    description: 'Synthetic',
    contractorId: 'contractor-a',
    contractorName: 'Contractor A',
    isActive: true,
    workerCount: 3,
    scheduledWorkerCount: 3,
    attentionAlertCount: 2,
    checklistSummary: {
      total: 0,
      noChecklistAssigned: true,
      notSubmitted: 0,
      needsUpdate: 0,
      awaitingReview: 0,
      recordedWithFindings: 0,
      recordedWithoutFailures: 0,
      pastPlannedStart: 0,
    },
  };
  vi.spyOn(client, 'listSafetyOverviewContractors').mockResolvedValue({
    items: [{ id: 'contractor-a', name: 'Contractor A' }],
    total: 1,
  });
  const overview = vi
    .spyOn(client, 'getSafetyOverview')
    .mockImplementation(async (_token, _site, q) => ({
      site: { id: siteId, name: 'Site A', code: 'A' },
      date: q.date,
      timezone: q.timezone,
      updatedAt: '2026-10-14T01:00:00Z',
      teams: { items: [team], total: 1 },
      unassignedWorkers: {
        total: 21,
        items: [
          {
            id: 'worker-' + (q.unassignedOffset ?? 0),
            displayName: 'Worker ' + (q.unassignedOffset ?? 0),
            externalId: 'synthetic',
            contractorId: 'contractor-a',
            teamId: null,
            startsAt: null,
            endsAt: null,
            shiftName: null,
            isActive: true,
          },
        ],
      },
    }));
  vi.spyOn(client, 'getSafetyTeam').mockResolvedValue({
    ...team,
    date: '2026-10-14',
    timezone: 'Asia/Ho_Chi_Minh',
    workers: { items: [], total: 0 },
    zones: [],
    cameras: [],
  });
  const alerts = vi.fn(),
    checklists = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SafetyOverviewView
        client={client}
        apiUrl="http://local"
        scope="safety"
        siteId={siteId}
        token="token"
        user={user}
        active
        canAlerts
        canAssign
        onAlerts={alerts}
        onChecklist={vi.fn()}
        onViewChecklists={checklists}
      />
    </QueryClientProvider>,
  );
  const section = await screen.findByRole('region', { name: 'Workers without a team' });
  fireEvent.click(within(section).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Worker 20 · No recorded shift')).not.toBeNull();
  expect(overview.mock.calls.some((c) => c[2].unassignedOffset === 20)).toBe(true);
  expect(await screen.findAllByText('No checklist assigned')).not.toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'View related alerts (2)' }));
  expect(alerts).toHaveBeenCalledWith(
    expect.objectContaining({ contextTeamId: 'team-a', attentionOnly: true }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'View checklists for this date' }));
  expect(checklists).toHaveBeenCalledWith('team-a', expect.any(String), 'Height team');
});

it('a checklist notification clears the previous Overview team/date filter', async () => {
  const openLink = mount();
  const team = {
    id: 'team-context',
    name: 'Context team',
    description: '',
    contractorId: 'contractor-a',
    contractorName: 'Contractor A',
    isActive: true,
    workerCount: 1,
    scheduledWorkerCount: 1,
  };
  vi.mocked(SmartSiteManagementClient.prototype.getSafetyOverview).mockResolvedValue({
    site: { id: siteId, name: 'Site A', code: 'A' },
    date: '2026-10-14',
    timezone: 'Asia/Ho_Chi_Minh',
    teams: { items: [team], total: 1 },
    unassignedWorkers: { items: [], total: 0 },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyTeam').mockResolvedValue({
    ...team,
    date: '2026-10-14',
    timezone: 'Asia/Ho_Chi_Minh',
    workers: { items: [], total: 0 },
    zones: [],
    cameras: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyChecklist').mockRejectedValue(
    new Error('Unavailable synthetic checklist'),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'View checklists for this date' }));
  expect(await screen.findByText(/Checklists: Context team/)).not.toBeNull();
  openLink('linked-other');
  expect(await screen.findByText('Unavailable synthetic checklist')).not.toBeNull();
  expect(screen.queryByText(/Checklists: Context team/)).toBeNull();
});
