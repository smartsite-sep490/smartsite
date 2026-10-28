import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  ApiError,
  type ChecklistDetailResponse,
  type IncidentDetailResponse,
} from '@smartsite/api-client';
import { Attachments } from '../shared/uploads';
import { AssignedWorkScreen } from './assigned-work-screen';
import type { useWorkspace } from '../workspace/workspace-context';
vi.mock('expo-file-system', () => ({
  File: class {
    size = 100;
  },
}));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
let detail: ChecklistDetailResponse;
const buttons = (label: string) =>
  root.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label);
async function click(label: string) {
  for (let attempt = 0; !buttons(label).length && attempt < 80; attempt++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => {
    buttons(label)[0]!.props.onPress();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'token',
    workerId: '',
    queryKey: ['mobile', 'rep', 'site-a', 'contractor-a'],
    user: {
      id: 'rep',
      username: 'synthetic-rep',
      displayName: 'Synthetic Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }],
    },
    scope: {
      role: 'contractor',
      siteId: 'site-a',
      siteName: 'Site',
      contractorId: 'contractor-a',
      contractorName: 'Synthetic Contractor',
    },
  };
  detail = {
    id: 'checklist-a',
    siteId: 'site-a',
    contractorId: 'contractor-a',
    contractorName: 'Synthetic Contractor',
    teamId: 'team',
    teamName: 'Team',
    zoneId: 'zone',
    zoneName: 'Zone',
    description: 'Synthetic assigned checklist',
    startsAt: '2026-10-17T01:00:00Z',
    endsAt: '2026-10-17T10:00:00Z',
    assignedTo: 'rep',
    assignedToName: 'Representative',
    assignedBy: 'safety',
    assignedByName: 'Safety',
    status: 'ASSIGNED',
    version: 1,
    createdAt: '',
    updatedAt: '',
    items: [{ id: 'item-a', position: 0, text: 'Inspect guardrail', evidenceRequired: false }],
    submissions: [],
    audit: [],
  };
  vi.spyOn(client, 'getSafetyChecklist').mockImplementation(async () => detail);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
async function mount(initialKind = 'checklist', initialId = 'checklist-a') {
  await act(async () => {
    root = create(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(AssignedWorkScreen, {
          initialId,
          initialKind,
          onBack: () => {},
        }),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
it('starts an assigned checklist and submits its real criterion with the refreshed version', async () => {
  const start = vi.spyOn(workspace.client, 'checklistCommand').mockImplementation(async () => {
    detail = { ...detail, status: 'IN_PROGRESS', version: 2 };
    return { resource: detail, replayed: false };
  });
  const submit = vi
    .spyOn(workspace.client, 'submitSafetyChecklist')
    .mockImplementation(async () => {
      detail = { ...detail, status: 'SUBMITTED', version: 3 };
      return { resource: detail, replayed: false };
    });
  await mount();
  expect(buttons('Nộp báo cáo kiểm tra')).toHaveLength(0);
  await click('Bắt đầu kiểm tra');
  expect(start).toHaveBeenCalledWith(
    'token',
    'site-a',
    'checklist-a',
    'start',
    expect.objectContaining({ expectedVersion: 1, commandId: expect.any(String) }),
  );
  await click('Chọn… ▾');
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'radio')[0]!
      .props.onPress();
  });
  await click('Nộp báo cáo kiểm tra');
  expect(submit).toHaveBeenCalledWith(
    'token',
    'site-a',
    'checklist-a',
    expect.objectContaining({
      expectedVersion: 2,
      commandId: expect.any(String),
      results: [{ itemId: 'item-a', answer: 'PASS', note: '', fileIndexes: [] }],
    }),
    [],
  );
  expect(buttons('Nộp báo cáo kiểm tra')).toHaveLength(0);
});
it('does not let a representative operate a checklist assigned to someone else or a different selected contractor', async () => {
  detail = { ...detail, assignedTo: 'someone-else' };
  await mount();
  expect(buttons('Bắt đầu kiểm tra')).toHaveLength(0);
  await act(async () => root.unmount());
  detail = { ...detail, assignedTo: 'rep', contractorId: 'contractor-b' };
  cache.clear();
  await mount();
  expect(buttons('Bắt đầu kiểm tra')).toHaveLength(0);
});
it('requires evidence for a passing criterion that requests it, without reporting a fake success', async () => {
  detail = {
    ...detail,
    status: 'IN_PROGRESS',
    items: [{ ...detail.items[0]!, evidenceRequired: true }],
  };
  const submit = vi.spyOn(workspace.client, 'submitSafetyChecklist');
  await mount();
  await click('Chọn… ▾');
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'radio')[0]!
      .props.onPress();
  });
  await click('Nộp báo cáo kiểm tra');
  expect(submit).not.toHaveBeenCalled();
  expect(
    root.root.findAll((n) => String(n.type) === 'Text' && n.props.accessibilityRole === 'alert')
      .length,
  ).toBeGreaterThan(0);
});

function incidentFixture(): IncidentDetailResponse {
  return {
    id: 'incident-a',
    siteId: 'site-a',
    contractorId: 'contractor-a',
    responsibilityReason: 'Verified responsibility',
    responsibilityConfirmedBy: 'safety',
    responsibilityConfirmedAt: '2026-10-28T01:00:00Z',
    title: 'Synthetic corrective work',
    description: 'Restore guardrail',
    severity: 'HIGH',
    status: 'ASSIGNED',
    zoneId: null,
    occurredAt: '2026-10-28T01:00:00Z',
    reportedBy: 'safety',
    closedBy: null,
    closedAt: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    workerIds: [],
    alerts: [],
    audit: [],
    actions: [
      {
        id: 'action-a',
        incidentId: 'incident-a',
        assignedTo: 'rep',
        assignedBy: 'safety',
        description: 'Install guardrail',
        dueAt: null,
        status: 'ASSIGNED',
        version: 1,
        createdAt: '',
        updatedAt: '',
        submissions: [],
      },
    ],
  };
}
const field = () => root.root.findByProps({ accessibilityLabel: 'Kết quả khắc phục' });
async function enterResult(value: string) {
  await act(async () => field().props.onChangeText(value));
}
const renderedText = () => JSON.stringify(root.toJSON());
it('starts corrective work, submits a versioned result and refreshes the final closure from Web', async () => {
  let incident = incidentFixture();
  vi.spyOn(workspace.client, 'getIncident').mockImplementation(async () => incident);
  const command = vi
    .spyOn(workspace.client, 'incidentCommand')
    .mockImplementation(async (_token, _site, _id, op) => {
      incident = {
        ...incident,
        status: 'IN_PROGRESS',
        actions: [
          {
            ...incident.actions[0]!,
            status: op === 'start' ? 'IN_PROGRESS' : 'SUBMITTED',
            version: op === 'start' ? 2 : 3,
          },
        ],
      };
      return { resource: incident, replayed: false };
    });
  await mount('incident', 'incident-a');
  await click('Bắt đầu khắc phục');
  expect(command).toHaveBeenLastCalledWith(
    'token',
    'site-a',
    'incident-a',
    'start',
    expect.objectContaining({ expectedVersion: 1, commandId: expect.any(String) }),
    'action-a',
  );
  await enterResult('Guardrail restored');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(command).toHaveBeenLastCalledWith(
    'token',
    'site-a',
    'incident-a',
    'submit',
    expect.objectContaining({ expectedVersion: 2, resultDescription: 'Guardrail restored' }),
    'action-a',
    undefined,
  );
  expect(buttons('Nộp kết quả cho cán bộ an toàn')).toHaveLength(0);
  incident = {
    ...incident,
    status: 'CLOSED',
    actions: [{ ...incident.actions[0]!, status: 'CLOSED', version: 4 }],
  };
  await click('Làm mới công việc khắc phục');
  expect(renderedText()).toContain('Đã đóng');
  expect(buttons('Bắt đầu khắc phục')).toHaveLength(0);
  expect(buttons('Nộp kết quả cho cán bộ an toàn')).toHaveLength(0);
});
it('shows rejected submission history and permits a new result with the current version', async () => {
  const incident = incidentFixture();
  incident.status = 'IN_PROGRESS';
  incident.actions[0] = {
    ...incident.actions[0]!,
    status: 'IN_PROGRESS',
    version: 5,
    submissions: [
      {
        id: 'submission-a',
        correctiveActionId: 'action-a',
        submittedBy: 'rep',
        resultDescription: 'First repair',
        submittedAt: '',
        status: 'REJECTED',
        evidence: null,
        reviewedBy: 'safety',
        reviewedAt: '',
        reviewNote: 'Guardrail still loose',
      },
    ],
  };
  vi.spyOn(workspace.client, 'getIncident').mockResolvedValue(incident);
  const submit = vi
    .spyOn(workspace.client, 'incidentCommand')
    .mockResolvedValue({ resource: incident, replayed: false });
  await mount('incident', 'incident-a');
  expect(renderedText()).toContain('Guardrail still loose');
  await enterResult('Repaired again');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(submit).toHaveBeenCalledWith(
    'token',
    'site-a',
    'incident-a',
    'submit',
    expect.objectContaining({ expectedVersion: 5, resultDescription: 'Repaired again' }),
    'action-a',
    undefined,
  );
  expect(incident.actions[0]!.submissions[0]!.status).toBe('REJECTED');
});
it('preserves a draft and command ID after a transient submission failure', async () => {
  const incident = incidentFixture();
  incident.status = 'IN_PROGRESS';
  incident.actions[0]!.status = 'IN_PROGRESS';
  vi.spyOn(workspace.client, 'getIncident').mockResolvedValue(incident);
  const submit = vi
    .spyOn(workspace.client, 'incidentCommand')
    .mockRejectedValueOnce(new ApiError('network', 'Unavailable'))
    .mockResolvedValue({ resource: incident, replayed: true });
  await mount('incident', 'incident-a');
  await enterResult('Keep this repair report');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(field().props.value).toBe('Keep this repair report');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(submit.mock.calls[0]![4]).toEqual(submit.mock.calls[1]![4]);
});
it.each(['CLOSED', 'superseded', 'other-assignee', 'other-contractor', 'other-site'])(
  'hides corrective work controls for %s',
  async (condition) => {
    const incident = incidentFixture();
    if (condition === 'CLOSED') incident.status = 'CLOSED';
    if (condition === 'superseded') incident.actions[0]!.supersededAt = '2026-10-28T01:00:00Z';
    if (condition === 'other-assignee') incident.actions[0]!.assignedTo = 'someone-else';
    if (condition === 'other-contractor') incident.contractorId = 'contractor-b';
    if (condition === 'other-site') incident.siteId = 'site-b';
    vi.spyOn(workspace.client, 'getIncident').mockResolvedValue(incident);
    await mount('incident', 'incident-a');
    expect(buttons('Bắt đầu khắc phục')).toHaveLength(0);
    expect(buttons('Nộp kết quả cho cán bộ an toàn')).toHaveLength(0);
  },
);
it('refreshes assigned incidents explicitly and reloads a fresh cache on foreground', async () => {
  focusManager.setFocused(false);
  let incident = incidentFixture();
  const list = vi
    .spyOn(workspace.client, 'listIncidents')
    .mockImplementation(async () => ({ items: [incident], total: 1 }));
  cache.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  await mount('incident', '');
  expect(list).toHaveBeenCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ assignedTo: 'rep' }),
  );
  incident = { ...incident, title: 'Updated by Safety' };
  await click('Làm mới công việc khắc phục');
  expect(renderedText()).toContain('Updated by Safety');
  const count = list.mock.calls.length;
  await act(async () => {
    focusManager.setFocused(true);
    await new Promise((r) => setTimeout(r, 30));
  });
  expect(list.mock.calls.length).toBeGreaterThan(count);
  focusManager.setFocused(undefined);
});

it('submits the selected JPEG evidence through the shared native upload client', async () => {
  const incident = incidentFixture();
  incident.status = 'IN_PROGRESS';
  incident.actions[0]!.status = 'IN_PROGRESS';
  vi.spyOn(workspace.client, 'getIncident').mockResolvedValue(incident);
  const submit = vi
    .spyOn(workspace.client, 'incidentCommand')
    .mockResolvedValue({ resource: incident, replayed: false });
  await mount('incident', 'incident-a');
  const file = { uri: 'file:///synthetic.jpg', name: 'synthetic.jpg', type: 'image/jpeg' };
  await act(async () => root.root.findByType(Attachments).props.onChange([file]));
  await enterResult('Repair with evidence');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(submit).toHaveBeenCalledWith(
    'token',
    'site-a',
    'incident-a',
    'submit',
    expect.objectContaining({ resultDescription: 'Repair with evidence' }),
    'action-a',
    file,
  );
});
it('refreshes a stale Action version before retrying and does not send an obsolete version twice', async () => {
  let incident = incidentFixture();
  incident.status = 'IN_PROGRESS';
  incident.actions[0]!.status = 'IN_PROGRESS';
  vi.spyOn(workspace.client, 'getIncident').mockImplementation(async () => incident);
  const submit = vi
    .spyOn(workspace.client, 'incidentCommand')
    .mockImplementationOnce(async () => {
      incident = { ...incident, actions: [{ ...incident.actions[0]!, version: 2 }] };
      throw new ApiError('http', 'Action version is stale', 409);
    })
    .mockImplementation(async () => ({ resource: incident, replayed: false }));
  await mount('incident', 'incident-a');
  await enterResult('Old report');
  await click('Nộp kết quả cho cán bộ an toàn');
  await enterResult('Updated report');
  await click('Nộp kết quả cho cán bộ an toàn');
  expect(submit.mock.calls[0]![4]).toMatchObject({ expectedVersion: 1 });
  expect(submit.mock.calls[1]![4]).toMatchObject({ expectedVersion: 2 });
});

it('keeps closed work read-only while other Incident actions are still open', async () => {
  const incident = incidentFixture();
  incident.status = 'IN_PROGRESS';
  const own = { ...incident.actions[0]!, status: 'CLOSED' as const };
  incident.actions = [
    own,
    { ...own, id: 'action-b', assignedTo: 'someone-else', status: 'ASSIGNED' },
  ];
  vi.spyOn(workspace.client, 'getIncident').mockResolvedValue(incident);
  await mount('incident', 'incident-a');
  expect(renderedText()).toContain(
    'Công việc này đã đóng. Vụ việc còn công việc khác cần hoàn thành.',
  );
  expect(buttons('Bắt đầu khắc phục')).toHaveLength(0);
  expect(buttons('Nộp kết quả cho cán bộ an toàn')).toHaveLength(0);
});
