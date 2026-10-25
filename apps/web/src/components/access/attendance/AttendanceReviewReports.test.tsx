// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttendanceView } from './AttendanceView';
import i18n, { translate as tr } from '../../../i18n';

const api = vi.hoisted(() => ({
  attendanceSummary: vi.fn(),
  attendanceWorkers: vi.fn(),
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
beforeEach(() => {
  api.attendanceSummary.mockResolvedValue(null);
  api.attendanceWorkers.mockResolvedValue({ items: [], total: 0 });
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
function mount(showRequests = true) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AttendanceView
        apiUrl="https://synthetic.test"
        token="token"
        siteId="site"
        sessionScope="session"
        showRequests={showRequests}
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
  api.attendanceWorkers.mockResolvedValue({
    items: [
      {
        workerId: 'worker',
        workerCode: 'W000001',
        workerName: 'Safety overview',
        todayStatus: 'PRESENT',
        totalMinutes: 480,
        regularMinutes: 480,
        overtimeMinutes: 0,
        provisionalMinutes: 0,
        presentDays: 1,
        requiredDays: 1,
        attendanceRate: 100,
      },
    ],
    total: 1,
  });
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
      language === 'vi' ? 'Mã công nhân,Tên công nhân' : 'Worker Code,Worker Name',
    );
    expect(content).toContain(language === 'vi' ? 'Có mặt' : 'Present');
    expect(content).toContain('"W000001","Safety overview"');
  }
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
