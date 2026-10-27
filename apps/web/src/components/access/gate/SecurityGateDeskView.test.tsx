// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { SecurityGateDeskView } from './SecurityGateDeskView';

const cameraMock = vi.hoisted(() => ({ active: false, failed: false }));
vi.mock('./QrScannerView', () => ({ QrScannerView: () => null }));
vi.mock('../enrollment/gateCameraReadiness', () => ({ inspectGateCamera: () => null }));
vi.mock('../enrollment/faceGateUtils', async () => ({
  ...(await vi.importActual<typeof import('../enrollment/faceGateUtils')>(
    '../enrollment/faceGateUtils',
  )),
  captureFrameBlob: async () => new Blob(['synthetic'], { type: 'image/jpeg' }),
  createSafePreviewUrl: () => undefined,
}));

vi.mock('../enrollment/gateCameraSession', () => ({
  GateCameraSession: class {
    constructor(
      private options: {
        ready: (devices: MediaDeviceInfo[], id: string) => void;
        failed: (message: string) => void;
      },
    ) {}
    async start() {
      if (cameraMock.failed) this.options.failed('Synthetic camera unavailable');
      if (cameraMock.active) this.options.ready([], 'synthetic-camera');
    }
    stop() {}
  },
}));
let queries: QueryClient;
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
  cameraMock.active = false;
  cameraMock.failed = false;
});

it('accepts the Worker short manual code without asking Worker to enter an officer session', async () => {
  cameraMock.failed = true;
  const workers = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listWorkers')
    .mockResolvedValue({ items: [], total: 0 });
  const manual = vi.spyOn(SmartSiteManagementClient.prototype, 'manuallyVerifyWorker');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'openCameraQrFallback').mockResolvedValue({
    id: 'internal-session-id',
    siteId: 'site-1',
    gateId: 'gate-north-01',
    direction: 'IN',
    expiresAt: '2030-01-01T00:05:00Z',
  });
  const verify = vi
    .spyOn(SmartSiteManagementClient.prototype, 'verifyWorkerQr')
    .mockRejectedValue(new Error('Synthetic verification stop'));
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <SecurityGateDeskView
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        sessionScope="test"
        selectedSiteId="site-1"
        sites={[{ id: 'site-1', name: 'Synthetic site' }]}
        onSelectSite={() => {}}
        isSecurityOfficer
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Camera Error · Use Fallback QR' }));
  const input = await screen.findByLabelText('Worker QR Code or Token');
  expect(screen.queryByText('Security Manual Verification')).toBeNull();
  expect(screen.queryByLabelText('Worker profile')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Verify Worker manually' })).toBeNull();
  expect(workers).not.toHaveBeenCalled();
  expect(manual).not.toHaveBeenCalled();
  expect(screen.queryByText('internal-session-id')).toBeNull();
  expect(screen.queryByText(/Provide this session code/)).toBeNull();
  fireEvent.change(input, { target: { value: 'ABCD2345' } });
  fireEvent.click(screen.getByRole('button', { name: /Confirm.*QR/ }));
  await waitFor(() =>
    expect(verify).toHaveBeenCalledWith('synthetic-token', 'site-1', 'gate-north-01', {
      token: 'ABCD2345',
      direction: 'IN',
      fallbackSessionId: 'internal-session-id',
      requestId: expect.any(String),
    }),
  );
});

const automaticFaceOutcomes = [
  'recorded',
  'response-lost',
  'repeated-scan',
  'schedule-removed',
  'no-schedule',
  'documents-invalid',
] as const;
it.each(automaticFaceOutcomes)(
  'handles automatic Face outcome %s without adding another passage',
  async (outcome) => {
    const denied = outcome === 'no-schedule' || outcome === 'documents-invalid';
    cameraMock.active = true;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
      items: [],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'observeGateFace')
      .mockResolvedValueOnce({
        state: 'NEW_FACE',
        reasonCode: 'FACE_PRESENCE_NEW',
      })
      .mockResolvedValue({ state: 'SAME_FACE', reasonCode: 'FACE_PRESENCE_SAME' });
    vi.spyOn(SmartSiteManagementClient.prototype, 'verifyFaceGate').mockResolvedValue({
      attempt: {
        id: 'attempt-face',
        status: denied ? 'DENIED' : 'READY',
        scheduleStatus: outcome === 'no-schedule' ? 'NO_SCHEDULE' : 'SCHEDULED',
        expiresAt: '2030-01-01T00:05:00Z',
      },
      worker: {
        id: 'worker-1',
        userId: 'user-1',
        username: 'synthetic',
        externalId: 'W1',
        displayName: 'Synthetic worker',
        contractorName: 'Synthetic contractor',
        assignmentStatus: 'APPROVED',
      },
      decision: {
        technicalOutcome: 'MATCHED',
        authorization: denied ? 'DENIED' : 'ALLOWED',
        reasonCode:
          outcome === 'documents-invalid'
            ? 'WORKER_DOCUMENTS_INVALID'
            : outcome === 'no-schedule'
              ? 'NO_SCHEDULE'
              : 'VALID_ASSIGNMENT',
        qrFallbackAllowed: false,
      },
    });
    const confirm = vi.spyOn(SmartSiteManagementClient.prototype, 'confirmGatePassage');
    if (outcome === 'schedule-removed')
      confirm.mockRejectedValueOnce(
        new ApiError(
          'http',
          'Worker has no assigned shift for this workday. Entry is denied.',
          409,
          {
            success: false,
            statusCode: 409,
            code: 'WORKER_NO_SCHEDULE',
            message: 'Worker has no assigned shift for this workday. Entry is denied.',
            requestId: 'synthetic-request',
            timestamp: '2030-01-01T00:00:00Z',
            path: '/api/v1/sites/site-1/access-attempts/attempt-face/confirm',
          },
        ),
      );
    if (outcome === 'response-lost')
      confirm.mockRejectedValueOnce(new ApiError('network', 'Synthetic lost response'));
    if (outcome === 'repeated-scan')
      confirm.mockRejectedValueOnce(
        new ApiError('http', 'Already checked in. No new attendance was recorded.', 409, {
          success: false,
          statusCode: 409,
          code: 'GATE_PASSAGE_ALREADY_RECORDED',
          message: 'Already checked in. No new attendance was recorded.',
          requestId: 'synthetic-request',
          timestamp: '2030-01-01T00:00:00Z',
          path: '/api/v1/sites/site-1/access-attempts/attempt-face/confirm',
        }),
      );
    confirm.mockResolvedValueOnce({
      id: 'event-face',
      accessAttemptId: 'attempt-face',
      siteId: 'site-1',
      workerId: 'worker-1',
      visitId: null,
      direction: 'IN',
      occurredAt: '2030-01-01T00:00:00Z',
      gateName: 'gate-north-01',
    });
    queries = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queries}>
        <SecurityGateDeskView
          apiUrl="https://synthetic.test"
          token="synthetic-token"
          sessionScope="test"
          selectedSiteId="site-1"
          sites={[{ id: 'site-1', name: 'Synthetic site' }]}
          onSelectSite={() => {}}
        />
      </QueryClientProvider>,
    );
    if (outcome === 'documents-invalid') {
      const message = await screen.findByText(
        /Worker documents are incomplete, unapproved or expired/,
        {},
        { timeout: 3000 },
      );
      expect(message.tagName).toBe('P');
      expect(screen.getByText('Access Denied')).toBeTruthy();
      expect(screen.queryByText(/Access denied by backend policy/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Confirm actual passage' })).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
      return;
    }
    if (outcome === 'no-schedule') {
      expect(
        await screen.findByText(
          'You have not been assigned a work shift for today.',
          {},
          { timeout: 3000 },
        ),
      ).toBeTruthy();
      expect(screen.getByText('Access Denied')).toBeTruthy();
      expect(screen.queryByText(/Decision code:/)).toBeNull();
      expect(screen.queryByText(/Access denied by backend policy/)).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
      return;
    }
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
    if (outcome === 'schedule-removed') {
      expect(
        (await screen.findAllByText('You have not been assigned a work shift for today.')).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/Decision code:/)).toBeNull();
      expect(screen.queryByText(/Access denied by backend policy/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Confirm actual passage' })).toBeNull();
      expect(confirm).toHaveBeenCalledTimes(1);
      return;
    }
    if (outcome === 'repeated-scan') {
      expect(await screen.findByRole('button', { name: 'Dismiss repeated scan' })).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Confirm actual passage' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(confirm).toHaveBeenCalledTimes(1);
      return;
    }
    if (outcome === 'recorded') {
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Confirm actual passage' })).toBeNull(),
      );
      return;
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm actual passage' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[0]![3].idempotencyKey).toBe(confirm.mock.calls[1]![3].idempotencyKey);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Confirm actual passage' })).toBeNull(),
    );
  },
);

it('treats a repeated scan as already recorded and requires a separate-passage confirmation', async () => {
  cameraMock.active = true;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'observeGateFace')
    .mockResolvedValueOnce({ state: 'NEW_FACE', reasonCode: 'FACE_PRESENCE_NEW' })
    .mockResolvedValue({ state: 'SAME_FACE', reasonCode: 'FACE_PRESENCE_SAME' });
  vi.spyOn(SmartSiteManagementClient.prototype, 'verifyFaceGate').mockResolvedValue({
    attempt: {
      id: 'attempt-1',
      status: 'READY',
      scheduleStatus: 'SCHEDULED',
      expiresAt: '2030-01-01T00:05:00Z',
    },
    worker: {
      id: 'worker-1',
      userId: 'user-1',
      username: 'synthetic',
      externalId: 'W1',
      displayName: 'Synthetic worker',
      contractorName: 'Synthetic contractor',
      assignmentStatus: 'APPROVED',
    },
    decision: {
      technicalOutcome: 'MATCHED',
      authorization: 'ALLOWED',
      reasonCode: 'VALID_ASSIGNMENT',
      qrFallbackAllowed: false,
    },
  });
  const confirm = vi.spyOn(SmartSiteManagementClient.prototype, 'confirmGatePassage');
  confirm.mockRejectedValueOnce(
    new ApiError('http', 'Already checked in. No new attendance was recorded.', 409, {
      success: false,
      statusCode: 409,
      code: 'GATE_PASSAGE_ALREADY_RECORDED',
      message: 'Already checked in. No new attendance was recorded.',
      requestId: 'synthetic-request',
      timestamp: '2030-01-01T00:00:00Z',
      path: '/api/v1/sites/site-1/access-attempts/attempt-1/confirm',
    }),
  );
  confirm.mockResolvedValueOnce({
    id: 'event-1',
    accessAttemptId: 'attempt-1',
    siteId: 'site-1',
    workerId: 'worker-1',
    visitId: null,
    direction: 'IN',
    occurredAt: '2030-01-01T00:00:00Z',
    gateName: 'gate-north-01',
  });
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <SecurityGateDeskView
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        sessionScope="test"
        selectedSiteId="site-1"
        sites={[{ id: 'site-1', name: 'Synthetic site' }]}
        onSelectSite={() => {}}
        isSecurityOfficer
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), { timeout: 3000 });
  const separate = await screen.findByRole('checkbox', { name: /separate physical passage/ });
  expect(
    (screen.getByRole('button', { name: 'Confirm actual passage' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(confirm.mock.calls[0]![3].separatePassage).toBeUndefined();
  fireEvent.click(separate);
  expect(
    (screen.getByRole('button', { name: 'Confirm actual passage' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText(/Security review reason/), {
    target: { value: 'Confirmed a distinct passage with missing prior exit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm actual passage' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
  expect(confirm.mock.calls[1]![3]).toMatchObject({
    separatePassage: true,
    reviewNote: 'Confirmed a distinct passage with missing prior exit',
  });
  expect(confirm.mock.calls[1]![3].idempotencyKey).toBe(confirm.mock.calls[0]![3].idempotencyKey);
});
