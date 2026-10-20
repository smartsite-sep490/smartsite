// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CreateChecklistForm, ReportChecklistForm } from './ChecklistForms';
import { StatusBadge } from './SafetyWorkflowUi';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
const switchTo = (language: 'en' | 'vi') =>
  act(async () => {
    await i18n.changeLanguage(language);
  });

it('switches a filled checklist assignment both ways without changing scope, values or its command', async () => {
  const client = new SmartSiteManagementClient('http://local');
  const team = {
    id: 'team-a',
    name: 'My checklists',
    contractorId: 'contractor-a',
    contractorName: 'Safety overview',
    description: '',
    isActive: true,
  };
  const contractors = vi
    .spyOn(client, 'listSafetyContractors')
    .mockResolvedValue({ items: [{ id: 'contractor-a', name: team.contractorName }], total: 1 });
  const teams = vi
    .spyOn(client, 'getSafetyTeamOptions')
    .mockResolvedValue({ items: [team], total: 1 });
  const detail = vi.spyOn(client, 'getSafetyTeam').mockResolvedValue({
    ...team,
    workerCount: 1,
    scheduledWorkerCount: 1,
    date: '2026-10-14',
    timezone: 'Asia/Ho_Chi_Minh',
    workers: { items: [], total: 0 },
    cameras: [],
    zones: [
      {
        id: 'zone-a',
        name: 'Zone',
        code: 'A',
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: '2026-11-01T00:00:00Z',
      },
    ],
    workWindows: [
      { startsAt: '2026-10-14T02:30:00Z', endsAt: '2026-10-14T04:30:00Z', shiftName: 'Morning' },
    ],
  });
  const assignees = vi.spyOn(client, 'listSafetyAssignees').mockResolvedValue({
    items: [{ id: 'representative-a', displayName: 'Pass' }],
    total: 1,
  });
  const submit = vi.fn();
  const { container } = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CreateChecklistForm
        client={client}
        apiUrl="http://local"
        token="token-a"
        scope="scope-a"
        siteId="site-a"
        user={{
          id: 'safety-a',
          username: 'safety',
          displayName: 'Safety',
          isActive: true,
          mustChangePassword: false,
          roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
        }}
        draft={{ teamId: 'team-a', day: '2026-10-14' }}
        pending={false}
        onSubmit={submit}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: 'Pass' });
  await waitFor(() =>
    expect((screen.getByLabelText('Work starts') as HTMLInputElement).value).not.toBe(''),
  );
  fireEvent.change(screen.getByLabelText('Contractor'), { target: { value: 'contractor-a' } });
  await waitFor(() =>
    expect(teams).toHaveBeenLastCalledWith(
      'token-a',
      'site-a',
      expect.objectContaining({ contractorId: 'contractor-a' }),
      { signal: expect.any(AbortSignal) },
    ),
  );
  await screen.findByRole('option', { name: 'Safety overview · My checklists' });
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team-a' } });
  await screen.findByRole('option', { name: 'Zone · A' });
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-a' } });
  fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'representative-a' } });
  fireEvent.change(screen.getByLabelText('Work description'), {
    target: { value: 'Safety overview\nCustom <>& work' },
  });
  fireEvent.change(screen.getByLabelText('Criterion 1'), {
    target: { value: 'Checklist report recorded' },
  });
  const values = () =>
    Array.from(
      container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      ),
    ).map((e) => [e.value, e.type === 'checkbox' ? (e as HTMLInputElement).checked : undefined]);
  const filled = values();
  const requests = [
    contractors.mock.calls.length,
    teams.mock.calls.length,
    detail.mock.calls.length,
    assignees.mock.calls.length,
  ];
  await switchTo('vi');
  expect(screen.getByRole('button', { name: 'Giao phiếu kiểm tra' })).not.toBeNull();
  expect((screen.getByLabelText('Mô tả công việc') as HTMLTextAreaElement).value).toBe(
    'Safety overview\nCustom <>& work',
  );
  expect(values()).toEqual(filled);
  expect(screen.getByRole('option', { name: 'Pass' })).not.toBeNull();
  await switchTo('en');
  expect(values()).toEqual(filled);
  expect([
    contractors.mock.calls.length,
    teams.mock.calls.length,
    detail.mock.calls.length,
    assignees.mock.calls.length,
  ]).toEqual(requests);
  fireEvent.submit(container.querySelector('form')!);
  expect(submit).toHaveBeenCalledOnce();
  expect(submit.mock.calls[0]![0]).toMatchObject({
    teamId: 'team-a',
    zoneId: 'zone-a',
    assignedTo: 'representative-a',
    description: 'Safety overview\nCustom <>& work',
    startsAt: '2026-10-14T02:30:00.000Z',
    endsAt: '2026-10-14T04:30:00.000Z',
  });
  expect(submit.mock.calls[0]![0].items[0]).toEqual({
    text: 'Checklist report recorded',
    evidenceRequired: false,
  });
  for (const request of [
    ...contractors.mock.calls,
    ...teams.mock.calls,
    ...detail.mock.calls,
    ...assignees.mock.calls,
  ])
    expect(request.slice(0, 2)).toEqual(['token-a', 'site-a']);
  expect(assignees).toHaveBeenLastCalledWith(
    'token-a',
    'site-a',
    'CONTRACTOR_REPRESENTATIVE',
    { offset: 0, limit: 20, contractorId: 'contractor-a' },
    { signal: expect.any(AbortSignal) },
  );
  await switchTo('vi');
  fireEvent.change(screen.getByLabelText('Phiếu kiểm tra gợi ý'), {
    target: { value: 'ELECTRICAL' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng mẫu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thay tiêu chí' }));
  expect((screen.getByLabelText('Tiêu chí 1') as HTMLTextAreaElement).value).toBe(
    'Đã hoàn thành phổ biến an toàn cho công việc này',
  );
  await switchTo('en');
  expect((screen.getByLabelText('Criterion 1') as HTMLTextAreaElement).value).toBe(
    'Đã hoàn thành phổ biến an toàn cho công việc này',
  );
});

it('retains report answers, authored notes and evidence while localizing labels and status tones', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const submit = vi.fn();
  const file = new File(['synthetic'], 'Safety overview.png', { type: 'image/png' });
  const { container } = render(
    <>
      <ReportChecklistForm
        items={[{ id: 'item-a', position: 0, text: 'Safety overview', evidenceRequired: true }]}
        pending={false}
        onSubmit={submit}
      />
      <StatusBadge value="PASS" />
      <StatusBadge value="ACCEPTED" />
      <StatusBadge value="CUSTOM_STATE" />
    </>,
  );
  fireEvent.change(screen.getByLabelText('Result: Safety overview'), { target: { value: 'PASS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  fireEvent.change(screen.getByLabelText('Notes: Safety overview'), {
    target: { value: 'Checklist report recorded\n<>&' },
  });
  fireEvent.change(screen.getByLabelText(/Evidence: Safety overview/), {
    target: { files: [file] },
  });
  await switchTo('vi');
  expect((screen.getByLabelText('Kết quả: Safety overview') as HTMLSelectElement).value).toBe(
    'PASS',
  );
  expect((screen.getByLabelText('Ghi chú: Safety overview') as HTMLTextAreaElement).value).toBe(
    'Checklist report recorded\n<>&',
  );
  expect(screen.getByAltText('Bằng chứng đã chọn cho Safety overview')).not.toBeNull();
  expect(screen.getByText('Đạt', { selector: 'span' }).className).toContain('semantic-green');
  expect(screen.getByText('Đã chấp nhận').className).toContain('semantic-green');
  expect(screen.getByText('CUSTOM_STATE')).not.toBeNull();
  fireEvent.submit(container.querySelector('form')!);
  expect(submit).toHaveBeenLastCalledWith(
    [
      {
        itemId: 'item-a',
        answer: 'PASS',
        note: 'Checklist report recorded\n<>&',
        fileIndexes: [0],
      },
    ],
    [file],
  );
  await switchTo('en');
  expect((screen.getByLabelText('Result: Safety overview') as HTMLSelectElement).value).toBe(
    'PASS',
  );
  expect(screen.getByAltText('Selected evidence for Safety overview')).not.toBeNull();
  fireEvent.submit(container.querySelector('form')!);
  expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
});
