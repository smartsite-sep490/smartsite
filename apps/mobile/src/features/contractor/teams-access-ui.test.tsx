import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ContractorTeamResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { MobileLayoutProvider } from '../shared/mobile-layout';
import { Choice } from '../shared/ui';
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
  await act(async () => buttons(label).at(-1)!.props.onPress());
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
  vi.spyOn(client, 'listContractorTeams').mockResolvedValue({
    items: [team, { ...team, id: 'other-team', name: 'Team B' }],
    total: 2,
  });
  vi.spyOn(client, 'contractorTeamDetail').mockResolvedValue(team);
  vi.spyOn(client, 'listContractorTeamWorkers').mockResolvedValue({
    items: [
      {
        workerId: 'worker',
        displayName: 'Own Worker',
        membershipId: 'old-membership',
        teamId: 'team',
        teamName: 'Team A',
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

it('keeps archival disabled for a nonempty team and transfers directly from the selected member action', async () => {
  await mount(<TeamsScreen selectedTeam={team} />);
  await click(t('teamUi.teamActions'));
  await click(t('contractorUi.archiveTeam'));
  await text(t('teams.membershipReason'), 'Close this team');
  expect(buttons(t('teamUi.confirmARCHIVE'))[0]!.props.disabled).toBe(true);
  await click(t('common.close'));
  await click(t('teamUi.memberActions', { name: 'Own Worker' }));
  await click(t('teamUi.transferMember'));
  expect(
    root.root.findAllByType(Choice).some((node) => node.props.label === t('teams.workerToMove')),
  ).toBe(false);
  await choose(t('teams.targetTeam'), 'other-team');
  await text(t('teams.membershipReason'), 'Move to Team B');
  await click(t('teamUi.confirmTRANSFER'));
  expect(workspace.client.assignContractorTeam).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    'worker',
    {
      teamId: 'other-team',
      expectedMembershipId: 'old-membership',
      reason: 'Move to Team B',
      requestId: expect.any(String),
    },
  );
});

it('keeps the team zone expiry as a calendar date when editing it with the native picker', async () => {
  await mount(<TeamsScreen selectedTeam={team} />);
  await click(t('teamUi.zoneTab'));
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

it('appoints the selected member directly from their action and refreshes the leader card', async () => {
  let stored = { ...team, leaderWorkerId: null as string | null };
  vi.mocked(workspace.client.contractorTeamDetail).mockImplementation(async () => stored);
  const appoint = vi
    .spyOn(workspace.client, 'setContractorTeamLeader')
    .mockImplementation(async (_token, _site, _contractor, _team, input) => {
      stored = { ...stored, leaderWorkerId: input.workerId, version: stored.version + 1 };
      return stored;
    });
  await mount(<TeamsScreen selectedTeam={team} />);
  expect(buttons(t('teamUi.appointLeader')).length).toBe(1);
  await click(t('teamUi.memberActions', { name: 'Own Worker' }));
  await click(t('teamUi.appointLeader'));
  await click(t('teamUi.confirmLEADER'));
  expect(appoint).toHaveBeenCalledWith('token', 'site', 'contractor', 'team', {
    expectedVersion: 3,
    workerId: 'worker',
  });
  expect(JSON.stringify(root.toJSON())).toContain(t('teamUi.leaderRoleHint'));
  expect(buttons(t('teamUi.changeLeader'))).toHaveLength(1);
});

it('adds an unassigned worker from Add member and removes a specific member without a worker dropdown', async () => {
  vi.mocked(workspace.client.listContractorTeamWorkers).mockResolvedValue({
    items: [
      {
        workerId: 'worker',
        displayName: 'Own Worker',
        membershipId: 'old-membership',
        teamId: 'team',
        teamName: 'Team A',
      },
      {
        workerId: 'unassigned',
        displayName: 'Available Worker',
        membershipId: null,
        teamId: null,
        teamName: null,
      },
      {
        workerId: 'other',
        displayName: 'Already Assigned Worker',
        membershipId: 'other-membership',
        teamId: 'other-team',
        teamName: 'Team B',
      },
    ],
    total: 3,
  });
  await mount(<TeamsScreen selectedTeam={team} />);
  await click(t('teamUi.addMember'));
  expect(JSON.stringify(root.toJSON())).not.toContain('Already Assigned Worker');
  await click('Available Worker');
  await click(t('teamUi.confirmADD'));
  expect(workspace.client.assignContractorTeam).toHaveBeenCalledWith(
    'token',
    'site',
    'contractor',
    'unassigned',
    { teamId: 'team', expectedMembershipId: null, requestId: expect.any(String) },
  );
  await click(t('teamUi.memberActions', { name: 'Own Worker' }));
  await click(t('teamUi.removeMember'));
  expect(buttons(t('teamUi.confirmREMOVE'))[0]!.props.disabled).toBe(true);
  await text(t('teams.membershipReason'), 'Worker reassigned');
  await click(t('teamUi.confirmREMOVE'));
  expect(workspace.client.assignContractorTeam).toHaveBeenLastCalledWith(
    'token',
    'site',
    'contractor',
    'worker',
    {
      teamId: null,
      expectedMembershipId: 'old-membership',
      reason: 'Worker reassigned',
      requestId: expect.any(String),
    },
  );
});

it('shows only contractor zones and opens their scoped read-only details', async () => {
  await mount(<AccessScreen onBack={vi.fn()} />);
  const output = JSON.stringify(root.toJSON());
  expect(output).toContain('Own Zone');
  expect(output).not.toContain('Private Zone');
  expect(output).not.toContain('Private Worker');
  expect(buttons(t('access.assignmentsTab'))).toHaveLength(0);
  expect(buttons(t('access.workerPermissionsTab'))).toHaveLength(0);
  await click(t('areaUi.openZone', { name: 'Own Zone' }));
  expect(JSON.stringify(root.toJSON())).toContain(t('teamUi.zoneDetails'));
  expect(JSON.stringify(root.toJSON())).toContain(t('access.authorizationHint'));
  expect(buttons(t('access.requestAssignment'))).toHaveLength(0);
  expect(buttons(t('access.grantWithinScope'))).toHaveLength(0);
  expect(workspace.client.grantWorkerZone).not.toHaveBeenCalled();
});

it('keeps zone viewing available without worker grant capability', async () => {
  vi.mocked(workspace.client.accessSetup).mockResolvedValue({
    ...accessData,
    canGrantWorkerZones: false,
  });
  await mount(<AccessScreen onBack={vi.fn()} />);
  expect(JSON.stringify(root.toJSON())).toContain('Own Zone');
  expect(buttons(t('access.workerPermissionsTab'))).toHaveLength(0);
  expect(buttons(t('access.grantWithinScope'))).toHaveLength(0);
  expect(workspace.client.grantWorkerZone).not.toHaveBeenCalled();
});

it('explains missing contractor zones without exposing individual assignment or grant tools', async () => {
  vi.mocked(workspace.client.accessSetup).mockResolvedValue({
    ...accessData,
    contractorPermissions: [],
    assignments: [],
  });
  await mount(<AccessScreen onBack={vi.fn()} />);
  expect(JSON.stringify(root.toJSON())).toContain(t('access.noContractorGrantHint'));
  expect(buttons(t('access.requestAssignment'))).toHaveLength(0);
  expect(buttons(t('access.assignmentsTab'))).toHaveLength(0);
  expect(buttons(t('access.workerPermissionsTab'))).toHaveLength(0);
});
