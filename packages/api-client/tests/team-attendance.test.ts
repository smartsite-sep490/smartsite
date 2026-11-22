import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());

it('encodes leader and roll-call routes and preserves optimistic concurrency and retry IDs', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const appointment = { expectedVersion: 4, workerId: 'worker' };
  await client.setContractorTeamLeader(
    'test-only',
    'site/1',
    'contractor/1',
    'team/1',
    appointment,
  );
  await client.scheduleTeamAttendance('test-only', 'site/1', 'schedule/1');
  const input = {
    requestId: 'stable-request-id',
    teamId: 'team',
    zoneId: 'zone',
    entries: [
      {
        scheduleId: 'peer-schedule',
        expectedMembershipId: 'membership',
        expectedVersion: 3,
        status: 'ABSENT' as const,
      },
    ],
    reason: 'Corrected after rechecking',
  };
  await client.submitTeamAttendance('test-only', 'site/1', 'schedule/1', input);
  await client.contractorTeamCalendar('test-only', 'site/1', {
    contractorId: 'contractor/1',
    teamId: 'team/1',
    fromDate: '2026-11-09',
    toDate: '2026-11-15',
  });
  await client.contractorTeamAttendance('test-only', 'site/1', 'contractor/1', 'team/1', {
    workDate: '2026-11-20',
    shiftId: 'shift',
    scheduleVersionId: 'version',
    offset: 8,
    limit: 8,
  });
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0]![0]).toContain(
    '/sites/site%2F1/contractors/contractor%2F1/teams/team%2F1/leader',
  );
  expect(calls[0]![1].method).toBe('PUT');
  expect(JSON.parse(calls[0]![1].body as string)).toEqual(appointment);
  expect(calls[1]![0]).toContain('/sites/site%2F1/worker-schedules/schedule%2F1/zone-attendance');
  expect(calls[1]![1].method).toBe('GET');
  expect(calls[2]![1].method).toBe('PUT');
  expect(JSON.parse(calls[2]![1].body as string)).toEqual(input);
  const calendarUrl = new URL(calls[3]![0]);
  expect(calendarUrl.pathname).toContain('/sites/site%2F1/schedule-assignments/calendar');
  expect(Object.fromEntries(calendarUrl.searchParams)).toEqual({
    contractorId: 'contractor/1',
    teamId: 'team/1',
    fromDate: '2026-11-09',
    toDate: '2026-11-15',
  });
  for (const [, request] of calls)
    expect(request.headers).toMatchObject({ Authorization: 'Bearer test-only' });
  const attendanceUrl = new URL(calls[4]![0]);
  expect(attendanceUrl.pathname).toContain(
    '/sites/site%2F1/contractors/contractor%2F1/teams/team%2F1/attendance',
  );
  expect(Object.fromEntries(attendanceUrl.searchParams)).toEqual({
    workDate: '2026-11-20',
    shiftId: 'shift',
    scheduleVersionId: 'version',
    offset: '8',
    limit: '8',
  });
});
