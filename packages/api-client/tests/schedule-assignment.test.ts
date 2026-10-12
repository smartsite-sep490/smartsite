import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/management';
afterEach(() => vi.unstubAllGlobals());
it('passes the explicit contractor and team filters to the schedule reader', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ items: [], total: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  await new SmartSiteManagementClient('https://synthetic.test').listWorkerSchedules(
    'token',
    'site',
    { contractorId: 'contractor', teamId: 'team-123' },
  );
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    'https://synthetic.test/api/v1/sites/site/worker-schedules?contractorId=contractor&teamId=team-123',
  );
});
it('sends reviewed preview, create and change contracts to backend without per-worker requests', async () => {
  const fetcher = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ id: 'batch' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://synthetic.test');
  const input = {
    contractorId: 'contractor',
    scheduleVersionId: 'version',
    shiftId: 'shift',
    target: 'TEAM' as const,
    teamId: 'team',
    mode: 'WEEK' as const,
    fromDate: '2030-10-07',
    toDate: '2030-10-13',
    weekdays: [1, 2, 3, 4, 5],
  };
  await client.previewScheduleAssignment('token', 'site', input);
  await client.createScheduleAssignment('token', 'site', {
    ...input,
    requestId: 'request',
    expectedFingerprint: 'fingerprint',
  });
  await client.changeScheduleAssignment('token', 'site', 'batch', {
    requestId: 'change',
    expectedVersion: 1,
    action: 'CANCEL',
    scope: 'FROM_DATE',
    workDate: '2030-10-09',
    reason: 'Site closure',
  });
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    'https://synthetic.test/api/v1/sites/site/schedule-assignments/preview',
    'https://synthetic.test/api/v1/sites/site/schedule-assignments',
    'https://synthetic.test/api/v1/sites/site/schedule-assignments/batch/change',
  ]);
});
it('transports the unstarted batch command and preserves changed/skipped counts', async () => {
  const result = { id: 'batch', version: 2, changedCount: 4, skippedCount: 1 };
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const input = {
    requestId: 'change',
    expectedVersion: 1,
    action: 'CHANGE_SHIFT' as const,
    scope: 'UNSTARTED' as const,
    workDate: '2030-10-07',
    shiftId: 'replacement',
    reason: 'Correct remaining shifts',
  };
  expect(
    await new SmartSiteManagementClient('https://synthetic.test').changeScheduleAssignment(
      'token',
      'site',
      'batch',
      input,
    ),
  ).toEqual(result);
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual(input);
});
