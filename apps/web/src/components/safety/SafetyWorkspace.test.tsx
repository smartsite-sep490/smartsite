import { SafetyOverviewView } from './SafetyOverviewView';
import { CreateChecklistForm, ReportChecklistForm } from './ChecklistForms';
// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { SafetyZoneContext } from './SafetyZoneContext';
import { SafetyAlertsView } from '../alerts/SafetyAlertsView';
import i18n from '../../i18n';
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
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
  vi.spyOn(prototype, 'getSafetyTeamOptions').mockResolvedValue({ items: [], total: 0 });
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

it('localizes workspace tabs both ways while retaining the chosen checklist tab and open draft', async () => {
  await i18n.changeLanguage('en');
  mount();
  const checklistsTab = await screen.findByRole('button', { name: 'Checklists' });
  await waitFor(() => expect((checklistsTab as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(checklistsTab);
  fireEvent.click(await screen.findByRole('button', { name: 'New checklist' }));
  fireEvent.change(screen.getByLabelText('Work description'), {
    target: { value: 'Safety overview\nMy authored work' },
  });
  fireEvent.change(screen.getByLabelText('Criterion 1'), {
    target: { value: 'Checklist report recorded' },
  });
  const description = screen.getByLabelText('Work description');
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('button', { name: 'Phiếu kiểm tra' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByRole('button', { name: 'Tổng quan' }).getAttribute('aria-pressed')).toBe(
    'false',
  );
  expect(screen.getByRole('button', { name: 'Cảnh báo' })).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Sự cố' })).not.toBeNull();
  expect(screen.getByLabelText('Mô tả công việc')).toBe(description);
  expect((description as HTMLTextAreaElement).value).toBe('Safety overview\nMy authored work');
  expect((screen.getByLabelText('Tiêu chí 1') as HTMLTextAreaElement).value).toBe(
    'Checklist report recorded',
  );
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('button', { name: 'Checklists' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getByLabelText('Work description')).toBe(description);
  expect((screen.getByLabelText('Criterion 1') as HTMLTextAreaElement).value).toBe(
    'Checklist report recorded',
  );
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
  vi.spyOn(client, 'getSafetyTeamOptions').mockResolvedValue({ items: [team], total: 1 });
  vi.spyOn(client, 'listSafetyChecklists').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(client, 'listSafetyZoneTeams').mockResolvedValue({ items: [], total: 0 });
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
  const weekly = vi.spyOn(client, 'getSafetyWeek').mockResolvedValue({
    site: { id: siteId, name: 'Site A', code: 'A' },
    weekStart: '2026-10-12',
    weekEnd: '2026-10-18',
    timezone: 'Asia/Ho_Chi_Minh',
    updatedAt: '2026-10-14T01:00:00Z',
    teams: {
      items: [
        {
          ...team,
          days: Array.from({ length: 7 }, (_, i) => ({
            date: '2026-10-' + (12 + i),
            scheduledWorkerCount: i === 3 ? 3 : 0,
            workWindows: [],
          })),
        },
      ],
      total: 1,
    },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Week$/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Height team on 2026-10-15' }));
  fireEvent.click(await screen.findByRole('button', { name: 'View checklists for this date' }));
  expect(checklists).toHaveBeenLastCalledWith('team-a', '2026-10-15', 'Height team');
  expect(screen.getByRole('button', { name: /^Week$/ }).getAttribute('aria-pressed')).toBe('true');
  expect(weekly.mock.calls.length).toBeLessThanOrEqual(2);
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
  expect(await screen.findByText('Something went wrong. Please try again.')).not.toBeNull();
  expect(screen.queryByText(/Checklists: Context team/)).toBeNull();
});

it('Manager sees camera context but never requests Alert evidence', async () => {
  const client = new SmartSiteManagementClient('http://local');
  vi.spyOn(client, 'listSafetyZoneTeams').mockResolvedValue({ items: [], total: 0 });
  const image = vi.spyOn(client, 'getSafetyAlertEvidence');
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SafetyZoneContext
        client={client}
        apiUrl="http://local"
        scope="manager"
        siteId={siteId}
        token="token"
        user={user}
        active
        canAlerts={false}
        day="2026-10-14"
        timezone="Asia/Ho_Chi_Minh"
        onAlerts={vi.fn()}
        detail={{
          id: 'team',
          name: 'Team',
          description: '',
          contractorId: 'contractor',
          contractorName: 'Contractor',
          isActive: true,
          workerCount: 1,
          scheduledWorkerCount: 1,
          date: '2026-10-14',
          timezone: 'Asia/Ho_Chi_Minh',
          workers: { items: [], total: 0 },
          zones: [
            {
              id: 'zone',
              name: 'Zone A',
              code: 'A',
              validFrom: '2026-10-01T00:00:00Z',
              validUntil: '2026-11-01T00:00:00Z',
            },
          ],
          cameras: [
            {
              id: 'camera',
              externalId: 'CAM-A',
              name: 'Camera A',
              code: 'A',
              status: 'ACTIVE',
              zoneId: 'zone',
              latestEvidence: {
                alertId: 'alert',
                eventId: 'event',
                capturedAt: '2026-10-14T01:00:00Z',
                evidenceIndex: 0,
              },
            },
          ],
        }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Alert evidence requires Safety or Admin access.')).not.toBeNull();
  expect(image).not.toHaveBeenCalled();
  expect(screen.queryByText(/live feed/)).not.toBeNull();
});
it('a checklist draft uses the single planned shift', async () => {
  const client = new SmartSiteManagementClient('http://local'),
    team = {
      id: 'team',
      name: 'Team',
      description: '',
      contractorId: 'contractor',
      contractorName: 'Contractor',
      isActive: true,
    };
  vi.spyOn(client, 'listSafetyContractors').mockResolvedValue({
    items: [{ id: 'contractor', name: 'Contractor' }],
    total: 1,
  });
  vi.spyOn(client, 'getSafetyTeamOptions').mockResolvedValue({ items: [team], total: 1 });
  vi.spyOn(client, 'listSafetyAssignees').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(client, 'getSafetyTeam').mockResolvedValue({
    ...team,
    workerCount: 1,
    scheduledWorkerCount: 1,
    date: '2026-10-14',
    timezone: 'Asia/Ho_Chi_Minh',
    workers: { items: [], total: 0 },
    zones: [],
    cameras: [],
    workWindows: [
      { startsAt: '2026-10-14T02:30:00Z', endsAt: '2026-10-14T04:30:00Z', shiftName: 'Morning' },
    ],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreateChecklistForm
        client={client}
        apiUrl="http://local"
        scope="safety"
        siteId={siteId}
        token="token"
        user={user}
        pending={false}
        draft={{ teamId: 'team', day: '2026-10-14' }}
        onSubmit={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await screen.findByText(/The team's Zone grant/);
  const expected = new Date('2026-10-14T02:30:00Z');
  await waitFor(() =>
    expect((screen.getByLabelText('Work starts') as HTMLInputElement).value).toContain(
      String(expected.getHours()).padStart(2, '0') + ':30',
    ),
  );
});
