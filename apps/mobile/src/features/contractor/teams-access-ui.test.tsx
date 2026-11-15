import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ContractorTeamResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { MobileLayoutProvider } from '../shared/mobile-layout';
import { Choice } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { ScrollDateTimePicker } from '../shared/scroll-date-time-picker';
import { translate as t } from '../../i18n';
import { TeamsScreen } from './teams-screen';
import { AccessScreen } from '../access/access-screen';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>, cache: QueryClient, root: ReactTestRenderer;
const team: ContractorTeamResponse = {
  id: 'team',
  siteId: 'site',
  contractorId: 'contractor',
  name: 'Team A',
  description: 'Synthetic team',
  isActive: true,
  memberCount: 1,
  version: 3,
};
const from = '2026-11-01T00:00:00Z',
  to = '2026-12-01T00:00:00Z';
const accessData = {
  canReviewAssignments: false,
  canGrantContractorZones: false,
  canGrantWorkerZones: true,
  participations: [
    {
      id: 'participation',
      contractorId: 'contractor',
      name: 'Own',
      validFrom: from,
      validUntil: to,
    },
    {
      id: 'other-participation',
      contractorId: 'other',
      name: 'Other',
      validFrom: from,
      validUntil: to,
    },
  ],
  workers: [
    { id: 'worker', contractorId: 'contractor', name: 'Own Worker' },
    { id: 'private-worker', contractorId: 'other', name: 'Private Worker' },
  ],
  zones: [
    { id: 'zone', name: 'Own Zone' },
    { id: 'private-zone', name: 'Private Zone' },
  ],
  assignments: [
    {
      id: 'assignment',
      workerId: 'worker',
      workerName: 'Own Worker',
      siteContractorId: 'participation',
      status: 'APPROVED',
      validFrom: from,
      validUntil: to,
      version: 1,
      reviewNote: null,
    },
    {
      id: 'private-assignment',
      workerId: 'private-worker',
      workerName: 'Private Worker',
      siteContractorId: 'other-participation',
      status: 'APPROVED',
      validFrom: from,
      validUntil: to,
      version: 1,
      reviewNote: null,
    },
  ],
  contractorPermissions: [
    {
      id: 'permission',
      siteContractorId: 'participation',
      zoneId: 'zone',
      validFrom: from,
      validUntil: to,
      revokedAt: null,
    },
    {
      id: 'private-permission',
      siteContractorId: 'other-participation',
      zoneId: 'private-zone',
      validFrom: from,
      validUntil: to,
      revokedAt: null,
    },
  ],
  workerPermissions: [
    {
      id: 'worker-permission',
      workerAssignmentId: 'assignment',
      contractorZonePermissionId: 'permission',
      validFrom: from,
      validUntil: to,
      revokedAt: null,
    },
    {
      id: 'private-worker-permission',
      workerAssignmentId: 'private-assignment',
      contractorZonePermissionId: 'private-permission',
      validFrom: from,
      validUntil: to,
      revokedAt: null,
    },
  ],
};
const buttons = (label: string) =>
  root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
async function mount(element: React.ReactNode) {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <MobileLayoutProvider compact>{element}</MobileLayoutProvider>
      </QueryClientProvider>,
    );
  });
  for (let n = 0; n < 20 && cache.isFetching(); n++) await settle();
  await settle();
}
async function click(label: string) {
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => buttons(label)[0]!.props.onPress());
  await settle();
}
async function text(label: string, value: string) {
  const input = root.root.findAll(
    (node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === label,
  )[0]!;
  await act(async () => input.props.onChangeText(value));
}
async function choose(label: string, value: string) {
  const field = root.root.findAllByType(Choice).find((node) => node.props.label === label)!;
  expect(field.props.options.some((option: { value: string }) => option.value === value)).toBe(
    true,
  );
  await act(async () => field.props.onChange(value));
}
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const client = new SmartSiteManagementClient('https://synthetic.test');
  workspace = {
    client,
    token: 'token',
    workerId: '',
    queryKey: ['mobile', 'teams-access'],
    user: {
      id: 'rep',
      username: 'rep',
      displayName: 'Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [],
    },
    scope: {
      role: 'contractor',
      siteId: 'site',
      siteName: 'Site',
      contractorId: 'contractor',
      contractorName: 'Contractor',
    },
  };
  vi.spyOn(client, 'listContractorTeams').mockResolvedValue({ items: [team], total: 1 });
  vi.spyOn(client, 'contractorTeamDetail').mockResolvedValue(team);
  vi.spyOn(client, 'listContractorTeamWorkers').mockResolvedValue({
    items: [
      {
        workerId: 'worker',
        displayName: 'Own Worker',
        membershipId: 'old-membership',
        teamId: 'other-team',
        teamName: 'Team B',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'teamZoneSetup').mockResolvedValue({
    permissions: [],
    availableZones: [
      {
        permissionId: 'permission',
        zoneId: 'zone',
        name: 'Own Zone',
        validFrom: from,
        validUntil: to,
      },
    ],
  });
  vi.spyOn(client, 'createContractorTeam').mockResolvedValue(team);
  vi.spyOn(client, 'assignContractorTeam').mockResolvedValue({
    workerId: 'worker',
    displayName: 'Own Worker',
    membershipId: 'membership',
    teamId: 'team',
    teamName: 'Team A',
  });
  vi.spyOn(client, 'grantTeamZone').mockResolvedValue({ id: 'team-zone' });
  vi.spyOn(client, 'accessSetup').mockResolvedValue(accessData);
  vi.spyOn(client, 'grantWorkerZone').mockResolvedValue({ id: 'new-permission' });
  vi.spyOn(client, 'createWorkerSiteZoneAssignment').mockResolvedValue({
    id: 'new-assignment',
    workerId: 'worker',
    siteId: 'site',
    zoneIds: ['zone'],
    status: 'PENDING',
    validFrom: from,
    validUntil: to,
    requestedByUserId: 'rep',
    safetyReviewedByUserId: null,
    siteManagerDecidedByUserId: null,
    createdAt: from,
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});

it('creates a team from the shared sheet and preserves the scoped API and request id', async () => {
  await mount(<TeamsScreen />);
  await click(t('teams.createTeam'));
  await text(t('teams.newTeamName'), 'New Team');
  await text(t('teams.newTeamDesc'), 'New crew');
  await click(t('teams.saveTeam'));
  expect(workspace.client.createContractorTeam).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    { name: 'New Team', description: 'New crew', requestId: expect.any(String) },
  );
  expect(buttons(t('teams.saveTeam'))[0]!.props.disabled).toBe(true);
});

it('keeps archival disabled for a nonempty team and submits membership changes from its sheet', async () => {
  await mount(<TeamsScreen selectedTeam={team} />);
  await click(t('contractorUi.archiveTeam'));
  await text(t('teams.membershipReason'), 'Close this team');
  expect(buttons(t('teams.archiveEmpty'))[0]!.props.disabled).toBe(true);
  await click(t('common.close'));
  await click(t('contractorUi.manageMembers'));
  await choose(t('teams.workerToMove'), 'worker');
  await text(t('teams.membershipReason'), 'Move to Team A');
  await click(t('teams.confirmMembership'));
  expect(workspace.client.assignContractorTeam).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    'worker',
    {
      teamId: 'team',
      expectedMembershipId: 'old-membership',
      reason: 'Move to Team A',
      requestId: expect.any(String),
    },
  );
});

it('keeps the team zone expiry as a calendar date when editing it with the native picker', async () => {
  await mount(<TeamsScreen selectedTeam={team} />);
  await click(t('teams.grantZone'));
  await choose(t('teams.contractorZone'), 'permission');
  await click(t('common.chooseDate', { label: t('teams.validUntilLabel') }));
  const picker = root.root.findAllByType(ScrollDateTimePicker)[0]!;
  expect(picker.props.utc).toBe(true);
  await act(async () => picker.props.onConfirm(new Date('2026-11-20T00:00:00Z')));
  await act(async () => buttons(t('teams.grantZone')).at(-1)!.props.onPress());
  await settle();
  expect(workspace.client.grantTeamZone).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    'team',
    expect.objectContaining({
      contractorZonePermissionId: 'permission',
      endDate: '2026-11-20',
      requestId: expect.any(String),
    }),
  );
});

it('keeps zones, assignments and worker grants scoped while submitting through the grant sheet', async () => {
  await mount(<AccessScreen onBack={vi.fn()} />);
  expect(JSON.stringify(root.toJSON())).toContain('Own Zone');
  expect(JSON.stringify(root.toJSON())).not.toContain('Private Zone');
  await click(t('access.assignmentsTab'));
  expect(JSON.stringify(root.toJSON())).not.toContain('Private Worker');
  await click(t('access.workerPermissionsTab'));
  expect(JSON.stringify(root.toJSON())).not.toContain('Private Worker');
  await click(t('access.grantWithinScope'));
  await choose(t('access.approvedAssignment'), 'assignment');
  await choose(t('access.contractorZoneGrant'), 'permission');
  for (const [label, value] of [
    [t('access.validFrom'), from],
    [t('access.validUntil'), to],
  ]) {
    const field = root.root
      .findAllByType(DateTimeField)
      .find((node) => node.props.label === label)!;
    await act(async () => field.props.onChange(value));
  }
  await click(t('access.grantWorker'));
  expect(workspace.client.grantWorkerZone).toHaveBeenCalledWith('token', 'site', {
    workerAssignmentId: 'assignment',
    contractorZonePermissionId: 'permission',
    validFrom: '2026-11-01T00:00:00.000Z',
    validUntil: '2026-12-01T00:00:00.000Z',
    requestId: expect.any(String),
  });
});

it('hides worker grant tools when the API does not allow granting worker zones', async () => {
  vi.mocked(workspace.client.accessSetup).mockResolvedValue({
    ...accessData,
    canGrantWorkerZones: false,
  });
  await mount(<AccessScreen onBack={vi.fn()} />);
  expect(buttons(t('access.workerPermissionsTab'))).toHaveLength(0);
  expect(buttons(t('access.grantWithinScope'))).toHaveLength(0);
  expect(workspace.client.grantWorkerZone).not.toHaveBeenCalled();
});

it('explains missing contractor grants and keeps assignment requests available', async () => {
  vi.mocked(workspace.client.accessSetup).mockResolvedValue({
    ...accessData,
    contractorPermissions: [],
    assignments: [],
  });
  await mount(<AccessScreen onBack={vi.fn()} />);
  expect(JSON.stringify(root.toJSON())).toContain(t('access.noContractorGrantHint'));
  expect(buttons(t('access.requestAssignment'))).toHaveLength(0);
  await click(t('access.assignmentsTab'));
  expect(buttons(t('access.requestAssignment'))[0]!.props.disabled).toBe(false);
  await click(t('access.workerPermissionsTab'));
  expect(buttons(t('access.requestAssignment'))).toHaveLength(0);
  expect(buttons(t('access.grantWithinScope'))[0]!.props.disabled).toBe(true);
  expect(JSON.stringify(root.toJSON())).toContain(t('access.approvedAssignmentRequired'));
});

it('submits a worker assignment request without needing a contractor zone grant', async () => {
  vi.mocked(workspace.client.accessSetup).mockResolvedValue({
    ...accessData,
    contractorPermissions: [],
  });
  await mount(<AccessScreen onBack={vi.fn()} />);
  await click(t('access.assignmentsTab'));
  await click(t('access.requestAssignment'));
  const dates = root.root.findAllByType(DateTimeField);
  expect(Number.isFinite(Date.parse(dates[0]!.props.value))).toBe(true);
  expect(Date.parse(dates[1]!.props.value) - Date.parse(dates[0]!.props.value)).toBe(8 * 3600_000);
  await choose(t('schedule.worker'), 'worker');
  const zone = root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Own Zone',
  )[0]!;
  await act(async () => zone.props.onPress());
  await act(async () => dates[0]!.props.onChange(from));
  await act(async () => dates[1]!.props.onChange(to));
  await click(t('access.submitAssignment'));
  expect(workspace.client.createWorkerSiteZoneAssignment).toHaveBeenCalledWith('token', 'worker', {
    siteId: 'site',
    zoneIds: ['zone'],
    validFrom: '2026-11-01T00:00:00.000Z',
    validUntil: '2026-12-01T00:00:00.000Z',
  });
  expect(JSON.stringify(root.toJSON())).not.toContain(t('access.assignmentOutsideParticipation'));
});

it('explains a grant period outside the assignment instead of sending an invalid command', async () => {
  await mount(<AccessScreen onBack={vi.fn()} />);
  await click(t('access.workerPermissionsTab'));
  await click(t('access.grantWithinScope'));
  await choose(t('access.approvedAssignment'), 'assignment');
  await choose(t('access.contractorZoneGrant'), 'permission');
  const dates = root.root.findAllByType(DateTimeField);
  await act(async () => dates[0]!.props.onChange(from));
  await act(async () => dates[1]!.props.onChange('2027-01-01T00:00:00Z'));
  await click(t('access.grantWorker'));
  expect(workspace.client.grantWorkerZone).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).toContain(t('access.workerGrantOutsideScope'));
});
