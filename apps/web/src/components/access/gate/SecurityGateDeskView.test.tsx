// @vitest-environment jsdom
import { beforeEach } from 'vitest';
import { mockGateCatalog } from '../test-gate-catalog';
beforeEach(mockGateCatalog);
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderSourceDesk() {
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [],
  });
  return render(
    <QueryClientProvider client={queries}>
      <SecurityGateDeskView
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        sessionScope="test"
        selectedSiteId="site-1"
        sites={[{ id: 'site-1', name: 'Synthetic Site' }]}
        onSelectSite={() => {}}
        isSecurityOfficer
      />
    </QueryClientProvider>,
  );
}

it('automatically scans the local webcam without registered Gate cameras', async () => {
  cameraMock.active = true;
  const sources = vi.spyOn(SmartSiteManagementClient.prototype, 'listGateSources');
  vi.spyOn(SmartSiteManagementClient.prototype, 'observeGateFace').mockResolvedValue({
    state: 'NEW_FACE',
    reasonCode: 'FACE_PRESENCE_NEW',
  });
  const verify = vi
    .spyOn(SmartSiteManagementClient.prototype, 'verifyFaceGate')
    .mockRejectedValue(new Error('Synthetic unavailable'));
  renderSourceDesk();
  await waitFor(() => expect(verify).toHaveBeenCalled(), { timeout: 5000 });
  expect(screen.queryByLabelText('Registered Gate camera')).toBeNull();
  expect(sources).not.toHaveBeenCalled();
  expect(verify.mock.calls[0]?.[5]).toBeUndefined();
});
it('ignores pending webcam presence after changing the Gate', async () => {
  cameraMock.active = true;
  const pending = deferred<Awaited<ReturnType<SmartSiteManagementClient['observeGateFace']>>>();
  const presence = vi
    .spyOn(SmartSiteManagementClient.prototype, 'observeGateFace')
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ state: 'SAME_FACE', reasonCode: 'FACE_PRESENCE_SAME' });
  const verify = vi.spyOn(SmartSiteManagementClient.prototype, 'verifyFaceGate');
  renderSourceDesk();
  await waitFor(() => expect(presence).toHaveBeenCalled(), { timeout: 5000 });
  changeGateContext('gate');
  await act(async () => pending.resolve({ state: 'NEW_FACE', reasonCode: 'FACE_PRESENCE_NEW' }));
  expect(verify).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function renderQrDesk() {
  cameraMock.failed = true;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [],
  });
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
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
}

function changeGateContext(kind: 'gate' | 'direction') {
  if (kind === 'direction')
    fireEvent.click(screen.getByRole('button', { name: /OUT.*Check.?Out/i }));
  else {
    const gate = screen.getByLabelText('Access Gate') as HTMLSelectElement;
    fireEvent.change(gate, { target: { value: gate.options[1]!.value } });
  }
}

const fallbackSession = {
  id: 'session-1',
  siteId: 'site-1',
  gateId: 'a1000000-0000-4000-8000-000000000001',
  direction: 'IN' as const,
  expiresAt: '2030-01-01T00:05:00Z',
};
const qrAllowed: Awaited<ReturnType<SmartSiteManagementClient['verifyWorkerQr']>> = {
  authorization: 'ALLOWED',
  reasonCode: 'VALID_ASSIGNMENT',
  attempt: {
    id: 'qr-attempt-1',
    status: 'READY',
    scheduleStatus: 'SCHEDULED',
    expiresAt: '2030-01-01T00:05:00Z',
  },
  worker: {
    id: 'worker-1',
    userId: 'user-1',
    username: 'synthetic',
    externalId: 'W1',
    displayName: 'Old QR worker',
    contractorName: 'Synthetic contractor',
    assignmentStatus: 'APPROVED',
  },
  log: {
    id: 'qr-log',
    createdAt: '2030-01-01T00:00:00Z',
    gateId: 'a1000000-0000-4000-8000-000000000001',
    direction: 'IN',
    method: 'QR',
    workerId: 'worker-1',
    userId: 'user-1',
    workerName: 'Old QR worker',
    workerExternalId: 'W1',
    contractorName: 'Synthetic contractor',
    username: 'synthetic',
    decision: { authorization: 'ALLOWED', reasonCode: 'VALID_ASSIGNMENT' },
  },
};

async function submitQr() {
  fireEvent.click(await screen.findByRole('button', { name: 'Camera Error · Use Fallback QR' }));
  fireEvent.change(await screen.findByLabelText('Worker QR Code or Token'), {
    target: { value: 'ABCD2345' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Confirm.*QR/ }));
}

it.each(['gate', 'direction'] as const)(
  'ignores a pending fallback after changing %s and allows a fresh session',
  async (kind) => {
    const pending = deferred<typeof fallbackSession>();
    const opened = vi
      .spyOn(SmartSiteManagementClient.prototype, 'openCameraQrFallback')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ...fallbackSession, id: 'new-session' });
    renderQrDesk();
    fireEvent.click(await screen.findByRole('button', { name: 'Camera Error · Use Fallback QR' }));
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    changeGateContext(kind);
    await act(async () => pending.resolve(fallbackSession));
    expect(screen.queryByLabelText('Worker QR Code or Token')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Camera Error · Use Fallback QR' }));
    expect(await screen.findByLabelText('Worker QR Code or Token')).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(2);
    const call = opened.mock.calls[1]!;
    if (kind === 'direction') expect(call[3]).toBe('OUT');
    else expect(call[2]).not.toBe(fallbackSession.gateId);
  },
);

it.each(['gate', 'direction'] as const)(
  'ignores a pending QR decision after changing %s',
  async (kind) => {
    const pending = deferred<typeof qrAllowed>();
    vi.spyOn(SmartSiteManagementClient.prototype, 'openCameraQrFallback').mockResolvedValue(
      fallbackSession,
    );
    const verify = vi
      .spyOn(SmartSiteManagementClient.prototype, 'verifyWorkerQr')
      .mockReturnValue(pending.promise);
    renderQrDesk();
    await submitQr();
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    changeGateContext(kind);
    await act(async () => pending.resolve(qrAllowed));
    expect(screen.queryByText(/Old QR worker/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm actual passage' })).toBeNull();
  },
);

it.each(['success', 'error'] as const)(
  'ignores a late passage %s after the direction changes',
  async (outcome) => {
    const pending =
      deferred<Awaited<ReturnType<SmartSiteManagementClient['confirmGatePassage']>>>();
    vi.spyOn(SmartSiteManagementClient.prototype, 'openCameraQrFallback').mockResolvedValue(
      fallbackSession,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'verifyWorkerQr').mockResolvedValue(qrAllowed);
    const confirm = vi
      .spyOn(SmartSiteManagementClient.prototype, 'confirmGatePassage')
      .mockReturnValue(pending.promise);
    renderQrDesk();
    await submitQr();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm actual passage' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    changeGateContext('direction');
    await act(async () => {
      if (outcome === 'success')
        pending.resolve({
          id: 'old-event',
          accessAttemptId: 'qr-attempt-1',
          siteId: 'site-1',
          workerId: 'worker-1',
          visitId: null,
          direction: 'IN',
          occurredAt: '2030-01-01T00:00:00Z',
          gateName: 'a1000000-0000-4000-8000-000000000001',
        });
      else
        pending.reject(
          new ApiError('http', 'Old passage failure', 409, {
            success: false,
            statusCode: 409,
            code: 'WORKER_NO_SCHEDULE',
            message: 'Old passage failure',
            requestId: 'synthetic-request',
            timestamp: '2030-01-01T00:00:00Z',
            path: '/api/v1/sites/site-1/access-attempts/qr-attempt-1/confirm',
          }),
        );
    });
    expect(screen.queryByText(/Actual passage recorded/i)).toBeNull();
    expect(screen.queryByText(/Old passage failure/)).toBeNull();
    expect(screen.queryByText(/Old QR worker/)).toBeNull();
    expect(screen.queryByText(/Worker has no assigned shift for this workday/)).toBeNull();
  },
);

it('ignores an old QR fallback response after the selected Site changes', async () => {
  cameraMock.failed = true;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [],
  });
  let finish!: (
    value: Awaited<ReturnType<SmartSiteManagementClient['openCameraQrFallback']>>,
  ) => void;
  const opened = vi
    .spyOn(SmartSiteManagementClient.prototype, 'openCameraQrFallback')
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = (site: string) => (
    <QueryClientProvider client={queries}>
      <SecurityGateDeskView
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        sessionScope="test"
        selectedSiteId={site}
        sites={[
          { id: 'site-1', name: 'First Site' },
          { id: 'site-2', name: 'Second Site' },
        ]}
        onSelectSite={() => {}}
        isSecurityOfficer
      />
    </QueryClientProvider>
  );
  const ui = render(view('site-1'));
  fireEvent.click(await screen.findByRole('button', { name: 'Camera Error · Use Fallback QR' }));
  await waitFor(() => expect(opened).toHaveBeenCalled());
  ui.rerender(view('site-2'));
  await act(async () => {
    finish({
      id: 'old-site-session',
      siteId: 'site-1',
      gateId: 'a1000000-0000-4000-8000-000000000001',
      direction: 'IN',
      expiresAt: '2030-01-01T00:05:00Z',
    });
  });
  expect((screen.getByLabelText('Active Site') as HTMLSelectElement).value).toBe('site-2');
  expect(screen.queryByLabelText('Worker QR Code or Token')).toBeNull();
});
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
  cameraMock.active = false;
  cameraMock.failed = false;
});

it('shows the saved denial reason in gate history', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'listGateAccessLogs').mockResolvedValue({
    items: [
      {
        id: 'denied-log',
        createdAt: '2026-10-27T09:57:53Z',
        gateId: 'a1000000-0000-4000-8000-000000000001',
        direction: 'IN',
        method: 'QR',
        workerId: 'worker-1',
        userId: null,
        workerName: 'Synthetic worker',
        workerExternalId: 'W1',
        contractorName: null,
        username: null,
        decision: { authorization: 'DENIED', reasonCode: 'ASSIGNMENT_MISSING' },
      },
    ],
  });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  expect(await screen.findByText('Worker does not have an approved site assignment.')).toBeTruthy();
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
    gateId: 'a1000000-0000-4000-8000-000000000001',
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
    expect(verify).toHaveBeenCalledWith(
      'synthetic-token',
      'site-1',
      'a1000000-0000-4000-8000-000000000001',
      {
        token: 'ABCD2345',
        direction: 'IN',
        fallbackSessionId: 'internal-session-id',
        requestId: expect.any(String),
      },
    ),
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
        assignmentStatus: 'MISSING',
        ...{ scheduleStatus: outcome === 'no-schedule' ? 'NO_SCHEDULE' : 'SCHEDULED' },
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
      gateName: 'a1000000-0000-4000-8000-000000000001',
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
      expect(await screen.findByText('No schedule')).toBeTruthy();
      expect(screen.queryByText('Scheduled')).toBeNull();
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
      expect(await screen.findByText('Scheduled')).toBeTruthy();
      expect(screen.queryByText(/^Site Assignment/)).toBeNull();
      expect(screen.queryByText('Missing')).toBeNull();
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
    gateName: 'a1000000-0000-4000-8000-000000000001',
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
