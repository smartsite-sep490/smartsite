// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type {
  SmartSiteManagementClient,
  SafetyAlertDetectionResponse,
  ObservationIdentityContextResponse,
  ObservationIdentityWorkerResponse,
} from '@smartsite/api-client';
import { SafetyAlertEvidencePanel } from './SafetyAlertEvidencePanel';

// Polyfill URL.createObjectURL and ResizeObserver for jsdom
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
      siteId: 'site-alpha',
      externalId: 'EMP-001',
      displayName: 'Nguyễn Văn A',
      isActive: true,
    },
  ],
  total: 1,
};

describe('SafetyAlertEvidencePanel Integration (Plan §15 A4 Production Mount)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  const baseProps = {
    apiUrl: 'http://127.0.0.1:3001',
    sessionScope: 'test-user-session',
    token: 'test-so-bearer-token',
    siteId: 'site-alpha',
    alertId: 'alert-100',
  };

  it('SO allowed: mounts ObservationIdentityReviewPanel when canReviewIdentity is true', async () => {
    const detection = createMockDetection();
    const mockContext = createMockContext();

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getSafetyAlertEvidence: vi.fn(),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertEvidencePanel
          {...baseProps}
          client={mockClient}
          detection={detection}
          canReviewIdentity={true}
        />
      </QueryClientProvider>,
    );

    // Bảng kiểm tra danh tính đối tượng được mount
    const title = await screen.findByText('Xác minh người trong ảnh');
    expect(title).not.toBeNull();

    const prompt = screen.getByText(
      'Vui lòng chọn một đối tượng PERSON bên trên để xem xét danh tính hoặc nhập quyết định.',
    );
    expect(prompt).not.toBeNull();

    // API context được gọi với đúng tham số
    expect(mockClient.getObservationIdentityContext).toHaveBeenCalledWith(
      baseProps.token,
      baseProps.siteId,
      baseProps.alertId,
      detection.eventId,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('Admin-only denied: does NOT mount ObservationIdentityReviewPanel and never calls identity APIs when canReviewIdentity is false', async () => {
    const detection = createMockDetection();
    const mockClient = {
      getObservationIdentityContext: vi.fn(),
      listObservationIdentityWorkers: vi.fn(),
      listObservationIdentityDecisions: vi.fn(),
      getSafetyAlertEvidence: vi.fn(),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertEvidencePanel
          {...baseProps}
          token="test-admin-only-bearer-token"
          client={mockClient}
          detection={detection}
          canReviewIdentity={false}
        />
      </QueryClientProvider>,
    );

    // Không render bảng xác minh nhận diện
    expect(screen.queryByText('Xác minh người trong ảnh')).toBeNull();
    expect(
      screen.queryByText(
        'Vui lòng chọn một đối tượng PERSON bên trên để xem xét danh tính hoặc nhập quyết định.',
      ),
    ).toBeNull();

    // Tuyệt đối không gọi bất kỳ API identity nào
    expect(mockClient.getObservationIdentityContext).not.toHaveBeenCalled();
    expect(mockClient.listObservationIdentityWorkers).not.toHaveBeenCalled();
    expect(mockClient.listObservationIdentityDecisions).not.toHaveBeenCalled();
    expect(mockClient.decideObservationIdentity).not.toHaveBeenCalled();
  });

  it('image missing CLEAR: remains mounted when evidence is missing/empty, allowing CLEAR without media descriptors', async () => {
    const user = userEvent.setup();
    // Quan sát không có ảnh bằng chứng nào được lưu trữ
    const detection = createMockDetection({ evidence: [] });

    const mockContext: ObservationIdentityContextResponse = createMockContext({
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
            workerId: '00000000-0000-4000-8000-000000000777',
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
        actorUserId: '00000000-0000-4000-8000-000000000888',
        reason: 'Thu hồi quyết định do ảnh hết hạn trên hệ thống lưu trữ',
        scope: 'EXACT_OBSERVATION',
        verificationMethod: 'MANUAL',
        recordedAt: '2026-10-01T11:00:00Z',
        subjectRef: {
          eventId: detection.eventId,
          personObservationIndex: 0,
          payloadHash: mockContext.payloadHash,
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
            coordinateSpace: 'NORMALIZED_0_1' as const,
          },
        },
        evidenceIndex: null,
        evidenceSha256: null,
      },
      latestRevision: 2,
      replayed: false,
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn().mockResolvedValue(mockContext),
      listObservationIdentityWorkers: vi.fn().mockResolvedValue(mockWorkersList),
      listObservationIdentityDecisions: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      getSafetyAlertEvidence: vi.fn(),
      decideObservationIdentity: mockDecide,
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertEvidencePanel
          {...baseProps}
          client={mockClient}
          detection={detection}
          canReviewIdentity={true}
        />
      </QueryClientProvider>,
    );

    // Thông báo ảnh không có vẫn hiển thị
    const emptyNotice = await screen.findByText('No evidence image retained for this observation.');
    expect(emptyNotice).not.toBeNull();

    // ObservationIdentityReviewPanel vẫn được mount độc lập
    const headerTitle = await screen.findByText('Xác minh người trong ảnh');
    expect(headerTitle).not.toBeNull();

    // Chọn đối tượng Person #0
    const personTab = await screen.findByRole('tab', { name: /PERSON #0/i });
    await user.click(personTab);

    // Radio CLEAR khả dụng, radio RESOLVE bị khóa do không có ảnh
    const clearRadio = await screen.findByLabelText('Thu hồi xác minh (CLEAR)');
    expect((clearRadio as HTMLInputElement).disabled).toBe(false);
    await user.click(clearRadio);

    // Nhập lý do thu hồi hợp lệ (>= 5 ký tự)
    const reasonInput = screen.getByRole('textbox', {
      name: /Lý do đánh giá/i,
    });
    await user.type(reasonInput, 'Thu hồi quyết định do ảnh hết hạn trên hệ thống lưu trữ');

    // Nút CLEAR khả dụng và submit
    const submitButton = screen.getByRole('button', { name: 'Thu hồi xác minh' });
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(submitButton);

    // Kiểm tra payload gửi qua decideObservationIdentity: tuyệt đối không gửi evidenceIndex hay expectedEvidenceSha256
    await waitFor(() => {
      expect(mockDecide).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockDecide.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(callArgs![0]).toBe(baseProps.token);
    expect(callArgs![1]).toBe(baseProps.siteId);
    expect(callArgs![2]).toBe(baseProps.alertId);
    expect(callArgs![3]).toBe(detection.eventId);
    expect(callArgs![4]).toBe(0);

    const passedCommand = callArgs![5];
    expect(passedCommand).toMatchObject({
      commandId: expect.any(String),
      action: 'CLEAR',
      expectedRevision: 1,
      expectedEventHash: mockContext.payloadHash,
      reason: 'Thu hồi quyết định do ảnh hết hạn trên hệ thống lưu trữ',
    });
    expect(passedCommand).not.toHaveProperty('workerId');
    expect(passedCommand).not.toHaveProperty('evidenceIndex');
    expect(passedCommand).not.toHaveProperty('expectedEvidenceSha256');
  });

  it('passes AbortSignal to getSafetyAlertEvidence and aborts request on cancellation/unmount', async () => {
    const user = userEvent.setup();
    const detection = createMockDetection({
      evidence: [{ index: 0, kind: 'FRAME', available: true }],
    });

    let capturedSignal: AbortSignal | undefined;
    const pendingPromise = new Promise<Blob>(() => {
      // Intentionally pending
    });

    const mockClient = {
      getObservationIdentityContext: vi.fn(),
      listObservationIdentityWorkers: vi.fn(),
      listObservationIdentityDecisions: vi.fn(),
      getSafetyAlertEvidence: vi
        .fn()
        .mockImplementation(
          (
            _token: string,
            _siteId: string,
            _alertId: string,
            _eventId: string,
            _index: number,
            options?: { signal?: AbortSignal },
          ) => {
            capturedSignal = options?.signal;
            return pendingPromise;
          },
        ),
      decideObservationIdentity: vi.fn(),
    } as unknown as SmartSiteManagementClient;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertEvidencePanel
          {...baseProps}
          client={mockClient}
          detection={detection}
          canReviewIdentity={false}
        />
      </QueryClientProvider>,
    );

    // Bấm xem ảnh bằng chứng
    const viewButton = await screen.findByRole('button', { name: /View Frame/i });
    await user.click(viewButton);

    // Xác nhận getSafetyAlertEvidence được gọi kèm AbortSignal ở tham số thứ 6
    expect(mockClient.getSafetyAlertEvidence).toHaveBeenCalledWith(
      baseProps.token,
      baseProps.siteId,
      baseProps.alertId,
      detection.eventId,
      0,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Unmount component để kích hoạt TanStack Query abort
    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('StrictMode regression: EvidenceImage survives effect replay with active unrevoked src and cleans up on unmount', async () => {
    const user = userEvent.setup();
    const detection = createMockDetection({
      evidence: [{ index: 0, kind: 'FRAME', available: true }],
    });

    const mockBlob = new Blob(['test-evidence-payload'], { type: 'image/jpeg' });
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];

    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:mock-url-${createdUrls.length + 1}-${blob.size}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    try {
      const mockClient = {
        getObservationIdentityContext: vi.fn(),
        listObservationIdentityWorkers: vi.fn(),
        listObservationIdentityDecisions: vi.fn(),
        getSafetyAlertEvidence: vi.fn().mockResolvedValue(mockBlob),
        decideObservationIdentity: vi.fn(),
      } as unknown as SmartSiteManagementClient;

      const { unmount } = render(
        <React.StrictMode>
          <QueryClientProvider client={queryClient}>
            <SafetyAlertEvidencePanel
              {...baseProps}
              client={mockClient}
              detection={detection}
              canReviewIdentity={false}
            />
          </QueryClientProvider>
        </React.StrictMode>,
      );

      // Bấm xem ảnh bằng chứng
      const viewButton = await screen.findByRole('button', { name: /View Frame/i });
      await user.click(viewButton);

      // Đợi ảnh hiển thị
      const img = await screen.findByRole('img');
      const activeSrc = img.getAttribute('src');

      // 1. URL đang hiển thị KHÔNG ĐƯỢC nằm trong danh sách các URL đã bị thu hồi
      expect(activeSrc).toBeDefined();
      expect(activeSrc).not.toBeNull();
      expect(revokedUrls).not.toContain(activeSrc);

      // 2. Unmount để kiểm tra dọn dẹp triệt để
      unmount();

      // Sau khi unmount, activeSrc phải được revoke hoàn toàn, không rò rỉ bộ nhớ
      expect(revokedUrls).toContain(activeSrc);
      expect(revokedUrls.length).toBe(createdUrls.length);
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
