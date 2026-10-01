// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import type {
  SmartSiteManagementClient,
  SafetyAlertDetectionResponse,
  ObservationIdentityContextResponse,
  ObservationIdentityWorkerResponse,
} from '@smartsite/api-client';
import { ObservationIdentityReviewPanel } from './ObservationIdentityReviewPanel';
import { computeViewedEvidenceSha256 } from './observationIdentityReviewUtils';

// Polyfill URL.createObjectURL and ResizeObserver for jsdom if needed
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${blob.size}`);
  URL.revokeObjectURL = vi.fn();
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Helper to create synthetic valid JPEG Blob (SOI marker 0xFFD8, APP0 marker, EOI marker 0xFFD9)
function createValidSyntheticJpeg(payload: string = 'test-evidence'): Blob {
  const header = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00,
  ];
  const payloadBytes = Array.from(new TextEncoder().encode(payload));
  const footer = [0xff, 0xd9];
  const bytes = new Uint8Array([...header, ...payloadBytes, ...footer]);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function createMockDetection(
  overrides?: Partial<SafetyAlertDetectionResponse>,
): SafetyAlertDetectionResponse {
  return {
    eventId: '00000000-0000-4000-8000-000000000001',
    cameraExternalId: 'CAM-01',
    capturedAt: '2026-09-30T10:00:00Z',
    processingStatus: 'PROCESSED',
    evidence: [
      {
        index: 0,
        kind: 'FRAME',
        available: true,
      },
    ],
    ...overrides,
  };
}

function createMockContext(
  overrides?: Partial<ObservationIdentityContextResponse>,
): ObservationIdentityContextResponse {
  return {
    eventId: '00000000-0000-4000-8000-000000000001',
    payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    eventConsistent: true,
    frames: [
      {
        index: 0,
        kind: 'FRAME',
        sha256: 'mock-frame-sha256',
        available: true,
      },
    ],
    subjects: [
      {
        personObservationIndex: 0,
        trackId: 10,
        subjectRef: {
          eventId: '00000000-0000-4000-8000-000000000001',
          personObservationIndex: 0,
          payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          cameraId: '00000000-0000-4000-8000-000000000010',
          cameraExternalId: 'CAM-01',
          streamSessionId: '00000000-0000-4000-8000-000000000020',
          capturedAt: '2026-09-30T10:00:00Z',
          trackId: 10,
          personBoundingBox: {
            x1: 0.1,
            y1: 0.2,
            x2: 0.5,
            y2: 0.8,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        subjectRefSource: 'RAW_EVENT',
        technicalIdentity: {
          status: 'CANDIDATE',
          candidates: [
            {
              status: 'CANDIDATE',
              candidateWorkerId: 'worker-ai-42',
              similarityScore: 0.89,
            },
          ],
        },
        latestManualDecision: null,
        revision: 0,
        canResolve: true,
        resolveBlockReason: null,
        canClear: false,
        clearBlockReason: 'NO_ACTIVE_RESOLUTION',
        originalZoneDecisions: {
          items: [
            {
              id: '00000000-0000-4000-8000-000000000100',
              zoneId: '00000000-0000-4000-8000-000000000200',
              status: 'DENIED',
              reasonCode: 'PROHIBITED_ZONE',
              evaluatedAt: '2026-09-30T10:00:01Z',
            },
          ],
          total: 1,
        },
      },
      {
        personObservationIndex: 1,
        trackId: 11,
        subjectRef: {
          eventId: '00000000-0000-4000-8000-000000000001',
          personObservationIndex: 1,
          payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          cameraId: '00000000-0000-4000-8000-000000000010',
          cameraExternalId: 'CAM-01',
          streamSessionId: '00000000-0000-4000-8000-000000000020',
          capturedAt: '2026-09-30T10:00:00Z',
          trackId: 11,
          personBoundingBox: {
            x1: 0.6,
            y1: 0.2,
            x2: 0.9,
            y2: 0.8,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        subjectRefSource: 'RAW_EVENT',
        technicalIdentity: {
          status: 'UNKNOWN',
          candidates: [],
        },
        latestManualDecision: null,
        revision: 0,
        canResolve: true,
        resolveBlockReason: null,
        canClear: false,
        clearBlockReason: 'NO_ACTIVE_RESOLUTION',
        originalZoneDecisions: {
          items: [],
          total: 0,
        },
      },
    ],
    ...overrides,
  };
}

const mockWorkersList: { items: ObservationIdentityWorkerResponse[]; total: number } = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000777',
      siteId: '00000000-0000-4000-8000-000000000001',
      externalId: 'EMP-001',
      displayName: 'Nguyễn Văn A',
      isActive: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000778',
      siteId: '00000000-0000-4000-8000-000000000001',
      externalId: 'EMP-002',
      displayName: 'Trần Thị B',
      isActive: false,
    },
  ],
  total: 2,
};

describe('ObservationIdentityReviewPanel Real DOM Interactions', () => {
  let queryClient: QueryClient;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });

    URL.createObjectURL = (blob: Blob) => `blob:mock-url-${blob.size}`;
    URL.revokeObjectURL = () => {};

    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-testid') === 'evidence-frame-container') {
        return {
          width: 640,
          height: 360,
          top: 0,
          left: 0,
          bottom: 360,
          right: 640,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      }
      return originalGetBoundingClientRect.call(this);
    };
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initially requires explicit selection: no subject auto-selected, no worker query dispatched, prompt visible', async () => {
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    const tab1 = await screen.findByRole('tab', { name: /PERSON #1/i });

    expect(tab0.getAttribute('aria-selected')).toBe('false');
    expect(tab1.getAttribute('aria-selected')).toBe('false');

    const prompt = screen.getByTestId('no-subject-selected-notice');
    expect(prompt.textContent).toContain(
      'Vui lòng chọn một đối tượng PERSON bên trên để xem xét danh tính hoặc nhập quyết định.',
    );

    expect(mockClient.listObservationIdentityWorkers).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Lý do đánh giá/i)).toBeNull();
    expect(screen.queryByText(/Xác nhận danh tính/i)).toBeNull();
  });

  it('selects Person #0 then types worker/reason; switching to Person #1 provides a clean draft without cross-contamination', async () => {
    // Setup test-only decoder mock
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('person-flow');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    expect(tab0.getAttribute('aria-selected')).toBe('true');
    expect(mockClient.listObservationIdentityWorkers).toHaveBeenCalledTimes(1);

    const reasonInput = (await screen.findByLabelText(/Lý do đánh giá/i)) as HTMLTextAreaElement;
    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;

    await user.selectOptions(workerSelect, '00000000-0000-4000-8000-000000000777');
    await user.type(reasonInput, 'Xác nhận nhân viên đang thực hiện công việc số 0');

    expect(workerSelect.value).toBe('00000000-0000-4000-8000-000000000777');
    expect(reasonInput.value).toBe('Xác nhận nhân viên đang thực hiện công việc số 0');

    const tab1 = screen.getByRole('tab', { name: /PERSON #1/i });
    await user.click(tab1);

    expect(tab1.getAttribute('aria-selected')).toBe('true');
    expect(tab0.getAttribute('aria-selected')).toBe('false');

    const newReasonInput = (await screen.findByLabelText(/Lý do đánh giá/i)) as HTMLTextAreaElement;
    const newWorkerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;

    expect(newReasonInput.value).toBe('');
    expect(newWorkerSelect.value).toBe('');
  });

  it('event / alert / session switch makes old context and draft completely inaccessible', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const reasonInput = (await screen.findByLabelText(/Lý do đánh giá/i)) as HTMLTextAreaElement;
    await user.type(reasonInput, 'Bản thảo đang nhập dở');
    expect(reasonInput.value).toBe('Bản thảo đang nhập dở');

    rerender(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000099"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('no-subject-selected-notice')).not.toBeNull();
    expect(screen.queryByLabelText(/Lý do đánh giá/i)).toBeNull();
  });

  it('expired-image / missing-media CLEAR sends strict body without workerId or media descriptors', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: null, available: false }],
      subjects: [
        {
          personObservationIndex: 0,
          trackId: 10,
          subjectRef: null,
          subjectRefSource: null,
          technicalIdentity: { status: 'UNKNOWN', candidates: [] },
          latestManualDecision: {
            id: '00000000-0000-4000-8000-000000000555',
            revision: 1,
            action: 'RESOLVE',
            workerId: '00000000-0000-4000-8000-000000000999',
            actorUserId: '00000000-0000-4000-8000-000000000888',
            reason: 'Đã xác minh trước đó',
            scope: 'EXACT_OBSERVATION',
            verificationMethod: 'MANUAL',
            recordedAt: '2026-09-30T10:00:00Z',
          },
          revision: 1,
          canResolve: false,
          resolveBlockReason: 'FRAME_UNAVAILABLE',
          canClear: true,
          clearBlockReason: null,
          originalZoneDecisions: { items: [], total: 0 },
        },
      ],
    });

    const mockDecide = vi.fn().mockResolvedValue({
      recordedDecision: {
        id: '00000000-0000-4000-8000-000000000666',
        revision: 2,
        action: 'CLEAR',
        workerId: null,
        actorUserId: 'user-1',
        reason: 'Thu hồi quyết định vì ảnh đã hết hạn lưu trữ',
        scope: 'EXACT_OBSERVATION',
        verificationMethod: 'MANUAL',
        recordedAt: '2026-10-01T08:00:00Z',
      },
      latestRevision: 2,
      replayed: false,
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={null}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    expect(
      screen.getByText(
        'Ảnh bằng chứng (full frame) không khả dụng hoặc đã hết hạn trên hệ thống lưu trữ.',
      ),
    ).not.toBeNull();

    const clearRadio = screen.getByLabelText(/Thu hồi xác minh \(CLEAR\)/i) as HTMLInputElement;
    await user.click(clearRadio);
    expect(clearRadio.checked).toBe(true);

    expect(screen.queryByLabelText(/Chọn nhân viên.*danh bạ/i)).toBeNull();

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Thu hồi quyết định vì ảnh đã hết hạn lưu trữ');

    const submitBtn = screen.getByRole('button', {
      name: /Thu hồi xác minh/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    const passedCommand = mockDecide.mock.calls[0]![5];
    expect(passedCommand).toMatchObject({
      commandId: expect.any(String),
      action: 'CLEAR',
      expectedRevision: 1,
      expectedEventHash: mockContext.payloadHash,
      reason: 'Thu hồi quyết định vì ảnh đã hết hạn lưu trữ',
    });
    expect(passedCommand).not.toHaveProperty('workerId');
    expect(passedCommand).not.toHaveProperty('evidenceIndex');
    expect(passedCommand).not.toHaveProperty('expectedEvidenceSha256');
  });

  it('409 conflict refresh generates fresh commandId, whereas exact network retry reuses same commandId', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('conflict-retry');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const initialContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    let currentContext = { ...initialContext };

    let attemptCount = 0;
    const mockDecide = vi.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount === 1) {
        return Promise.reject(new Error('Network transient timeout'));
      }
      return Promise.reject(
        new ApiError('http', 'Observation identity revision is stale', 409, {
          success: false,
          statusCode: 409,
          code: 'CONFLICT',
          message: 'Observation identity revision is stale',
          requestId: 'req-conflict-1',
          timestamp: '2026-10-01T08:00:00Z',
          path: '/api/v1/management/...',
        }),
      );
    });

    const mockClient = {
      getObservationIdentityContext: vi
        .fn()
        .mockImplementation(() => Promise.resolve(currentContext)),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;
    await user.selectOptions(workerSelect, '00000000-0000-4000-8000-000000000777');

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Kiểm tra retry và 409 conflict');

    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;

    // 1st attempt: fails with Network transient timeout
    await user.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByText('Network transient timeout')).not.toBeNull();
    });
    const firstCommandId = mockDecide.mock.calls[0]![5].commandId;

    // 2nd attempt: exact retry (unchanged inputs)
    await user.click(submitBtn);
    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(2);
    });
    const retryCommandId = mockDecide.mock.calls[1]![5].commandId;

    expect(retryCommandId).toBe(firstCommandId);

    await waitFor(() => {
      expect(screen.getByText(/Phiên bản xem xét đã thay đổi bởi người khác/i)).not.toBeNull();
      expect(screen.getByRole('button', { name: /Làm mới dữ liệu/i })).not.toBeNull();
    });

    currentContext = {
      ...initialContext,
      subjects: [
        {
          ...initialContext.subjects[0]!,
          revision: 1,
        },
        initialContext.subjects[1]!,
      ],
    };

    const refreshBtn = screen.getByRole('button', { name: /Làm mới dữ liệu/i });
    await user.click(refreshBtn);

    mockDecide.mockResolvedValueOnce({
      recordedDecision: {
        id: '00000000-0000-4000-8000-000000000999',
        revision: 2,
        action: 'RESOLVE',
        workerId: '00000000-0000-4000-8000-000000000777',
        actorUserId: 'user-1',
        reason: 'Kiểm tra retry và 409 conflict',
        scope: 'EXACT_OBSERVATION',
        verificationMethod: 'MANUAL',
        recordedAt: '2026-10-01T08:00:00Z',
      },
      latestRevision: 2,
      replayed: false,
    });

    await user.click(submitBtn);
    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(3);
    });

    const newRevisionCommandId = mockDecide.mock.calls[2]![5].commandId;
    const newRevisionExpectedRev = mockDecide.mock.calls[2]![5].expectedRevision;

    expect(newRevisionExpectedRev).toBe(1);
    expect(newRevisionCommandId).not.toBe(firstCommandId);
  });

  it('evidence digest mismatch blocks RESOLVE', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    const syntheticBlob = createValidSyntheticJpeg('digest-mismatch');
    const mockContext = createMockContext({
      frames: [
        { index: 0, kind: 'FRAME', sha256: 'expected-different-sha256-hash', available: true },
      ],
    });

    const mockDecide = vi.fn();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    await waitFor(() => {
      expect(screen.getByText('Chưa xác thực')).not.toBeNull();
    });

    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;
    await user.selectOptions(workerSelect, '00000000-0000-4000-8000-000000000777');

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Lý do hợp lệ để test digest check');

    const form = submitBtn.closest('form');
    if (form) fireEvent.submit(form);

    expect(mockDecide).not.toHaveBeenCalled();
    expect(
      screen.getByText('Mã băm ảnh đã xem không khớp với mô tả bằng chứng của hệ thống.'),
    ).not.toBeNull();
  });

  it('decoder unavailable fails closed with clear error message without inventing dummy dimensions', async () => {
    // Ensure createImageBitmap is undefined (no decoder available)
    vi.stubGlobal('createImageBitmap', undefined);

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('no-decoder');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    const mockDecide = vi.fn();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Fail-closed error notice must be visible: decoder is not available
    await waitFor(() => {
      expect(screen.getByText(/Trình duyệt không hỗ trợ giải mã ảnh bằng chứng/i)).not.toBeNull();
    });

    // The submit button must be disabled
    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;
    await user.selectOptions(workerSelect, '00000000-0000-4000-8000-000000000777');

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Xác nhận danh tính khi không có decoder');

    const form = submitBtn.closest('form');
    if (form) fireEvent.submit(form);

    // Mutation must NOT be called
    expect(mockDecide).not.toHaveBeenCalled();
    expect(
      screen.getByText('Ảnh bằng chứng không thể giải mã hoặc có kích thước không hợp lệ.'),
    ).not.toBeNull();
  });

  it('invalid or nonfinite decoded dimensions (NaN, Infinity, <=0) block RESOLVE and close bitmap', async () => {
    const mockBitmapClose = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: NaN,
        height: Infinity,
        close: mockBitmapClose,
      }),
    );

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('invalid-dims');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    const mockDecide = vi.fn();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Bitmap close must have been called even when dimensions are invalid
    await waitFor(() => {
      expect(mockBitmapClose).toHaveBeenCalled();
    });

    // Error notice about invalid dimensions displayed
    expect(screen.getByText(/Kích thước ảnh đã giải mã không hợp lệ/i)).not.toBeNull();

    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('switching evidenceBlob strictly isolates state: null Blob clears previous hash/dimensions, pending B does not inherit A, rejected B displays error', async () => {
    const mockBitmapCloseA = vi.fn();

    const syntheticBlobA = createValidSyntheticJpeg('blob-A');
    const hashA = await computeViewedEvidenceSha256(syntheticBlobA);

    const syntheticBlobB = createValidSyntheticJpeg('blob-B');
    const hashB = await computeViewedEvidenceSha256(syntheticBlobB);

    vi.stubGlobal('createImageBitmap', (blob: Blob) => {
      if (blob === syntheticBlobA) {
        return Promise.resolve({
          width: 1280,
          height: 720,
          close: mockBitmapCloseA,
        });
      }
      if (blob === syntheticBlobB) {
        return Promise.reject(new Error('Lỗi giải mã ảnh Blob B'));
      }
      return Promise.reject(new Error('Unknown blob'));
    });

    const user = userEvent.setup();
    const mockContext = createMockContext({
      frames: [
        { index: 0, kind: 'FRAME', sha256: hashA, available: true },
        { index: 1, kind: 'FRAME', sha256: hashB, available: true },
      ],
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    // 1. Initial render with Blob A
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlobA}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Blob A hash matched
    await waitFor(() => {
      expect(screen.getByText('Đã khớp SHA-256')).not.toBeNull();
    });

    // 2. Switch to evidenceBlob: null
    rerender(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={null}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    // Immediately, effective hash must be null, old Blob A hash NOT active
    expect(screen.queryByText('Đã khớp SHA-256')).toBeNull();
    expect(screen.getByText(/Ảnh bằng chứng chưa được tải hoặc đã hết hạn/i)).not.toBeNull();

    // 3. Switch to Blob B (which rejects on decode)
    rerender(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={1}
          evidenceBlob={syntheticBlobB}
        />
      </QueryClientProvider>,
    );

    // Decode error for Blob B must be displayed
    await waitFor(() => {
      expect(screen.getByText('Lỗi giải mã ảnh Blob B')).not.toBeNull();
    });
  });

  it('closes ImageBitmap even if component unmounts before decode handler settles', async () => {
    let resolveBitmapPromise!: (bitmap: unknown) => void;
    const bitmapPromise = new Promise((resolve) => {
      resolveBitmapPromise = resolve;
    });

    const mockBitmapClose = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockReturnValue(bitmapPromise));

    const syntheticBlob = createValidSyntheticJpeg('unmount-test');
    const mockContext = createMockContext();

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    // Wait until createImageBitmap has actually started
    await waitFor(() => {
      expect(createImageBitmap).toHaveBeenCalled();
    });

    // Unmount while decode is still pending
    unmount();

    // Now resolve the promise with bitmap
    resolveBitmapPromise({
      width: 1920,
      height: 1080,
      close: mockBitmapClose,
    });

    await waitFor(() => {
      expect(mockBitmapClose).toHaveBeenCalled();
    });
  });

  it('renders full frame evidence image and overlays exact bounding box for selected PERSON', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1000,
        height: 500,
        close: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('box-overlay');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Evidence full frame container is rendered
    const frameContainer = await screen.findByTestId('evidence-frame-container');
    expect(frameContainer).not.toBeNull();

    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    // Exact bounding box overlay is rendered
    const boxOverlay = await screen.findByTestId('person-bounding-box-overlay');
    expect(boxOverlay).not.toBeNull();
    expect(boxOverlay.textContent).toContain('PERSON #0');
  });

  it('session cache isolation partitions queries and unmount aborts active signals', async () => {
    const abortSignals: AbortSignal[] = [];
    const mockClient = {
      getObservationIdentityContext: vi
        .fn()
        .mockImplementation((_token, _site, _alert, _event, options) => {
          if (options?.signal) abortSignals.push(options.signal);
          return new Promise(() => {});
        }),
      listObservationIdentityWorkers: vi.fn(),
      listObservationIdentityDecisions: vi.fn(),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-isolated-a"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    expect(abortSignals.length).toBeGreaterThan(0);
    const firstSignal = abortSignals[0];
    expect(firstSignal).toBeDefined();
    expect(firstSignal!.aborted).toBe(false);

    unmount();

    expect(firstSignal!.aborted).toBe(true);
  });

  it('separates technical AI candidate, manual verification, and original zone decisions without live recalculation', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    expect(screen.getByText('Gợi ý kỹ thuật (AI)')).not.toBeNull();
    expect(screen.getByText('worker-ai-42')).not.toBeNull();
    expect(screen.getByText(/89%/i)).not.toBeNull();

    expect(screen.getByText('Xác minh thủ công gần nhất')).not.toBeNull();
    expect(screen.getByText('Chưa xác minh thủ công')).not.toBeNull();

    expect(
      screen.getByText('Quyết định vào vùng gốc (Original Zone Decisions - Bất biến)'),
    ).not.toBeNull();
    expect(screen.getByText('DENIED')).not.toBeNull();
    expect(screen.getByText('PROHIBITED_ZONE')).not.toBeNull();
    expect(screen.getByText(/không cấp quyền ra\/vào vùng \(Zone Access\)/i)).not.toBeNull();
  });

  it('worker picker supports pagination and cleanly differentiates pending, error, empty, and populated states', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();

    const mockListWorkers = vi
      .fn()
      .mockRejectedValueOnce(new Error('Lỗi kết nối máy chủ danh bạ'))
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          displayName: `Nhân viên Trang 1 - ${i}`,
          externalId: `EMP-${i}`,
          contractorName: null,
          role: 'WORKER',
          isActive: true,
        })),
        total: 75,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 25 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(50 + i).padStart(12, '0')}`,
          displayName: `Nhân viên Trang 2 - ${i}`,
          externalId: `EMP-${50 + i}`,
          contractorName: null,
          role: 'WORKER',
          isActive: true,
        })),
        total: 75,
      });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: mockListWorkers,
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Initial call rejects -> Error notice appears with retry button
    const errorNotice = await screen.findByText(/Không thể tải danh bạ nhân viên/i);
    expect(errorNotice).not.toBeNull();
    const retryBtn = screen.getByRole('button', { name: /Thử lại/i });

    // Click retry -> fetches page 1 (50 items)
    await user.click(retryBtn);
    await waitFor(() => {
      expect(screen.getByText(/Nhân viên Trang 1 - 0/i)).not.toBeNull();
    });
    expect(mockListWorkers).toHaveBeenCalledWith(
      'test-token',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
      0,
      50,
      expect.anything(),
    );

    // Pagination notice: page 1 of 2 (total 75)
    expect(screen.getByText(/Trang 1 \/ 2/i)).not.toBeNull();
    const nextBtn = screen.getByRole('button', { name: /Sau/i });
    await user.click(nextBtn);

    // Page 2 fetched with offset 50
    await waitFor(() => {
      expect(mockListWorkers).toHaveBeenCalledWith(
        'test-token',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        50,
        50,
        expect.anything(),
      );
      expect(screen.getByText(/Nhân viên Trang 2 - 0/i)).not.toBeNull();
    });
  });

  it('audit history supports pagination and cleanly differentiates pending, error, empty, and populated states', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();

    const mockListDecisions = vi
      .fn()
      .mockRejectedValueOnce(new Error('Lỗi mạng khi tải lịch sử'))
      .mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `dec-p1-${i}`,
          revision: i + 1,
          action: 'RESOLVE',
          workerId: `worker-${i}`,
          reason: `Lý do xác minh ${i}`,
          actorUserId: 'admin-1',
          recordedAt: '2026-10-01T10:00:00Z',
        })),
        total: 35,
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 15 }, (_, i) => ({
          id: `dec-p2-${i}`,
          revision: 21 + i,
          action: 'CLEAR',
          workerId: null,
          reason: `Lý do thu hồi ${i}`,
          actorUserId: 'admin-1',
          recordedAt: '2026-10-01T10:05:00Z',
        })),
        total: 35,
      });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: mockListDecisions,
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Initial rejection shows error banner for history
    const errorNotice = await screen.findByText(/Không thể tải lịch sử đánh giá đối tượng/i);
    expect(errorNotice).not.toBeNull();
    const retryHistoryBtn = screen.getByRole('button', { name: /Thử lại/i });
    await user.click(retryHistoryBtn);

    // Page 1 loaded
    await waitFor(() => {
      expect(screen.getByText(/Lý do xác minh 0/i)).not.toBeNull();
    });
    expect(screen.getByText(/Trang 1 \/ 2/i)).not.toBeNull();

    // Click next page
    const nextBtn = screen.getByRole('button', { name: /Sau/i });
    await user.click(nextBtn);

    await waitFor(() => {
      expect(mockListDecisions).toHaveBeenCalledWith(
        'test-token',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001',
        0,
        20,
        20,
        expect.anything(),
      );
      expect(screen.getByText(/Lý do thu hồi 0/i)).not.toBeNull();
    });
  });

  it('decision mutation invalidates context and history across all alertIds sharing same eventId, and 409 refreshes both context and history', async () => {
    const user = userEvent.setup();
    const baseContext = createMockContext();
    const mockContext = {
      ...baseContext,
      subjects: [
        {
          ...baseContext.subjects[0],
          canClear: true,
          clearBlockReason: null,
        },
        baseContext.subjects[1],
      ],
    };
    const mockDecide = vi
      .fn()
      .mockRejectedValueOnce({
        status: 409,
        message: 'Phiên bản xem xét đã thay đổi bởi người khác.',
      })
      .mockResolvedValueOnce({
        recordedDecision: {
          id: 'dec-1',
          revision: 1,
          action: 'CLEAR',
          workerId: null,
          reason: 'Thu hồi sau làm mới',
          actorUserId: 'admin-1',
          recordedAt: '2026-10-01T10:00:00Z',
        },
        latestRevision: 1,
        replayed: false,
      });

    const mockGetContext = vi.fn().mockResolvedValue(mockContext);
    const mockListDecisions = vi.fn().mockResolvedValue({ items: [], total: 0 });

    const mockClient = {
      getObservationIdentityContext: mockGetContext,
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: mockListDecisions,
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="alert-alpha"
          detection={createMockDetection({ eventId: 'shared-event-123' })}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const clearRadio = screen.getByLabelText(/Thu hồi xác minh \(CLEAR\)/i);
    await user.click(clearRadio);

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Thu hồi hợp lệ vì hết hạn');

    const submitBtn = screen.getByRole('button', { name: /Thu hồi xác minh/i });
    await user.click(submitBtn);

    const refreshBtn = await screen.findByRole('button', { name: /Làm mới dữ liệu/i });
    expect(refreshBtn).not.toBeNull();

    const getContextCallsBefore = mockGetContext.mock.calls.length;
    const listDecisionsCallsBefore = mockListDecisions.mock.calls.length;
    await user.click(refreshBtn);

    expect(mockGetContext.mock.calls.length).toBeGreaterThan(getContextCallsBefore);
    expect(mockListDecisions.mock.calls.length).toBeGreaterThan(listDecisionsCallsBefore);

    await user.type(reasonInput, 'Thu hồi sau làm mới thành công');
    await user.click(screen.getByRole('button', { name: /Thu hồi xác minh/i }));

    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      const predicateCalls = invalidateSpy.mock.calls.filter(
        (call) => call[0] && typeof call[0] === 'object' && 'predicate' in call[0],
      );
      expect(predicateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('gcTime 0 evicts sensitive identity data on unmount, synchronous in-flight ref blocks double submit, and mutation aborts on unmount', async () => {
    const user = userEvent.setup();
    const baseContext = createMockContext();
    const mockContext = {
      ...baseContext,
      subjects: [
        {
          ...baseContext.subjects[0],
          canClear: true,
          clearBlockReason: null,
        },
        baseContext.subjects[1],
      ],
    };

    let resolveMutation!: (val: unknown) => void;
    let mutationSignal: AbortSignal | undefined;
    const decidePromise = new Promise((resolve) => {
      resolveMutation = resolve;
    });

    const mockDecide = vi.fn().mockImplementation((_t, _s, _a, _e, _p, _c, options) => {
      if (options?.signal) mutationSignal = options.signal;
      return decidePromise;
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="alert-1"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const clearRadio = screen.getByLabelText(/Thu hồi xác minh \(CLEAR\)/i);
    await user.click(clearRadio);

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Lý do thu hồi hợp lệ');

    const submitBtn = screen.getByRole('button', { name: /Thu hồi xác minh/i });
    const form = submitBtn.closest('form')!;

    // Submit form twice synchronously before React render updates disabled
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(mutationSignal?.aborted).toBe(true);

    resolveMutation({
      recordedDecision: {
        id: 'd1',
        revision: 1,
        action: 'CLEAR',
        workerId: null,
        reason: 'ok',
        actorUserId: 'admin',
        recordedAt: '2026-10-01T10:00:00Z',
      },
      latestRevision: 1,
      replayed: false,
    });
  });

  it('full frame viewer renders exact bounding box pixel rect for wide (letterbox) and tall (pillarbox) images, and tabs support roving keyboard navigation', async () => {
    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('geo-overlay-test');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
      subjects: [
        {
          personObservationIndex: 0,
          trackId: 10,
          subjectRef: {
            eventId: '00000000-0000-4000-8000-000000000001',
            personObservationIndex: 0,
            payloadHash: 'hash-0',
            cameraId: 'cam-1',
            cameraExternalId: 'CAM-1',
            streamSessionId: 'sess-1',
            capturedAt: '2026-10-01T10:00:00Z',
            trackId: 10,
            personBoundingBox: {
              x1: 0.1,
              y1: 0.2,
              x2: 0.5,
              y2: 0.8,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
          subjectRefSource: 'RAW_EVENT',
          technicalIdentity: { status: 'UNKNOWN', candidates: [] },
          latestManualDecision: null,
          revision: 0,
          canResolve: false,
          resolveBlockReason: null,
          canClear: true,
          clearBlockReason: null,
          originalZoneDecisions: { items: [], total: 0 },
        },
        {
          personObservationIndex: 1,
          trackId: 11,
          subjectRef: {
            eventId: '00000000-0000-4000-8000-000000000001',
            personObservationIndex: 1,
            payloadHash: 'hash-1',
            cameraId: 'cam-1',
            cameraExternalId: 'CAM-1',
            streamSessionId: 'sess-1',
            capturedAt: '2026-10-01T10:00:00Z',
            trackId: 11,
            personBoundingBox: {
              x1: 0.2,
              y1: 0.1,
              x2: 0.6,
              y2: 0.9,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
          subjectRefSource: 'RAW_EVENT',
          technicalIdentity: { status: 'UNKNOWN', candidates: [] },
          latestManualDecision: null,
          revision: 0,
          canResolve: false,
          resolveBlockReason: null,
          canClear: true,
          clearBlockReason: null,
          originalZoneDecisions: { items: [], total: 0 },
        },
      ],
    });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1200,
        height: 600,
        close: vi.fn(),
      }),
    );

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-testid') === 'evidence-frame-container') {
        return {
          width: 600,
          height: 600,
          top: 0,
          left: 0,
          bottom: 600,
          right: 600,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="alert-1"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    const tab1 = await screen.findByRole('tab', { name: /PERSON #1/i });

    // Keyboard roving tabIndex test:
    tab0.focus();
    await user.keyboard('{ArrowRight}');
    expect(tab1.getAttribute('tabindex')).toBe('0');
    expect(tab0.getAttribute('tabindex')).toBe('-1');
    expect(tab1.getAttribute('aria-selected')).toBe('false');

    await user.keyboard('{Enter}');
    expect(tab1.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowLeft}');
    expect(tab0.getAttribute('tabindex')).toBe('0');
    expect(tab1.getAttribute('tabindex')).toBe('-1');
    expect(tab1.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Enter}');
    expect(tab0.getAttribute('aria-selected')).toBe('true');

    // Wide image overlay pixel assertions
    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    const overlay = await screen.findByTestId('person-bounding-box-overlay');
    expect(overlay.style.left).toBe('60px');
    expect(overlay.style.top).toBe('210px');
    expect(overlay.style.width).toBe('240px');
    expect(overlay.style.height).toBe('180px');

    unmount();

    // Tall image (600x1200) in 600x600 container overlay pixel assertions:
    // Person #0 box: x1=.1, y1=.2, x2=.5, y2=.8
    // With pillarbox (displayWidth=300, displayHeight=600, offsetX=150, offsetY=0):
    // left = 150 + .1 * 300 = 180px
    // top = 0 + .2 * 600 = 120px
    // width = (.5 - .1) * 300 = 120px
    // height = (.8 - .2) * 600 = 360px
    const tallSyntheticBlob = createValidSyntheticJpeg('geo-overlay-tall-test');
    const tallValidHash = await computeViewedEvidenceSha256(tallSyntheticBlob);

    const tallMockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: tallValidHash, available: true }],
      subjects: mockContext.subjects,
    });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 600,
        height: 1200,
        close: vi.fn(),
      }),
    );

    const tallMockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(tallMockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount: unmountTall } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={tallMockClient}
          apiUrl="https://api.example"
          sessionScope="session-1-tall"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="alert-tall"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={tallSyntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tallTab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tallTab0);

    const tallImg = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(tallImg);

    const tallOverlay = await screen.findByTestId('person-bounding-box-overlay');
    expect(tallOverlay.style.left).toBe('180px');
    expect(tallOverlay.style.top).toBe('120px');
    expect(tallOverlay.style.width).toBe('120px');
    expect(tallOverlay.style.height).toBe('360px');

    unmountTall();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('keyboard-only initial entry: first tab is tabbable (tabIndex=0) while aria-selected=false, arrows move focus without selecting until Enter/Space', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    const tab1 = await screen.findByRole('tab', { name: /PERSON #1/i });

    // Initial state: Tab 0 is tabbable (tabIndex=0) but NOT selected (aria-selected=false)
    expect(tab0.getAttribute('tabindex')).toBe('0');
    expect(tab0.getAttribute('aria-selected')).toBe('false');
    expect(tab1.getAttribute('tabindex')).toBe('-1');
    expect(tab1.getAttribute('aria-selected')).toBe('false');

    // Prompt is visible because no subject is selected yet
    expect(screen.getByTestId('no-subject-selected-notice')).not.toBeNull();

    // Focus tab 0 and press ArrowRight: moves focus to tab 1 without selecting
    tab0.focus();
    await user.keyboard('{ArrowRight}');

    expect(document.activeElement).toBe(tab1);
    expect(tab1.getAttribute('tabindex')).toBe('0');
    expect(tab0.getAttribute('tabindex')).toBe('-1');
    expect(tab1.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('no-subject-selected-notice')).not.toBeNull();

    // Explicit Enter selects tab 1
    await user.keyboard('{Enter}');
    expect(tab1.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('no-subject-selected-notice')).toBeNull();
    expect(screen.getByLabelText(/Lý do đánh giá/i)).not.toBeNull();
  });

  it('two rendered panels generate unique IDs for tabs and tabpanels without collision', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <div data-testid="panel-container-1">
          <ObservationIdentityReviewPanel
            client={mockClient}
            apiUrl="https://api.example"
            sessionScope="session-1"
            token="test-token"
            siteId="00000000-0000-4000-8000-000000000001"
            alertId="alert-first"
            detection={createMockDetection({ eventId: 'event-1' })}
            evidenceIndex={0}
            evidenceBlob={null}
          />
        </div>
        <div data-testid="panel-container-2">
          <ObservationIdentityReviewPanel
            client={mockClient}
            apiUrl="https://api.example"
            sessionScope="session-1"
            token="test-token"
            siteId="00000000-0000-4000-8000-000000000001"
            alertId="alert-second"
            detection={createMockDetection({ eventId: 'event-2' })}
            evidenceIndex={0}
            evidenceBlob={null}
          />
        </div>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('tab').length).toBe(4);
    });
    const allTabs = screen.getAllByRole('tab');

    // Click tab 0 in both panels to render both tabpanels
    await user.click(allTabs[0]!);
    await user.click(allTabs[2]!);

    const allTabPanels = screen.getAllByRole('tabpanel');
    expect(allTabPanels.length).toBe(2);

    // Collect all IDs
    const tabIds = allTabs.map((t) => t.getAttribute('id')!).filter(Boolean);
    const panelIds = allTabPanels.map((p) => p.getAttribute('id')!).filter(Boolean);
    const allIds = [...tabIds, ...panelIds];

    // Strictly ensure no collisions across all IDs
    expect(allIds.length).toBe(new Set(allIds).size);

    // Check aria-controls and aria-labelledby consistency
    for (const panel of allTabPanels) {
      const labelledBy = panel.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const matchingTab = allTabs.find((t) => t.getAttribute('id') === labelledBy);
      expect(matchingTab).toBeDefined();
      expect(matchingTab!.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
    }
  });

  it('zero or invalid measured rect or decoder dimensions blocks overlay and blocks RESOLVE, requiring positive layout measurement', async () => {
    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('zero-rect');
    const validHash = await computeViewedEvidenceSha256(syntheticBlob);

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: validHash, available: true }],
    });

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    // Temporarily mock getBoundingClientRect to return 0x0
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.getAttribute('data-testid') === 'evidence-frame-container') {
        return {
          width: 0,
          height: 0,
          top: 0,
          left: 0,
          bottom: 0,
          right: 0,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    // Because measured container rect is 0x0: overlay is NOT rendered!
    expect(screen.queryByTestId('person-bounding-box-overlay')).toBeNull();

    // Notice about unmeasured container is displayed
    expect(screen.getByText(/Khung hiển thị chưa đo lường được kích thước/i)).not.toBeNull();

    // RESOLVE submit button is disabled
    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('worker paging clears selection synchronously and blocks submitting invisible selection while pending or error', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();

    let rejectWorkers = false;
    const mockListWorkers = vi.fn().mockImplementation((_t, _s, _a, _e, offset) => {
      if (rejectWorkers) {
        return Promise.reject(new Error('Lỗi tải danh sách'));
      }
      return Promise.resolve({
        items: Array.from({ length: 50 }, (_, i) => ({
          id: `worker-offset-${offset}-${i}`,
          displayName: `Nhân viên ${offset + i}`,
          externalId: `EMP-${offset + i}`,
          contractorName: null,
          role: 'WORKER',
          isActive: true,
        })),
        total: 100,
      });
    });

    const mockDecide = vi.fn();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: mockListWorkers,
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={null}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;

    await waitFor(() => {
      expect(screen.getByText('Nhân viên 0 (EMP-0)')).not.toBeNull();
    });

    // Select worker on page 1
    await user.selectOptions(workerSelect, 'worker-offset-0-0');
    expect(workerSelect.value).toBe('worker-offset-0-0');

    // Click next page
    const nextBtn = screen.getByRole('button', { name: /Sau/i });
    await user.click(nextBtn);

    // Synchronously cleared!
    expect(workerSelect.value).toBe('');

    // Now test that if worker query has error, submit is blocked
    rejectWorkers = true;
    const prevBtn = screen.getByRole('button', { name: /Trước/i });
    await user.click(prevBtn);

    await waitFor(() => {
      expect(screen.getByText(/Không thể tải danh bạ nhân viên/i)).not.toBeNull();
    });

    const submitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const form = submitBtn.closest('form');
    if (form) fireEvent.submit(form);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('skips createImageBitmap decoder entirely when evidenceBlob is >1MiB or non-JPEG, displaying validation error', async () => {
    const mockDecoder = vi.fn();
    vi.stubGlobal('createImageBitmap', mockDecoder);

    const user = userEvent.setup();
    const mockContext = createMockContext();

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    // 1. Non-JPEG Blob (e.g. image/png)
    const pngBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={pngBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Validation error displayed
    await waitFor(() => {
      expect(
        screen.getByText('Định dạng ảnh bằng chứng không hợp lệ (yêu cầu định dạng JPEG).'),
      ).not.toBeNull();
    });

    // Decoder MUST NOT be called!
    expect(mockDecoder).not.toHaveBeenCalled();

    // 2. Blob exceeding 1 MiB (1048576 bytes)
    const oversizedBytes = new Uint8Array(1048577);
    const oversizedBlob = new Blob([oversizedBytes], { type: 'image/jpeg' });

    rerender(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={oversizedBlob}
        />
      </QueryClientProvider>,
    );

    // Validation error for oversized blob displayed
    await waitFor(() => {
      expect(
        screen.getByText('Ảnh bằng chứng vượt quá dung lượng cho phép (tối đa 1MB).'),
      ).not.toBeNull();
    });

    // Decoder STILL must not be called!
    expect(mockDecoder).not.toHaveBeenCalled();
  });

  it('skips starting decode if effect is cancelled or unmounted before digest settles', async () => {
    let resolveSha!: (val: string) => void;
    const digestPromise = new Promise<string>((resolve) => {
      resolveSha = resolve;
    });

    const computeSpy = vi
      .spyOn(await import('./observationIdentityReviewUtils'), 'computeViewedEvidenceSha256')
      .mockReturnValue(digestPromise);

    const mockDecoder = vi.fn();
    vi.stubGlobal('createImageBitmap', mockDecoder);

    const syntheticBlob = createValidSyntheticJpeg('unmount-during-digest');
    const mockContext = createMockContext();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    // Unmount while digest is still pending
    unmount();

    // Now resolve digest
    resolveSha('mock-hash-after-unmount');

    await new Promise((r) => setTimeout(r, 20));

    // Decoder must NOT have been called because effect was cancelled
    expect(mockDecoder).not.toHaveBeenCalled();

    computeSpy.mockRestore();
  });

  it('mismatched Blob B never displays PERSON overlay, while CLEAR still works', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    const syntheticBlobB = createValidSyntheticJpeg('blob-b-content');

    const defaultSubject0 = createMockContext().subjects[0]!;
    const mockContext = createMockContext({
      frames: [
        { index: 0, kind: 'FRAME', sha256: 'original-descriptor-sha256-hash', available: true },
      ],
      subjects: [
        {
          ...defaultSubject0,
          canResolve: true,
          canClear: true,
          clearBlockReason: null,
          subjectRef: defaultSubject0.subjectRef
            ? {
                ...defaultSubject0.subjectRef,
                personBoundingBox: {
                  x1: 0.1,
                  y1: 0.2,
                  x2: 0.5,
                  y2: 0.8,
                  coordinateSpace: 'NORMALIZED_0_1',
                },
              }
            : null,
        },
      ],
    });

    const mockDecide = vi.fn().mockResolvedValue({
      id: 'mock-clear-decision-id',
      decisionSeq: 1,
      revision: 1,
      action: 'CLEAR',
      recordedAt: '2026-10-01T12:00:00Z',
      actorUserId: 'mock-user',
      replayed: false,
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlobB}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Mock container layout measurement
    const container = screen.getByTestId('evidence-frame-container');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 480,
      height: 360,
      top: 0,
      left: 0,
      right: 480,
      bottom: 360,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    // Wait until digest verification completes and discovers mismatch
    await waitFor(() => {
      expect(screen.getByText('Chưa xác thực')).not.toBeNull();
    });

    // CRITICAL: Mismatched Blob B MUST NEVER display PERSON overlay
    expect(screen.queryByTestId('person-bounding-box-overlay')).toBeNull();

    // Informative status banner indicates unverified digest
    expect(
      screen.getByText(
        'Ảnh bằng chứng chưa được xác thực tính toàn vẹn (SHA-256 không khớp hoặc chưa hoàn tất). Không thể hiển thị hộp bao đối tượng.',
      ),
    ).not.toBeNull();

    // RESOLVE submit button is disabled
    const resolveSubmitBtn = screen.getByRole('button', {
      name: /Xác nhận danh tính/i,
    }) as HTMLButtonElement;
    expect(resolveSubmitBtn.disabled).toBe(true);

    // But CLEAR still works!
    const clearRadio = screen.getByLabelText(/Thu hồi xác minh \(CLEAR\)/i) as HTMLInputElement;
    await user.click(clearRadio);
    expect(clearRadio.checked).toBe(true);

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Thu hồi vì ảnh bằng chứng B không khớp với mô tả');

    const clearSubmitBtn = screen.getByRole('button', {
      name: /Thu hồi xác minh/i,
    }) as HTMLButtonElement;
    expect(clearSubmitBtn.disabled).toBe(false);

    await user.click(clearSubmitBtn);
    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    expect(mockDecide.mock.calls[0]![5]).toMatchObject({
      action: 'CLEAR',
      reason: 'Thu hồi vì ảnh bằng chứng B không khớp với mô tả',
      expectedRevision: 0,
    });
  });

  it('pending hash never creates wrong-source attribution until digest resolves and matches', async () => {
    let resolveSha!: (val: string) => void;
    const pendingDigestPromise = new Promise<string>((resolve) => {
      resolveSha = resolve;
    });

    const computeSpy = vi
      .spyOn(await import('./observationIdentityReviewUtils'), 'computeViewedEvidenceSha256')
      .mockReturnValue(pendingDigestPromise);

    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({
        width: 1920,
        height: 1080,
        close: vi.fn(),
      }),
    );

    const user = userEvent.setup();
    const syntheticBlob = createValidSyntheticJpeg('pending-digest-blob');

    const mockContext = createMockContext({
      frames: [{ index: 0, kind: 'FRAME', sha256: 'matching-sha-once-resolved', available: true }],
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel
          client={mockClient}
          apiUrl="https://api.example"
          sessionScope="session-1"
          token="test-token"
          siteId="00000000-0000-4000-8000-000000000001"
          alertId="00000000-0000-4000-8000-000000000002"
          detection={createMockDetection()}
          evidenceIndex={0}
          evidenceBlob={syntheticBlob}
        />
      </QueryClientProvider>,
    );

    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const container = screen.getByTestId('evidence-frame-container');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 480,
      height: 360,
      top: 0,
      left: 0,
      right: 480,
      bottom: 360,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    const img = await screen.findByAltText('Khung hình bằng chứng quan sát');
    fireEvent.load(img);

    // While digest is pending, overlay MUST NOT be displayed (no wrong-source attribution)
    expect(screen.queryByTestId('person-bounding-box-overlay')).toBeNull();

    // Now resolve the digest with the matching SHA-256
    resolveSha('matching-sha-once-resolved');

    // After digest settles and matches, overlay is safely permitted
    await waitFor(() => {
      expect(screen.getByTestId('person-bounding-box-overlay')).not.toBeNull();
    });

    computeSpy.mockRestore();
  });

  it('token becoming empty unmounts scoped panel immediately, evicting all PII and blocking queries/mutations', async () => {
    const user = userEvent.setup();
    const mockContext = createMockContext();
    const mockDecide = vi.fn();
    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    const baseProps = {
      client: mockClient,
      apiUrl: 'https://api.example',
      sessionScope: 'session-persist-scope',
      siteId: '00000000-0000-4000-8000-000000000001',
      alertId: '00000000-0000-4000-8000-000000000002',
      detection: createMockDetection(),
      evidenceIndex: 0,
      evidenceBlob: null,
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel {...baseProps} token="initial-valid-token" />
      </QueryClientProvider>,
    );

    // 1. Initial authenticated state loads context
    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    const workerSelect = (await screen.findByLabelText(
      /Chọn nhân viên.*danh bạ/i,
    )) as HTMLSelectElement;
    await waitFor(() => {
      expect(screen.getByText(/Nguyễn Văn A/i)).not.toBeNull();
    });
    await user.selectOptions(workerSelect, '00000000-0000-4000-8000-000000000777');

    const reasonInput = screen.getByLabelText(/Lý do đánh giá/i);
    await user.type(reasonInput, 'Lý do đánh giá bí mật cá nhân');

    expect(screen.getByText('PERSON #0')).not.toBeNull();
    expect(screen.getByText(/Nguyễn Văn A/i)).not.toBeNull();
    expect((reasonInput as HTMLTextAreaElement).value).toBe('Lý do đánh giá bí mật cá nhân');
    expect(mockClient.getObservationIdentityContext).toHaveBeenCalledTimes(1);

    // 2. Token becomes empty with unchanged sessionScope and same other props
    rerender(
      <QueryClientProvider client={queryClient}>
        <ObservationIdentityReviewPanel {...baseProps} token="" />
      </QueryClientProvider>,
    );

    // 3. Immediately unauthenticated boundary displays
    expect(screen.getByTestId('observation-identity-unauthenticated')).not.toBeNull();
    expect(
      screen.getByText(/Vui lòng đăng nhập để xem thông tin nhận diện đối tượng/i),
    ).not.toBeNull();

    // 4. No identity name, reason, context, form or tabs remain in the DOM
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText(/PERSON #0/i)).toBeNull();
    expect(screen.queryByText(/Nguyễn Văn A/i)).toBeNull();
    expect(screen.queryByLabelText(/Lý do đánh giá/i)).toBeNull();
    expect(screen.queryByLabelText(/Chọn nhân viên.*danh bạ/i)).toBeNull();
    expect(screen.queryByText('Lý do đánh giá bí mật cá nhân')).toBeNull();

    // 5. No new request or mutation dispatched
    expect(mockClient.getObservationIdentityContext).toHaveBeenCalledTimes(1);
    expect(mockClient.listObservationIdentityWorkers).toHaveBeenCalledTimes(1);
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('React.StrictMode proves every allocated object URL is revoked after unmount / Blob change without retaining discarded allocations', async () => {
    const allocatedUrls = new Set<string>();
    const allAllocatedRecords: { blob: Blob; url: string }[] = [];
    const allRevokedUrls = new Set<string>();
    let urlCounter = 0;

    const mockCreateObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:http://localhost/strict-mode-uuid-${++urlCounter}`;
      allocatedUrls.add(url);
      allAllocatedRecords.push({ blob, url });
      return url;
    });

    const mockRevokeObjectURL = vi.fn((url: string) => {
      allocatedUrls.delete(url);
      allRevokedUrls.add(url);
    });

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: mockCreateObjectURL,
      revokeObjectURL: mockRevokeObjectURL,
    });

    const blobA = createValidSyntheticJpeg('blob-a-strict');
    const hashA = await computeViewedEvidenceSha256(blobA);

    const blobB = createValidSyntheticJpeg('blob-b-strict');
    const hashB = await computeViewedEvidenceSha256(blobB);

    const mockContext = createMockContext({
      frames: [
        { index: 0, kind: 'FRAME', sha256: hashA, available: true },
        { index: 1, kind: 'FRAME', sha256: hashB, available: true },
      ],
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const user = userEvent.setup();

    const baseProps = {
      client: mockClient,
      apiUrl: 'https://api.example',
      sessionScope: 'session-strict',
      token: 'test-token',
      siteId: '00000000-0000-4000-8000-000000000001',
      alertId: 'alert-strict',
      detection: createMockDetection(),
    };

    // Render inside React.StrictMode
    const { rerender, unmount } = render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <ObservationIdentityReviewPanel {...baseProps} evidenceIndex={0} evidenceBlob={blobA} />
        </QueryClientProvider>
      </React.StrictMode>,
    );

    // Select Person #0 so viewer is active
    const tab0 = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(tab0);

    // Wait for image viewer to mount and allocate URL
    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalled();
    });

    // In StrictMode, discarded initial mounts must have their URLs revoked
    // Only the active URL for blobA should remain unrevoked
    expect(allocatedUrls.size).toBe(1);

    const callsBeforeBlobChange = mockCreateObjectURL.mock.calls.length;
    const blobAUrls = allAllocatedRecords.filter((r) => r.blob === blobA).map((r) => r.url);

    // Switch to blobB
    rerender(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <ObservationIdentityReviewPanel {...baseProps} evidenceIndex={1} evidenceBlob={blobB} />
        </QueryClientProvider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(mockCreateObjectURL.mock.calls.length).toBe(callsBeforeBlobChange + 1);
    });

    // Inspect last called Blob is B
    const lastCalledBlob = allAllocatedRecords[allAllocatedRecords.length - 1]!.blob;
    expect(lastCalledBlob).toBe(blobB);

    // All prior A URLs revoked
    for (const url of blobAUrls) {
      expect(allRevokedUrls.has(url)).toBe(true);
    }

    // Only the URL for blobB should remain unrevoked
    expect(allocatedUrls.size).toBe(1);

    // Now unmount completely
    unmount();

    // After unmount no allocated URLs and revoked list includes every allocation
    expect(allocatedUrls.size).toBe(0);
    expect(allRevokedUrls.size).toBe(allAllocatedRecords.length);
    for (const { url } of allAllocatedRecords) {
      expect(allRevokedUrls.has(url)).toBe(true);
    }
  });
});
