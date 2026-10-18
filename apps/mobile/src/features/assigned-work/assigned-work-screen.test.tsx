import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ChecklistDetailResponse } from '@smartsite/api-client';
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
async function mount() {
  await act(async () => {
    root = create(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(AssignedWorkScreen, {
          initialId: 'checklist-a',
          initialKind: 'checklist',
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
