import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { AttendanceDaysResponse } from '@smartsite/contracts';
import { AttendanceDaysView } from './AttendanceDaysView';
import { notificationHref } from '../../../features/notifications/notification-utils';

describe('MF03 Web', () => {
  it('separates provisional hours from confirmed timesheet and hides review controls from worker', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const data: AttendanceDaysResponse = {
      canReview: false,
      canRequest: true,
      total: 1,
      requests: [],
      items: [
        {
          id: 'day-1',
          workerId: 'worker-1',
          workerName: 'Synthetic Worker',
          workDate: '2026-10-08',
          timezone: 'Asia/Ho_Chi_Minh',
          scheduleId: 'schedule-1',
          shiftName: 'Day shift',
          startsAt: '2026-10-08T01:00:00Z',
          endsAt: '2026-10-08T10:00:00Z',
          status: 'NEEDS_REVIEW',
          regularMinutes: 180,
          overtimeMinutes: 0,
          provisionalMinutes: 420,
          confirmedMinutes: null,
          presence: 'INSIDE',
          anomalies: ['MISSING_OUT'],
          version: 3,
          canRequest: true,
        },
      ],
    };
    cache.setQueryData(
      ['attendance-days', 'https://api.example.test', 'user-1', 'site-1', '', '', '', '', 0],
      data,
    );
    cache.setQueryData(['attendance-schedules', 'https://api.example.test', 'user-1', 'site-1'], {
      items: [],
      total: 0,
    });
    cache.setQueryData(
      ['attendance-timesheets', 'https://api.example.test', 'user-1', 'site-1', '', '', ''],
      { items: [] },
    );
    try {
      const html = renderToStaticMarkup(
        <QueryClientProvider client={cache}>
          <AttendanceDaysView
            apiUrl="https://api.example.test"
            token="synthetic-token"
            sessionScope="user-1"
            siteId="site-1"
          />
        </QueryClientProvider>,
      );
      expect(html).toContain('7h 0m');
      expect(html).toContain('Awaiting confirmation');
      expect(html).toContain('Missing check-out');
      expect(html).not.toContain('Review note');
      expect(html).toContain('No confirmed hours');
    } finally {
      cache.clear();
      vi.unstubAllGlobals();
    }
  });
  it('routes attendance notifications to scoped attendance view', () => {
    expect(
      notificationHref({
        id: 'n1',
        event: 'MISSING_CHECKOUT',
        siteId: 'site-1',
        siteName: 'Synthetic',
        title: 'Missing checkout',
        message: 'Checkout needed',
        createdAt: '2026-10-08T10:05:00Z',
        readAt: null,
        target: { siteId: 'site-1', dayId: 'day-1', tab: 'attendance' },
      }),
    ).toBe('/access?siteId=site-1&dayId=day-1&tab=attendance');
  });
});
