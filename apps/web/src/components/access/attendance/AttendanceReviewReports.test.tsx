// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttendanceExportResponse } from '@smartsite/contracts';
import { AttendanceView } from './AttendanceView';
import i18n, { translate as tr } from '../../../i18n';

const api = vi.hoisted(() => ({
  attendanceSummary: vi.fn(),
  attendanceWorkers: vi.fn(),
  attendanceExport: vi.fn(),
  listShifts: vi.fn(),
  attendanceOverview: vi.fn(),
  reviewAttendanceCorrection: vi.fn(),
}));
vi.mock('@smartsite/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smartsite/api-client')>()),
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
vi.mock('./AttendanceDaysView', () => ({
  AttendanceDaysView: ({
    selectedDayId,
    activeSubTab,
  }: {
    selectedDayId: string;
    activeSubTab?: string;
  }) => (activeSubTab === 'requests' ? null : <p>Day workflow: {selectedDayId}</p>),
}));
vi.mock('./AttendanceSummaryCards', () => ({ AttendanceSummaryCards: () => null }));
vi.mock('./AttendanceWorkersTable', () => ({
  AttendanceWorkersTable: ({ onSelectWorker }: { onSelectWorker: (id: string) => void }) => (
    <button onClick={() => onSelectWorker('worker-1')}>View worker</button>
  ),
}));
vi.mock('./WorkerAttendanceDetailPanel', () => ({
  WorkerAttendanceDetailPanel: () => (
    <table aria-label="Worker session details">
      <tbody>
        <tr>
          <td>Worker details</td>
        </tr>
      </tbody>
    </table>
  ),
}));

const session = {
  id: 'session-1',
  workerName: 'Synthetic Worker',
  effectiveInAt: '2030-10-08T01:00:00Z',
  effectiveOutAt: null,
  status: 'OPEN',
  version: 1,
};
const pending = {
  id: 'correction-1',
  attendanceSessionId: session.id,
  workerName: session.workerName,
  proposedInAt: session.effectiveInAt,
  proposedOutAt: '2030-10-08T10:00:00Z',
  reason: 'Forgot checkout',
  status: 'PENDING',
  reviewNote: null,
};
const exportSnapshot: AttendanceExportResponse = {
  siteId: 'site',
  siteName: 'Synthetic site',
  fromDate: '2026-11-01',
  toDate: '2026-11-07',
  timezone: 'Asia/Ho_Chi_Minh',
  today: '2026-11-11',
  asOf: '2026-11-11T01:00:00Z',
  total: 1,
  items: [
    {
      workerId: 'worker',
      workerCode: 'W000001',
      workerName: 'Safety overview',
      contractorId: null,
      todayStatus: 'PRESENT',
      todayFirstCheckInAt: null,
      todayLastCheckOutAt: null,
      totalMinutes: 480,
      regularMinutes: 480,
      overtimeMinutes: 0,
      provisionalMinutes: 0,
      confirmedDays: 1,
      requiredDays: 1,
      presentDays: 1,
      absentDays: 0,
      reviewDays: 0,
      attendanceRate: 100,
      isProvisional: false,
    },
  ],
};
beforeEach(() => {
  api.attendanceSummary.mockResolvedValue(null);
  api.attendanceWorkers.mockResolvedValue({ items: [], total: 0 });
  api.attendanceExport.mockResolvedValue({ ...exportSnapshot, items: [], total: 0 });
  api.listShifts.mockResolvedValue({ items: [] });
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: false,
    canReviewCorrection: true,
    sessions: [session],
    corrections: [pending],
  });
  api.reviewAttendanceCorrection.mockResolvedValue({ id: pending.id });
});
afterEach(async () => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});
function mount(showRequests = true, canExport = true) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AttendanceView
        apiUrl="https://synthetic.test"
        token="token"
        siteId="site"
        sessionScope="session"
        showRequests={showRequests}
        canExport={canExport}
      />
    </QueryClientProvider>,
  );
}

it.each([
  '/access?tab=attendance&subtab=requests',
  '/access?tab=attendance#attendance-correction-form',
])(
  'keeps the Site Manager on timesheets without request or approval content for %s',
  async (url) => {
    window.history.replaceState({}, '', url);
    mount(false);
    await screen.findByRole('button', { name: 'View worker' });
    expect(screen.getByRole('button', { name: 'Timesheet' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /Requests & Approvals/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Correction requests/ })).toBeNull();
    expect(screen.queryByText('Forgot checkout')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve correction' })).toBeNull();
  },
);

it('exports CSV headers and statuses in the selected language while preserving worker data', async () => {
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:synthetic-csv';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.attendanceExport.mockResolvedValue(exportSnapshot);
  mount();
  await screen.findByRole('button', { name: 'View worker' });
  for (const language of ['vi', 'en'] as const) {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    fireEvent.click(screen.getByRole('button', { name: tr('attendance_report.export') }));
    await waitFor(() => expect(blobs).toHaveLength(language === 'vi' ? 1 : 2));
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs.at(-1)!);
    });
    expect(content).toContain(
      language === 'vi' ? '"Mã công nhân","Tên công nhân"' : '"Worker Code","Worker Name"',
    );
    expect(content).toContain(language === 'vi' ? 'Có mặt' : 'Present');
    expect(content).toContain('"W000001","Safety overview"');
  }
});

it('hides all export actions without the report export capability', async () => {
  mount(false, false);
  await screen.findByRole('button', { name: 'View worker' });
  expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
});

it('reports an empty snapshot without creating an empty download', async () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: tr('attendance_report.export') }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toMatch(/no attendance records/i),
  );
  expect(createUrl).not.toHaveBeenCalled();
});

it('shows a safe export error and allows retry after the snapshot request fails', async () => {
  api.attendanceExport.mockRejectedValue(new Error('synthetic internal error'));
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: tr('attendance_report.export') }));
  const error = await screen.findByRole('alert');
  expect(error.textContent).toMatch(/could not export attendance/i);
  expect(error.textContent).not.toContain('synthetic internal error');
  expect(createUrl).not.toHaveBeenCalled();
  expect(
    (screen.getByRole('button', { name: tr('attendance_report.export') }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

it.each(['sessionScope', 'siteId', 'token', 'unmount'])(
  'aborts and suppresses a pending export on %s change',
  async (changed) => {
    let finish!: (value: unknown) => void;
    api.attendanceExport.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (replacement: boolean) => (
      <QueryClientProvider client={client}>
        <AttendanceView
          apiUrl="https://synthetic.test"
          token={replacement && changed === 'token' ? 'replacement' : 'token'}
          siteId={replacement && changed === 'siteId' ? 'replacement' : 'site'}
          sessionScope={replacement && changed === 'sessionScope' ? 'replacement' : 'original'}
          canExport
        />
      </QueryClientProvider>
    );
    const rendered = render(view(false));
    fireEvent.click(screen.getByRole('button', { name: tr('attendance_report.export') }));
    const signal = api.attendanceExport.mock.calls[0]![3].signal as AbortSignal;
    if (changed === 'unmount') rendered.unmount();
    else rendered.rerender(view(true));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ items: [{ workerName: 'Old scope' }], total: 1 }));
    expect(createUrl).not.toHaveBeenCalled();
  },
);

it('keeps the clicked filters and language while a snapshot is loading', async () => {
  let finish!: (report: AttendanceExportResponse) => void;
  api.attendanceExport.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:attendance';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mount(false);
  fireEvent.change(screen.getByRole('combobox', { name: 'Today Status' }), {
    target: { value: 'PRESENT' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Today Status' }), {
    target: { value: 'ABSENT' },
  });
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  await act(async () => finish(exportSnapshot));
  await waitFor(() => expect(blobs).toHaveLength(1));
  expect(api.attendanceExport).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({ todayStatus: 'PRESENT' }),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const content = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blobs[0]!);
  });
  expect(content).toContain('"Worker Code","Worker Name"');
  expect(content).toContain('"Present"');
  expect(content).not.toContain('Có mặt');
});
it('shows recorded and proposed hours and approval without expanding the report workflow', async () => {
  mount();
  fireEvent.click(await screen.findByRole('link', { name: 'Correction requests (1)' }));
  expect(
    screen.getByRole('button', { name: /Requests & Approvals/ }).getAttribute('aria-pressed'),
  ).toBe('true');
  expect(await screen.findByText(/Recorded interval:/)).toBeTruthy();
  expect(screen.getByText(/Proposed interval:/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Correction requests (1)' }).getAttribute('href')).toBe(
    '#attendance-correction-form',
  );
  expect(screen.queryByText(/Day workflow:/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Approve correction' }));
  await waitFor(() =>
    expect(api.reviewAttendanceCorrection).toHaveBeenCalledWith('token', 'site', pending.id, {
      approve: true,
    }),
  );
  await waitFor(() => expect(api.attendanceWorkers.mock.calls.length).toBeGreaterThan(1));
});
it('requires a reason before rejecting from the reports UI', async () => {
  mount();
  fireEvent.click(await screen.findByRole('link', { name: 'Correction requests (1)' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reject correction' }));
  expect(
    (screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Rejection reason'), {
    target: { value: 'Times do not match evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
  await waitFor(() =>
    expect(api.reviewAttendanceCorrection).toHaveBeenCalledWith('token', 'site', pending.id, {
      approve: false,
      reviewNote: 'Times do not match evidence',
    }),
  );
});
it('opens the day workflow when arriving from an attendance notification', async () => {
  window.history.replaceState({}, '', '/access?tab=attendance&dayId=day-1');
  mount();
  expect(await screen.findByText('Day workflow: day-1')).toBeTruthy();
  await waitFor(() =>
    expect(api.attendanceOverview).toHaveBeenCalledWith('token', 'site', { dayId: 'day-1' }),
  );
});
it('hides review actions when the backend denies correction review capability', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: false,
    canReviewCorrection: false,
    sessions: [session],
    corrections: [pending],
  });
  mount();
  await screen.findByText('Forgot checkout');
  expect(screen.queryByRole('button', { name: 'Approve correction' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reject correction' })).toBeNull();
});
it('shows session tables only in the selected worker detail, not the overview', async () => {
  mount();
  await screen.findByText('Forgot checkout');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View worker' }));
  expect(await screen.findByRole('table', { name: 'Worker session details' })).toBeTruthy();
});
it('separates pending corrections from approved and rejected history', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: false,
    canReviewCorrection: true,
    sessions: [session],
    corrections: [
      pending,
      { ...pending, id: 'approved', status: 'APPROVED', reason: 'Approved request' },
      {
        ...pending,
        id: 'rejected',
        status: 'REJECTED',
        reason: 'Rejected request',
        reviewNote: 'Evidence differs',
      },
    ],
  });
  mount();
  await screen.findByText('Forgot checkout');
  expect(screen.queryByText('Approved request')).toBeNull();
  expect(screen.queryByText('Rejected request')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Requests & Approvals/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Request History' }));
  expect(screen.getByText('Approved request')).toBeTruthy();
  expect(screen.getByText('Rejected request')).toBeTruthy();
  expect(screen.queryByText('Forgot checkout')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve correction' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Correction requests (1)' }));
  expect(screen.getByText('Forgot checkout')).toBeTruthy();
});
it('shows an empty pending queue without a review notification when all requests are reviewed', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: false,
    canReviewCorrection: true,
    sessions: [session],
    corrections: [{ ...pending, status: 'APPROVED' }],
  });
  mount();
  await screen.findByText('No attendance corrections awaiting your review.');
  expect(screen.queryByRole('link', { name: /Correction requests/ })).toBeNull();
  expect(screen.queryByText(/request\(s\) awaiting your review/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Requests & Approvals/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Request History' }));
  expect(screen.getByText('Forgot checkout')).toBeTruthy();
});
