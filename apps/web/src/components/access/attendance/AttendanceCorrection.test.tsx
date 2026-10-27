// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AttendanceView } from './AttendanceView';

const api = vi.hoisted(() => ({
  attendanceOverview: vi.fn(),
  reviewAttendanceCorrection: vi.fn(),
  requestAttendanceCorrection: vi.fn(),
}));
vi.mock('@smartsite/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smartsite/api-client')>()),
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
vi.mock('./AttendanceDaysView', () => ({ AttendanceDaysView: () => null }));
vi.mock('./WorkerAttendanceSummary', () => ({ WorkerAttendanceSummary: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const session = {
  id: 'session-1',
  workerName: 'Synthetic Worker',
  effectiveInAt: '2030-10-08T01:00:00Z',
  effectiveOutAt: '2030-10-08T10:00:00Z',
  status: 'MATCHED',
  version: 1,
};
const pending = {
  id: 'correction-1',
  attendanceSessionId: session.id,
  workerName: session.workerName,
  proposedInAt: session.effectiveInAt,
  proposedOutAt: session.effectiveOutAt,
  reason: 'Fix missed checkout',
  status: 'PENDING',
  reviewNote: null,
};
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <AttendanceView
        apiUrl="https://synthetic.test"
        token="token"
        siteId="site"
        sessionScope="session"
      />
    </QueryClientProvider>,
  );
}
it('labels missing checkout sessions in the correction selector without marking matched sessions', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: true,
    canReviewCorrection: false,
    sessions: [
      session,
      { ...session, id: 'open-session', effectiveOutAt: null, status: 'OPEN' },
      { ...session, id: 'missing-entry', effectiveInAt: null, status: 'MISSING_IN' },
    ],
    corrections: [],
  });
  mount();
  const missingOut = await screen.findByRole('option', { name: /Missing check-out/ });
  expect((missingOut as HTMLOptionElement).value).toBe('open-session');
  expect(screen.getByRole('option', { name: /Exit .*Missing check-in/ })).toBeTruthy();
  const selector = screen.getByLabelText('Session') as HTMLSelectElement;
  expect(
    Array.from(selector.options).find((option) => option.value === session.id)?.text,
  ).not.toContain('Missing check-out');
  fireEvent.change(selector, { target: { value: 'open-session' } });
  expect((screen.getByLabelText('Proposed in hour') as HTMLSelectElement).value).not.toBe('');
  expect((screen.getByLabelText('Proposed out hour') as HTMLSelectElement).value).toBe('');
});
it('uses minute-only 24-hour controls and preserves seconds on the untouched recorded entry', async () => {
  const recordedIn = '2030-10-08T01:00:37.456Z';
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: true,
    canReviewCorrection: false,
    sessions: [{ ...session, effectiveInAt: recordedIn, effectiveOutAt: null, status: 'OPEN' }],
    corrections: [],
  });
  api.requestAttendanceCorrection.mockResolvedValue({ id: 'new-correction' });
  mount();
  await screen.findByRole('option', { name: /Missing check-out/ });
  fireEvent.change(screen.getByLabelText('Session'), { target: { value: session.id } });
  expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  expect(screen.getByLabelText('Proposed out hour').querySelectorAll('option')).toHaveLength(25);
  expect(screen.getByLabelText('Proposed out minute').querySelectorAll('option')).toHaveLength(60);
  fireEvent.change(screen.getByLabelText('Proposed out hour'), { target: { value: '17' } });
  fireEvent.change(screen.getByLabelText('Proposed out minute'), { target: { value: '05' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Forgot checkout' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send to Contractor Representative' }));
  await waitFor(() => expect(api.requestAttendanceCorrection).toHaveBeenCalled());
  const payload = api.requestAttendanceCorrection.mock.calls.at(-1)![3];
  expect(payload.proposedInAt).toBe(recordedIn);
  const out = new Date(payload.proposedOutAt);
  expect(out.getHours()).toBe(17);
  expect(out.getMinutes()).toBe(5);
  expect(out.getSeconds()).toBe(0);
  expect(out.getMilliseconds()).toBe(0);
  // Selecting another session must reset the local picker state instead of keeping the prior time.
  fireEvent.change(screen.getByLabelText('Session'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Session'), { target: { value: session.id } });
  expect((screen.getByLabelText('Proposed out hour') as HTMLSelectElement).value).toBe('');
});
it('blocks another submission even when the pending correction is outside the day filter', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: true,
    canReviewCorrection: false,
    hasPendingCorrection: true,
    sessions: [session],
    corrections: [],
  });
  mount();
  expect(await screen.findByText(/Your attendance correction is awaiting/)).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Send to Contractor Representative' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((screen.getByLabelText('Session') as HTMLSelectElement).matches(':disabled')).toBe(true);
  expect(api.requestAttendanceCorrection).not.toHaveBeenCalled();
});
it('shows recorded and proposed details, approves without a note, and asks for a reason only on rejection', async () => {
  api.attendanceOverview.mockResolvedValue({
    canRequestCorrection: false,
    canReviewCorrection: true,
    sessions: [session],
    corrections: [pending],
  });
  api.reviewAttendanceCorrection.mockResolvedValue({ id: pending.id });
  mount();
  await screen.findByText(/Recorded interval:/);
  expect(screen.getByText(/Proposed interval:/)).toBeTruthy();
  expect(screen.queryByLabelText('Rejection reason')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Approve correction' }));
  await waitFor(() =>
    expect(api.reviewAttendanceCorrection).toHaveBeenCalledWith('token', 'site', pending.id, {
      approve: true,
    }),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Reject correction' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reject correction' }));
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
