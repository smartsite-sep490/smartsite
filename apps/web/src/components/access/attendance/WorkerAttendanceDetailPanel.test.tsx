// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerAttendanceDetailPanel } from './WorkerAttendanceDetailPanel';
import i18n from '../../../i18n';

const api = vi.hoisted(() => ({ attendanceWorkers: vi.fn(), attendanceDayDetail: vi.fn() }));
vi.mock('@smartsite/api-client', () => ({
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
let cache: QueryClient;
afterEach(async () => {
  cleanup();
  cache?.clear();
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});

it.each([null, 0, 420])(
  'shows provisional hours until confirmed and respects confirmed=%s and zero exit allowance',
  async (confirmedMinutes) => {
    api.attendanceWorkers.mockResolvedValue({
      items: [
        {
          workerId: 'worker',
          workerName: 'Synthetic Worker',
          workerCode: 'W1',
          todayStatus: 'PRESENT',
          totalMinutes: 0,
          regularMinutes: 0,
          overtimeMinutes: 0,
          provisionalMinutes: 60,
          confirmedDays: 0,
          requiredDays: 1,
          presentDays: 1,
          absentDays: 0,
          reviewDays: 0,
          attendanceRate: 100,
          shifts: [],
          daily: [
            {
              workDate: '2026-10-15',
              attendanceDayId: 'day',
              shifts: [],
              status: 'PRESENT',
              hoursStatus: 'PROVISIONAL',
              regularMinutes: 480,
              overtimeMinutes: 0,
              totalMinutes: 0,
              provisionalMinutes: confirmedMinutes === 0 ? 0 : 60,
              anomalies: [],
            },
          ],
        },
      ],
    });
    api.attendanceDayDetail.mockResolvedValue({
      day: {
        startsAt: '2026-10-15T08:00:00Z',
        endsAt: '2026-10-15T17:00:00Z',
        regularMinutes: 480,
        overtimeMinutes: 0,
        provisionalMinutes: 60,
        confirmedMinutes,
        exitCount: 1,
        maxExitCount: 0,
        deductedMinutes: 0,
      },
      sessions: [
        {
          id: 'session',
          effectiveInAt: '2026-10-15T08:00:00Z',
          effectiveOutAt: '2026-10-15T09:00:00Z',
          rawInAt: '2026-10-15T08:00:00Z',
          rawOutAt: '2026-10-15T09:00:00Z',
          workedMinutes: 60,
          status: 'MATCHED',
          ignoreReason: 'Worker-authored note',
        },
      ],
    });
    cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cache}>
        <WorkerAttendanceDetailPanel
          apiUrl="https://example.test"
          token="synthetic"
          siteId="site"
          sessionScope="worker"
          workerId="worker"
          fromDate="2026-10-15"
          toDate="2026-10-15"
          timezone="UTC"
          onBack={() => {}}
          onPreviousWeek={() => {}}
          onNextWeek={() => {}}
        />
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'View details' }));
    const label = await screen.findByText('Net Working Hours');
    const expected =
      confirmedMinutes === null ? '1h 0m' : confirmedMinutes === 0 ? '0h 0m' : '7h 0m';
    expect(within(label.parentElement!).getByText(expected)).toBeTruthy();
    expect(screen.queryByText('8h 0m', { selector: '.text-emerald-700' })).toBeNull();
    expect(screen.getByText(/max.*0/i)).toBeTruthy();
    expect(screen.getByText('Check-in/out matched')).toBeTruthy();
    expect(screen.queryByText('MATCHED')).toBeNull();
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByRole('button', { name: 'Ẩn chi tiết' })).toBeTruthy();
    expect(screen.getByText('Đã ghép lượt vào / ra')).toBeTruthy();
    expect(screen.getByText('Hiệu lực: 08:00 – 09:00')).toBeTruthy();
    expect(screen.getByText('Thực tế: 08:00 – 09:00')).toBeTruthy();
    expect(screen.getByText('Worker-authored note')).toBeTruthy();
    expect(screen.queryByText('0h 0m')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide details' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ẩn chi tiết' }));
    expect(screen.getByRole('button', { name: 'Xem chi tiết' })).toBeTruthy();
  },
);
