import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
describe('MF03 client', () => {
  it('encodes scoped dates and IDs, authenticates and sends versions for review', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [],
            total: 0,
            requests: [],
            canReview: false,
            canRequest: false,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test');
    await client.attendanceDays('synthetic-token', 'site/1', {
      fromDate: '2026-10-01',
      toDate: '2026-10-08',
      offset: 20,
      limit: 20,
    });
    await client.confirmAttendanceDay('synthetic-token', 'site/1', 'day/1', {
      expectedVersion: 3,
      reviewNote: 'Verified actual hours',
    });
    await client.reviewAttendanceTime('synthetic-token', 'site/1', 'request/1', 'OVERTIME', {
      approve: true,
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/attendance-days?fromDate=2026-10-01&toDate=2026-10-08&offset=20&limit=20',
    );
    expect(calls[1]![0]).toContain('/attendance-days/day%2F1/confirm');
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({
      expectedVersion: 3,
      reviewNote: 'Verified actual hours',
    });
    expect(calls[2]![0]).toContain('/attendance-time-requests/OVERTIME/request%2F1/review');
    expect(JSON.parse(calls[2]![1].body as string)).toEqual({ approve: true });
    for (const [, init] of calls)
      expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
    await client.attendanceOverview('synthetic-token', 'site/1', { dayId: 'day/1' });
    expect(calls[3]![0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/attendance?dayId=day%2F1',
    );
    await client.ignoreDuplicateAttendance('synthetic-token', 'site/1', 'session/1', {
      expectedSessionVersion: 2,
      reason: 'Confirmed repeated scan',
    });
    expect(calls[4]![0]).toContain('/attendance-sessions/session%2F1/ignore-duplicate');
    expect(JSON.parse(calls[4]![1].body as string)).toEqual({
      expectedSessionVersion: 2,
      reason: 'Confirmed repeated scan',
    });
    await client.attendanceTimeRequests('synthetic-token', 'site/1', {
      kind: 'LEAVE',
      status: 'PENDING',
      workerId: 'worker/1',
      offset: 100,
      limit: 20,
    });
    expect(calls[5]![0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/attendance-time-requests?kind=LEAVE&status=PENDING&workerId=worker%2F1&offset=100&limit=20',
    );
  });
});
