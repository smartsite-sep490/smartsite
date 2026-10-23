// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type ChecklistDetailResponse,
} from '@smartsite/api-client';
import { SafetyChecklistsView } from './SafetyChecklistsView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(status: ChecklistDetailResponse['status'] = 'IN_PROGRESS', review = false) {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:evidence';
      static revokeObjectURL = vi.fn();
    },
  );
  const client = new SmartSiteManagementClient('http://local');
  const data: ChecklistDetailResponse = {
    id: 'checklist',
    siteId: 'site',
    contractorId: 'contractor',
    contractorName: 'Contractor',
    teamId: 'team',
    teamName: 'Crew',
    zoneId: 'zone',
    zoneName: 'Zone',
    assignedTo: 'rep',
    assignedToName: 'Representative',
    assignedBy: 'safety',
    assignedByName: 'Safety',
    description: 'Inspect tools',
    status: review ? 'SUBMITTED' : 'IN_PROGRESS',
    version: 1,
    startsAt: '2026-10-20T01:00:00Z',
    endsAt: '2026-10-20T09:00:00Z',
    createdAt: '2026-10-19T01:00:00Z',
    updatedAt: '2026-10-19T01:00:00Z',
    items: [{ id: 'item', position: 0, text: 'Tools', evidenceRequired: true }],
    submissions: review
      ? [
          {
            id: 'submission-a',
            submittedBy: 'rep',
            submittedByName: 'Representative',
            submittedAt: '2026-10-20T01:00:00Z',
            status: 'PENDING',
            reviewedBy: null,
            reviewedByName: null,
            reviewedAt: null,
            reviewNote: null,
            results: [],
          },
        ]
      : [],
    audit: [],
  };
  vi.spyOn(client, 'listSafetyChecklists').mockResolvedValue({ items: [data], total: 1 });
  const get = vi
    .spyOn(client, 'getSafetyChecklist')
    .mockResolvedValueOnce(data)
    .mockResolvedValue({
      ...data,
      version: 2,
      status,
      submissions: data.submissions.map((s) => ({ ...s, id: 'submission-b' })),
    });
  const submit = vi
    .spyOn(client, 'submitSafetyChecklist')
    .mockRejectedValueOnce(new ApiError('http', 'Version changed', 409))
    .mockResolvedValue({ resource: { ...data, version: 3, status: 'SUBMITTED' }, replayed: false });
  const command = vi
    .spyOn(client, 'checklistCommand')
    .mockRejectedValue(new ApiError('http', 'Version changed', 409));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SafetyChecklistsView
        client={client}
        apiUrl="http://local"
        token="token"
        scope="scope"
        siteId="site"
        user={{
          id: review ? 'safety' : 'rep',
          username: 'rep',
          displayName: 'Representative',
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [
            { role: review ? 'SAFETY_OFFICER' : 'CONTRACTOR_REPRESENTATIVE', siteId: 'site' },
          ],
        }}
        active
        onDraftConsumed={() => {}}
        onIncident={() => {}}
      />
    </QueryClientProvider>,
  );
  return { get, submit, command, data };
}

async function reportAndReload() {
  fireEvent.click(await screen.findByRole('button', { name: 'Report checklist' }));
  fireEvent.change(screen.getByLabelText('Result: Tools'), { target: { value: 'PASS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  fireEvent.change(screen.getByLabelText('Notes: Tools'), {
    target: { value: 'Checked original equipment' },
  });
  const file = new File(['photo'], 'tools.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText(/^Evidence: Tools/), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit checklist' }));
  await screen.findByRole('button', { name: 'Reload data' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload data' }));
  return file;
}

it('refresh after conflict retains report text/files and resubmits only explicitly with the refreshed version', async () => {
  const { get, submit } = mount();
  const file = await reportAndReload();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('dialog')).not.toBeNull();
  expect((screen.getByLabelText('Notes: Tools') as HTMLTextAreaElement).value).toBe(
    'Checked original equipment',
  );
  expect(screen.getByRole('img', { name: 'Selected evidence for Tools' })).not.toBeNull();
  expect(submit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Submit checklist' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1]?.[3]).toMatchObject({ expectedVersion: 2 });
  expect(submit.mock.calls[1]?.[4]).toEqual([file]);
});

it('refresh preserves the report but blocks sending when the checklist was cancelled', async () => {
  const { get, submit } = mount('CANCELLED');
  await reportAndReload();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('dialog')).not.toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit checklist' }).matches(':disabled')).toBe(
      true,
    ),
  );
  expect((screen.getByLabelText('Notes: Tools') as HTMLTextAreaElement).value).toBe(
    'Checked original equipment',
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

it('a failed detail refresh preserves input and blocks sending with the stale version', async () => {
  const { get, submit, data } = mount();
  get
    .mockReset()
    .mockResolvedValueOnce(data)
    .mockRejectedValue(new Error('Offline during refresh'));
  await reportAndReload();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit checklist' }).matches(':disabled')).toBe(
      true,
    ),
  );
  expect((screen.getByLabelText('Notes: Tools') as HTMLTextAreaElement).value).toBe(
    'Checked original equipment',
  );
  expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('Offline');
  expect(submit).toHaveBeenCalledTimes(1);
});

it('does not apply a retained review note to a replacement pending submission after reload', async () => {
  const { get, command } = mount('SUBMITTED', true);
  fireEvent.click(await screen.findByRole('button', { name: 'Record checklist' }));
  fireEvent.change(screen.getByLabelText('Recording note'), {
    target: { value: 'Reviewed submission A' },
  });
  fireEvent.submit(screen.getByLabelText('Recording note').closest('form')!);
  await screen.findByRole('button', { name: 'Reload data' });
  expect(command.mock.calls[0]?.[4]).toMatchObject({ submissionId: 'submission-a' });
  fireEvent.click(screen.getByRole('button', { name: 'Reload data' }));
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  expect((screen.getByLabelText('Recording note') as HTMLTextAreaElement).value).toBe(
    'Reviewed submission A',
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('button', { name: 'Record checklist' })
        .matches(':disabled'),
    ).toBe(true),
  );
  fireEvent.submit(screen.getByLabelText('Recording note').closest('form')!);
  expect(command).toHaveBeenCalledTimes(1);
});
