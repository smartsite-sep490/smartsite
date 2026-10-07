// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  ApiError,
  SmartSiteManagementClient,
  type ShiftRequestResponse,
} from '@smartsite/api-client';
import { WorkforceScheduleTab } from '../components/WorkforceScheduleTab';
import { schedulingError } from '../utils/scheduling-error';

const empty = { items: [], total: 0, pendingCount: 0, incomingCount: 0, pendingScheduleIds: [] };
const change: ShiftRequestResponse = {
  requestType: 'CHANGE',
  id: 'request-1',
  siteId: 'site-1',
  workerId: 'worker-a',
  workerScheduleId: 'schedule-a',
  fromShiftId: 'morning',
  toShiftId: 'evening',
  expectedScheduleVersionId: 'version-1',
  status: 'REJECTED',
  requestedByUserId: 'user-a',
  reason: 'Synthetic page zero',
  reviewedByUserId: null,
  reviewedAt: null,
  reviewReason: null,
  appliedAt: null,
  createdAt: '2030-01-01T00:00:00Z',
};
let queries: QueryClient;
function mount(view: string) {
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <MemoryRouter initialEntries={[`/workforce?view=${view}`]}>
        <WorkforceScheduleTab
          apiUrl="https://api.example.test"
          siteId="site-1"
          token="synthetic-token"
          currentUserId="user-a"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockResolvedValue({
    id: 'site-1',
    code: 'SYNTHETIC',
    name: 'Synthetic Site',
    createdAt: '2030-01-01T00:00:00Z',
  });
  for (const method of [
    'listShifts',
    'listWorkers',
    'listCoworkers',
    'listWorkerSchedules',
  ] as const)
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftRequests').mockResolvedValue(empty);
});
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('shows discovery failure with Retry and does not substitute the full shift catalog', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
  vi.mocked(SmartSiteManagementClient.prototype.listWorkerSchedules).mockResolvedValue({
    items: [
      {
        id: 'schedule-a',
        siteId: 'site-1',
        workerId: 'worker-a',
        shiftId: 'morning',
        scheduleVersionId: 'version-1',
        workDate: '2030-01-01',
        isActive: true,
        createdAt: '2030-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
    items: ['morning', 'evening'].map((id) => ({
      id,
      siteId: 'site-1',
      name: id,
      startsAt: '2030-01-01T08:00:00Z',
      endsAt: '2030-01-01T16:00:00Z',
      timezone: 'UTC',
      createdAt: '2030-01-01T00:00:00Z',
    })),
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listEligibleShifts').mockRejectedValue(
    new ApiError('network', 'Synthetic private detail'),
  );
  mount('schedule');
  fireEvent.click(await screen.findByRole('button', { name: 'Request change' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('The request could not be completed. Please try again.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Submit Change Request' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(screen.queryByText('No eligible shifts are available.')).toBeNull();
});

it.each(['Change', 'Swap'])(
  'explains short or whitespace-only reasons in the %s form',
  async (action) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
    vi.mocked(SmartSiteManagementClient.prototype.listWorkerSchedules).mockResolvedValue({
      items: [
        {
          id: 'schedule-a',
          siteId: 'site-1',
          workerId: 'worker-a',
          shiftId: 'morning',
          scheduleVersionId: 'version-1',
          workDate: '2030-01-01',
          isActive: true,
          createdAt: '2030-01-01T00:00:00Z',
        },
      ],
      total: 1,
    });
    vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
      items: [
        {
          id: 'morning',
          siteId: 'site-1',
          name: 'morning',
          startsAt: '2030-01-01T08:00:00Z',
          endsAt: '2030-01-01T16:00:00Z',
          timezone: 'UTC',
          createdAt: '2030-01-01T00:00:00Z',
        },
      ],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listEligibleShifts').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSwapCandidates').mockResolvedValue({
      items: [],
      total: 0,
    });
    const submit = vi.spyOn(
      SmartSiteManagementClient.prototype,
      action === 'Change' ? 'createShiftChangeRequest' : 'createShiftSwapRequest',
    );
    mount('schedule');
    fireEvent.click(
      await screen.findByRole('button', {
        name: action === 'Change' ? 'Request change' : 'Swap shift',
      }),
    );
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    const button = screen.getByRole('button', { name: `Submit ${action} Request` });
    for (const value of ['', 'abc', '     ', ' abcd ']) {
      fireEvent.change(reason, { target: { value } });
      expect(
        screen.getByText(
          value.length > 0
            ? 'Reason must be at least 5 characters.'
            : 'Reason must be 5 to 1000 characters.',
        ),
      ).toBeTruthy();
      expect(reason.getAttribute('aria-invalid')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(true);
      fireEvent.submit(reason.closest('form')!);
      expect(submit).not.toHaveBeenCalled();
    }
    fireEvent.change(reason, { target: { value: ' abcde ' } });
    expect(screen.queryByText('Reason must be at least 5 characters.')).toBeNull();
    expect(reason.getAttribute('aria-invalid')).toBe('false');
    expect(reason.getAttribute('maxlength')).toBe('1000');
  },
);

it('fetches the next server page instead of slicing the first 25 requests', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listShiftRequests).mockImplementation(
    async (_token, _site, options) =>
      options.view === 'INCOMING'
        ? empty
        : {
            ...empty,
            total: 61,
            items: [
              {
                ...change,
                id: `request-${options.offset ?? 0}`,
                reason: `Synthetic page ${options.offset ?? 0}`,
              },
            ],
          },
  );
  mount('requests');
  expect(await screen.findByText('Synthetic page 0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Synthetic page 10')).toBeTruthy();
  expect(screen.queryByText('Synthetic page 0')).toBeNull();
  expect(SmartSiteManagementClient.prototype.listShiftRequests).toHaveBeenCalledWith(
    'synthetic-token',
    'site-1',
    { view: 'WORKER', offset: 10, limit: 10 },
  );
});

it('shows an English error and Retry instead of an empty coworker queue on a failed list request', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listShiftRequests).mockRejectedValue(
    new ApiError('network', 'Synthetic private detail'),
  );
  mount('coworker');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('The request could not be completed. Please try again.')).toBeTruthy();
  expect(screen.queryByText('No Pending Coworker Swaps')).toBeNull();
  vi.mocked(SmartSiteManagementClient.prototype.listShiftRequests).mockResolvedValue(empty);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No Pending Coworker Swaps')).toBeTruthy();
});

it('shows coworker confirmation failure without removing the pending request', async () => {
  const swap = {
    requestType: 'SWAP' as const,
    id: 'swap-1',
    siteId: 'site-1',
    requesterWorkerId: 'worker-b',
    coworkerWorkerId: 'worker-a',
    requesterWorkerScheduleId: 'schedule-b',
    coworkerWorkerScheduleId: 'schedule-a',
    requesterShiftId: 'evening',
    coworkerShiftId: 'morning',
    expectedScheduleVersionId: 'version-1',
    status: 'PENDING_COWORKER' as const,
    requestedByUserId: 'user-b',
    reason: 'Synthetic incoming request',
    coworkerConfirmedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    appliedAt: null,
    createdAt: '2030-01-01T00:00:00Z',
  };
  vi.mocked(SmartSiteManagementClient.prototype.listShiftRequests).mockResolvedValue({
    ...empty,
    items: [swap],
    total: 1,
    pendingCount: 1,
    incomingCount: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'confirmShiftSwapRequest').mockRejectedValue(
    new ApiError('http', 'Synthetic private detail', 403),
  );
  mount('coworker');
  fireEvent.click(await screen.findByRole('button', { name: 'Accept Swap' }));
  expect(
    await screen.findByText('You no longer have permission to perform this action.'),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept Swap' })).toBeTruthy();
  expect(screen.queryByText('Synthetic private detail')).toBeNull();
});

it('keeps requests in a loading state rather than announcing an empty result', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listShiftRequests).mockImplementation(
    () => new Promise(() => {}),
  );
  mount('requests');
  await waitFor(() => expect(screen.getByText('Loading shift requests...')).toBeTruthy());
  expect(screen.queryByText('No Requests Filed')).toBeNull();
});

it('maps the stable past-date code to English and never renders arbitrary server text', () => {
  expect(
    schedulingError(
      new ApiError('http', 'Thông báo riêng', 409, {
        success: false,
        statusCode: 409,
        code: 'SHIFT_WORK_DATE_PASSED',
        message: 'Thông báo riêng',
        requestId: 'test',
        timestamp: '2030-01-01T00:00:00Z',
        path: '/test',
      }),
    ),
  ).toBe("This shift's work date has passed. Changes are no longer allowed.");
});
