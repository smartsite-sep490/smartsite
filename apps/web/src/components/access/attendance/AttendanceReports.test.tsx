// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AttendanceReportDay,
  AttendanceSummaryResponse,
  AttendanceWorkerReport,
} from '@smartsite/contracts';
import { AttendanceSummaryCards } from './AttendanceSummaryCards';
import { AttendanceDailyBarChart } from './AttendanceDailyBarChart';
import { AttendanceDistributionDonut } from './AttendanceDistributionDonut';
import { AttendanceWorkersTable } from './AttendanceWorkersTable';
import { AttendanceStatusBadge } from './AttendanceStatusBadge';

afterEach(() => {
  cleanup();
});

describe('AttendanceSummaryCards', () => {
  it('renders exactly 4 cards: Total Workers, Total Working Hours, Absent Today, and Overtime Hours', () => {
    const summary: AttendanceSummaryResponse = {
      siteId: 'site-1',
      fromDate: '2026-10-01',
      toDate: '2026-10-07',
      today: '2026-10-07',
      timezone: 'Asia/Ho_Chi_Minh',
      asOf: '2026-10-07T10:00:00Z',
      totalWorkers: 50,
      totalMinutes: 24000,
      regularMinutes: 21000,
      overtimeMinutes: 3000,
      provisionalMinutes: 600,
      absentTodayCount: 5,
      overtimeWorkerCount: 12,
      workingMinutesChangePercent: 4.5,
      confirmedDays: 5,
      requiredDays: 5,
      presentDays: 5,
      absentDays: 0,
      reviewDays: 0,
      attendanceRate: 100,
      isProvisional: false,
      previousPeriod: {
        fromDate: '2026-09-24',
        toDate: '2026-09-30',
        totalMinutes: 22000,
      },
    };

    render(<AttendanceSummaryCards summary={summary} isLoading={false} />);

    // Must have the 4 exact cards
    expect(screen.getByText('Total Workers')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();

    expect(screen.getByText('Total Working Hours')).toBeTruthy();
    expect(screen.getByText('400h 0m')).toBeTruthy();
    expect(screen.getByText('+4.5%')).toBeTruthy();

    expect(screen.getByText('Absent Today')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();

    expect(screen.getByText('Overtime Hours')).toBeTruthy();
    expect(screen.getByText('50h 0m')).toBeTruthy();
    expect(screen.getByText('12 workers')).toBeTruthy();

    // MUST NOT render "Present Today"
    expect(screen.queryByText(/Present Today/i)).toBeNull();
    expect(screen.queryByText(/Có mặt hôm nay/i)).toBeNull();
  });

  it('handles empty / zero values and null change percentage cleanly without NaN', () => {
    const summary: AttendanceSummaryResponse = {
      siteId: 'site-1',
      fromDate: '2026-10-01',
      toDate: '2026-10-07',
      today: '2026-10-07',
      timezone: 'Asia/Ho_Chi_Minh',
      asOf: '2026-10-07T10:00:00Z',
      totalWorkers: 0,
      totalMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      provisionalMinutes: 0,
      absentTodayCount: 0,
      overtimeWorkerCount: 0,
      workingMinutesChangePercent: null,
      confirmedDays: 0,
      requiredDays: 0,
      presentDays: 0,
      absentDays: 0,
      reviewDays: 0,
      attendanceRate: null,
      isProvisional: false,
      previousPeriod: {
        fromDate: '2026-09-24',
        toDate: '2026-09-30',
        totalMinutes: 0,
      },
    };

    render(<AttendanceSummaryCards summary={summary} isLoading={false} />);
    expect(screen.getAllByText('0h 0m')).toHaveLength(2);
    expect(screen.queryByText(/compared to last period/i)).toBeNull();
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

describe('AttendanceDailyBarChart', () => {
  it('renders stacked bars and provides an accessible screen-reader table', () => {
    const daily: AttendanceReportDay[] = [
      {
        workDate: '2026-10-01',
        attendanceDayId: 'day-1',
        status: 'PRESENT',
        shifts: [],
        firstCheckInAt: null,
        lastCheckOutAt: null,
        hoursStatus: 'CONFIRMED',
        regularMinutes: 480,
        overtimeMinutes: 60,
        totalMinutes: 540,
        provisionalMinutes: 0,
        anomalies: [],
      },
      {
        workDate: '2026-10-02',
        attendanceDayId: 'day-2',
        status: 'PRESENT',
        shifts: [],
        firstCheckInAt: null,
        lastCheckOutAt: null,
        hoursStatus: 'CONFIRMED',
        regularMinutes: 480,
        overtimeMinutes: 0,
        totalMinutes: 480,
        provisionalMinutes: 0,
        anomalies: [],
      },
    ];

    render(<AttendanceDailyBarChart daily={daily} />);

    // Screen reader accessible table should exist
    const srTable = screen.getByRole('table');
    expect(srTable).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 days
  });
});

describe('AttendanceDistributionDonut', () => {
  it('calculates proportions accurately and renders legend', () => {
    render(
      <AttendanceDistributionDonut
        regularMinutes={2400}
        overtimeMinutes={600}
      />,
    );

    expect(screen.getByText('50h 0m')).toBeTruthy(); // 3000 / 60
    expect(screen.getByText('Regular')).toBeTruthy();
    expect(screen.getByText('40h 0m')).toBeTruthy();
    expect(screen.getByText('Overtime')).toBeTruthy();
    expect(screen.getByText('10h 0m')).toBeTruthy();
  });
});

describe('AttendanceStatusBadge', () => {
  it('renders appropriate labels and accessible roles for each status', () => {
    const { rerender } = render(<AttendanceStatusBadge status="PRESENT" />);
    expect(screen.getByText('Present')).toBeTruthy();

    rerender(<AttendanceStatusBadge status="ABSENT" />);
    expect(screen.getByText('Absent')).toBeTruthy();

    rerender(<AttendanceStatusBadge status="OFF" />);
    expect(screen.getByText('Day off')).toBeTruthy();

    rerender(<AttendanceStatusBadge status="APPROVED_LEAVE" />);
    expect(screen.getByText('Approved leave')).toBeTruthy();

    rerender(<AttendanceStatusBadge status="NOT_ARRIVED" />);
    expect(screen.getByText('Not checked in')).toBeTruthy();

    rerender(<AttendanceStatusBadge status="SCHEDULED" />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
  });
});

describe('AttendanceWorkersTable', () => {
  it('renders worker rows and handles selection callback', async () => {
    const onSelectWorker = vi.fn();
    const onPageChange = vi.fn();

    const workers: AttendanceWorkerReport[] = [
      {
        workerId: 'worker-1',
        workerCode: 'W001',
        workerName: 'Nguyen Van A',
        contractorId: 'c-1',
        todayStatus: 'PRESENT',
        todayFirstCheckInAt: '2026-10-07T08:00:00Z',
        todayLastCheckOutAt: '2026-10-07T17:00:00Z',
        totalMinutes: 480,
        regularMinutes: 420,
        overtimeMinutes: 60,
        provisionalMinutes: 0,
        confirmedDays: 5,
        presentDays: 5,
        requiredDays: 5,
        absentDays: 0,
        reviewDays: 0,
        attendanceRate: 100,
        isProvisional: false,
      },
    ];

    render(
      <AttendanceWorkersTable
        workers={workers}
        total={1}
        offset={0}
        limit={20}
        isLoading={false}
        timezone="Asia/Ho_Chi_Minh"
        onSelectWorker={onSelectWorker}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText('Nguyen Van A')).toBeTruthy();
    expect(screen.getByText(/W001/)).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();

    const viewButton = screen.getByRole('button', { name: /View Nguyen Van A/i });
    await userEvent.click(viewButton);
    expect(onSelectWorker).toHaveBeenCalledWith('worker-1');
  });
});
