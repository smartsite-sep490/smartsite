// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ChecklistDetailResponse } from '@smartsite/api-client';
import { SafetyAlertsView } from '../alerts/SafetyAlertsView';
import i18n from '../../i18n';

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

const user = {
  id: 'representative',
  username: 'representative',
  displayName: 'Synthetic representative',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: ['site-a', 'site-b'].map((siteId) => ({
    role: 'CONTRACTOR_REPRESENTATIVE' as const,
    siteId,
  })),
};

function checklist(id: string, siteId: string): ChecklistDetailResponse {
  return {
    id,
    siteId,
    description: id,
    contractorId: 'contractor',
    contractorName: 'Synthetic contractor',
    teamId: 'team',
    teamName: 'Synthetic team',
    zoneId: 'zone',
    zoneName: 'Synthetic zone',
    assignedTo: user.id,
    assignedToName: user.displayName,
    assignedBy: 'safety',
    assignedByName: 'Synthetic safety',
    status: 'IN_PROGRESS',
    version: 1,
    startsAt: '2026-10-15T01:00:00Z',
    endsAt: '2026-10-15T10:00:00Z',
    createdAt: '2026-10-14T00:00:00Z',
    updatedAt: '2026-10-14T00:00:00Z',
    items: [{ id: id + '-item', position: 0, text: id + ' criterion', evidenceRequired: false }],
    submissions: [],
    audit: [],
  };
}

async function mount() {
  await i18n.changeLanguage('en');
  const prototype = SmartSiteManagementClient.prototype;
  vi.spyOn(prototype, 'listSites').mockResolvedValue({
    items: ['site-a', 'site-b'].map((id) => ({
      id,
      code: id,
      name: id,
      createdAt: '2026-10-14T00:00:00Z',
    })),
    total: 2,
  });
  vi.spyOn(prototype, 'listSafetyChecklists').mockImplementation(async (_token, siteId) => ({
    items: [checklist(siteId === 'site-a' ? 'target-a' : 'unrelated-first-b', siteId)],
    total: 1,
  }));
  vi.spyOn(prototype, 'getSafetyChecklist').mockImplementation(async (_token, siteId, id) =>
    checklist(id, siteId),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (siteId: string, checklistId: string) => (
    <QueryClientProvider client={cache}>
      <SafetyAlertsView
        apiUrl="http://local"
        authenticatedSession={{ accessToken: 'synthetic-token', user }}
        initialSiteId={siteId}
        initialChecklistId={checklistId}
      />
    </QueryClientProvider>
  );
  const view = render(tree('site-a', 'target-a'));
  await screen.findByRole('heading', { name: 'target-a' });
  return (siteId: string, id: string) => view.rerender(tree(siteId, id));
}

it('opens the notification checklist when the Site and checklist change together', async () => {
  const navigate = await mount();
  navigate('site-b', 'target-b');
  expect(await screen.findByRole('heading', { name: 'target-b' })).not.toBeNull();
  expect(screen.queryByRole('heading', { name: 'unrelated-first-b' })).toBeNull();
});

it('closes the old checklist report when Back changes the checklist in the same Site', async () => {
  const navigate = await mount();
  navigate('site-a', 'target-b');
  await screen.findByRole('heading', { name: 'target-b' });
  fireEvent.click(screen.getByRole('button', { name: 'Report checklist' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  fireEvent.change(screen.getByLabelText('Notes: target-b criterion'), {
    target: { value: 'Unsaved synthetic report' },
  });
  navigate('site-a', 'target-a');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByRole('heading', { name: 'target-a' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Report checklist' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect((screen.getByLabelText('Notes: target-a criterion') as HTMLTextAreaElement).value).toBe(
    '',
  );
});

it('keeps the new checklist open when the previous report finishes after Back', async () => {
  const navigate = await mount();
  navigate('site-a', 'target-b');
  await screen.findByRole('heading', { name: 'target-b' });
  type Submission = Awaited<ReturnType<SmartSiteManagementClient['submitSafetyChecklist']>>;
  let finish!: (value: Submission) => void;
  const pending = new Promise<Submission>((resolve) => {
    finish = resolve;
  });
  const submit = vi
    .spyOn(SmartSiteManagementClient.prototype, 'submitSafetyChecklist')
    .mockReturnValue(pending);
  fireEvent.click(screen.getByRole('button', { name: 'Report checklist' }));
  fireEvent.change(screen.getByLabelText('Result: target-b criterion'), {
    target: { value: 'PASS' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit checklist' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  navigate('site-a', 'target-a');
  await screen.findByRole('heading', { name: 'target-a' });
  fireEvent.click(screen.getByRole('button', { name: 'Report checklist' }));
  await act(async () => {
    finish({ resource: checklist('target-b', 'site-a'), replayed: false });
    await pending;
  });
  expect(screen.getByRole('heading', { name: 'target-a' })).not.toBeNull();
  expect(screen.getByRole('dialog')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(screen.getByLabelText('Notes: target-a criterion')).not.toBeNull();
});
