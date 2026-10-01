import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Info,
  ShieldCheck,
  User,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import type {
  ObservationIdentityDecisionCommand,
  ObservationIdentityWorkerResponse,
  SafetyAlertDetectionResponse,
  SmartSiteManagementClient,
} from '@smartsite/api-client';
import {
  buildObservationIdentityContextQueryKey,
  buildObservationIdentityDecisionsQueryKey,
  buildObservationIdentityWorkersQueryKey,
  computeBoxOverlayRect,
  computeViewedEvidenceSha256,
  formatClearBlockReason,
  formatIdentityErrorMessage,
  formatResolveBlockReason,
  formatTechnicalStatus,
  getOrGenerateCommandId,
  validateReason,
  type CommandStateTracker,
  type ObservationIdentityCommandInput,
  type ObservationIdentityCommandScope,
  type ObservationIdentitySubjectResponse,
} from './observationIdentityReviewUtils';

export interface ObservationIdentityReviewPanelProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  detection: SafetyAlertDetectionResponse;
  evidenceIndex: number | null;
  evidenceBlob: Blob | null;
}

export function ObservationIdentityReviewPanel(props: ObservationIdentityReviewPanelProps) {
  if (!props.token || !props.token.trim()) {
    return (
      <div
        role="status"
        data-testid="observation-identity-unauthenticated"
        className="mt-3 rounded-md border border-dashed border-[#D3D1CB] bg-[#F7F6F3] p-4 text-center text-xs text-[#6B6B6B]"
      >
        Vui lòng đăng nhập để xem thông tin nhận diện đối tượng.
      </div>
    );
  }

  const scopeKey = `${props.apiUrl}:${props.siteId}:${props.alertId}:${props.detection.eventId}:${props.sessionScope}`;
  return <ObservationIdentityReviewPanelScoped key={scopeKey} {...props} />;
}

interface BlobAuditState {
  blob: Blob;
  sha256: string | null;
  digestError: string | null;
  dimensions: { width: number; height: number } | null;
  dimensionsError: string | null;
}

function ObservationIdentityReviewPanelScoped({
  client,
  apiUrl,
  sessionScope,
  token,
  siteId,
  alertId,
  detection,
  evidenceIndex,
  evidenceBlob,
}: ObservationIdentityReviewPanelProps) {
  const [selectedPersonIndex, setSelectedPersonIndex] = useState<number | null>(null);
  const [focusedTabIndex, setFocusedTabIndex] = useState<number>(0);
  const [blobAudit, setBlobAudit] = useState<BlobAuditState | null>(null);
  const [workerPageOffset, setWorkerPageOffset] = useState<number>(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelInstanceId = useId();

  const getTabId = (personIndex: number) => `${panelInstanceId}-person-tab-${personIndex}`;
  const getTabPanelId = (personIndex: number) =>
    `${panelInstanceId}-person-tabpanel-${personIndex}`;

  // 1. Fetch Identity Context (Subjects, Frames, Technical Identities, Head Decisions)
  const contextQueryKey = useMemo(
    () =>
      buildObservationIdentityContextQueryKey(
        apiUrl,
        sessionScope,
        siteId,
        alertId,
        detection.eventId,
      ),
    [apiUrl, sessionScope, siteId, alertId, detection.eventId],
  );

  const contextQuery = useQuery({
    queryKey: contextQueryKey,
    queryFn: ({ signal }) =>
      client.getObservationIdentityContext(token, siteId, alertId, detection.eventId, { signal }),
    enabled: Boolean(token && siteId && alertId && detection.eventId),
    staleTime: 10_000,
    gcTime: 0,
  });

  const subjects = useMemo(() => contextQuery.data?.subjects ?? [], [contextQuery.data]);

  // Explicit PERSON selection required: no silent fallback to subjects[0]
  const activePersonIndex = selectedPersonIndex;

  const currentSubject: ObservationIdentitySubjectResponse | null = useMemo(() => {
    if (activePersonIndex === null) return null;
    return subjects.find((s) => s.personObservationIndex === activePersonIndex) ?? null;
  }, [subjects, activePersonIndex]);

  // 2. Fetch Authoritative Worker Directory (only when an explicit subject is selected)
  const workersQueryKey = useMemo(
    () =>
      buildObservationIdentityWorkersQueryKey(
        apiUrl,
        sessionScope,
        siteId,
        alertId,
        detection.eventId,
        workerPageOffset,
        50,
      ),
    [apiUrl, sessionScope, siteId, alertId, detection.eventId, workerPageOffset],
  );

  const workersQuery = useQuery({
    queryKey: workersQueryKey,
    queryFn: ({ signal }) =>
      client.listObservationIdentityWorkers(
        token,
        siteId,
        alertId,
        detection.eventId,
        workerPageOffset,
        50,
        { signal },
      ),
    enabled: Boolean(
      token && siteId && alertId && detection.eventId && selectedPersonIndex !== null,
    ),
    staleTime: 30_000,
    gcTime: 0,
  });

  const workers = useMemo(() => workersQuery.data?.items ?? [], [workersQuery.data]);

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (subjects.length === 0) return;
    let nextIndex = -1;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextIndex = (index + 1) % subjects.length;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      nextIndex = (index - 1 + subjects.length) % subjects.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = subjects.length - 1;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const sub = subjects[index];
      if (sub) {
        setSelectedPersonIndex(sub.personObservationIndex);
        setFocusedTabIndex(index);
      }
      return;
    }

    if (nextIndex >= 0 && nextIndex < subjects.length) {
      setFocusedTabIndex(nextIndex);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  // 3. Process SHA-256 and decode dimensions tied strictly to the exact Blob instance
  useEffect(() => {
    let active = true;
    let currentBitmap: ImageBitmap | null = null;

    if (!evidenceBlob) {
      return;
    }

    const targetBlob = evidenceBlob;

    async function processBlob() {
      let sha256: string | null = null;
      let digestError: string | null = null;
      let dimensions: { width: number; height: number } | null = null;
      let dimensionsError: string | null = null;

      // 3.1. SHA-256 Digest
      try {
        sha256 = await computeViewedEvidenceSha256(targetBlob);
      } catch (err) {
        digestError = err instanceof Error ? err.message : 'Lỗi kiểm tra tính toàn vẹn của ảnh.';
      }

      if (!active) {
        return;
      }

      // If digest verification failed (empty, non-JPEG, >1MiB), skip decode entirely
      if (digestError || !sha256) {
        setBlobAudit({
          blob: targetBlob,
          sha256: null,
          digestError,
          dimensions: null,
          dimensionsError: null,
        });
        return;
      }

      // 3.2. Decode Dimensions (only executed if digest succeeded and effect is active)
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(targetBlob);
          currentBitmap = bitmap;
          try {
            if (!active) {
              return;
            }
            if (
              Number.isFinite(bitmap.width) &&
              Number.isFinite(bitmap.height) &&
              bitmap.width > 0 &&
              bitmap.height > 0
            ) {
              dimensions = { width: bitmap.width, height: bitmap.height };
            } else {
              dimensionsError =
                'Kích thước ảnh đã giải mã không hợp lệ (chiều dài hoặc chiều rộng không hợp lệ).';
            }
          } finally {
            bitmap.close();
            currentBitmap = null;
          }
        } catch (err) {
          if (!active) {
            return;
          }
          dimensionsError =
            err instanceof Error ? err.message : 'Không thể giải mã hình ảnh bằng chứng.';
        }
      } else {
        // Decoder unavailable -> Fail closed! Never invent dummy dimensions!
        dimensionsError =
          'Trình duyệt không hỗ trợ giải mã ảnh bằng chứng (thiếu bộ giải mã createImageBitmap).';
      }

      if (!active) {
        return;
      }

      setBlobAudit({
        blob: targetBlob,
        sha256,
        digestError: null,
        dimensions,
        dimensionsError,
      });
    }

    void processBlob();

    return () => {
      active = false;
      if (currentBitmap) {
        try {
          currentBitmap.close();
        } catch {
          // already closed
        }
        currentBitmap = null;
      }
    };
  }, [evidenceBlob]);

  // Strictly check reference equality: only use audit results if blob matches evidenceBlob exactly
  const activeBlobAudit = evidenceBlob && blobAudit?.blob === evidenceBlob ? blobAudit : null;
  const effectiveBlobSha256 = activeBlobAudit?.sha256 ?? null;
  const blobDigestError = activeBlobAudit?.digestError ?? null;
  const effectiveDimensions = activeBlobAudit?.dimensions ?? null;
  const dimensionsError =
    activeBlobAudit?.dimensionsError ??
    (evidenceBlob && !activeBlobAudit ? 'Đang kiểm tra và giải mã ảnh bằng chứng…' : null);

  // Verify full-frame Blob hash matches context frame descriptor
  const frames = contextQuery.data?.frames;
  const matchingFrameDescriptor = useMemo(() => {
    if (!frames || evidenceIndex === null) return null;
    return frames.find((f) => f.index === evidenceIndex) ?? null;
  }, [frames, evidenceIndex]);

  const isEvidenceDigestValid = useMemo(() => {
    if (!effectiveBlobSha256 || !matchingFrameDescriptor?.sha256) return false;
    return effectiveBlobSha256.toLowerCase() === matchingFrameDescriptor.sha256.toLowerCase();
  }, [effectiveBlobSha256, matchingFrameDescriptor]);

  // Render Loading
  if (contextQuery.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        className="flex items-center justify-center gap-2 rounded-md border border-[#EAEAEA] bg-[#F7F6F3] p-4 text-xs text-[#6B6B6B]"
      >
        <span
          className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#EAEAEA] border-t-transparent"
          aria-hidden="true"
        />
        <span>Đang tải dữ liệu nhận diện đối tượng…</span>
      </div>
    );
  }

  // Render Context Query Error
  if (contextQuery.isError) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#FDEBEC] bg-[#FDEBEC] p-3 text-xs text-[#9F2F2D]"
      >
        <span>{formatIdentityErrorMessage(contextQuery.error)}</span>
        <button
          type="button"
          onClick={() => void contextQuery.refetch()}
          className="inline-flex items-center gap-1 font-semibold text-[#9F2F2D] underline hover:no-underline"
        >
          <ArrowClockwise className="h-3 w-3" />
          <span>Thử lại</span>
        </button>
      </div>
    );
  }

  // Empty Subjects
  if (subjects.length === 0) {
    return (
      <div className="rounded-md border border-[#EAEAEA] bg-[#F7F6F3] p-3 text-[11px] text-[#6B6B6B]">
        Không có đối tượng PERSON nào trong sự kiện này.
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#EAEAEA] bg-white p-3 shadow-xs">
      {/* Header & Subject Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAEAEA] pb-2.5">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-[#111111]" aria-hidden="true" />
          <span className="text-xs font-semibold text-[#111111]">Xác minh người trong ảnh</span>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Danh sách đối tượng người">
          {subjects.map((sub, idx) => {
            const isSelected = sub.personObservationIndex === activePersonIndex;
            const isTabbable = idx === focusedTabIndex;
            return (
              <button
                key={sub.personObservationIndex}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                id={getTabId(sub.personObservationIndex)}
                aria-controls={getTabPanelId(sub.personObservationIndex)}
                tabIndex={isTabbable ? 0 : -1}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                onFocus={() => setFocusedTabIndex(idx)}
                onClick={() => {
                  setSelectedPersonIndex(sub.personObservationIndex);
                  setFocusedTabIndex(idx);
                }}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? 'bg-[#111111] text-white'
                    : 'border border-[#EAEAEA] bg-[#F7F6F3] text-[#2F3437] hover:bg-[#EAEAEA]'
                }`}
              >
                <User className="h-3 w-3" />
                <span>PERSON #{sub.personObservationIndex}</span>
                {sub.trackId !== null && <span className="opacity-70">(Track #{sub.trackId})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {currentSubject ? (
        <ObservationIdentitySubjectForm
          key={`${apiUrl}:${siteId}:${alertId}:${detection.eventId}:${activePersonIndex}:${sessionScope}`}
          tabId={getTabId(currentSubject.personObservationIndex)}
          tabPanelId={getTabPanelId(currentSubject.personObservationIndex)}
          client={client}
          apiUrl={apiUrl}
          sessionScope={sessionScope}
          token={token}
          siteId={siteId}
          alertId={alertId}
          eventId={detection.eventId}
          currentSubject={currentSubject}
          eventPayloadHash={contextQuery.data?.payloadHash ?? ''}
          workers={workers}
          isWorkersPending={workersQuery.isPending}
          isWorkersError={workersQuery.isError}
          workersTotal={workersQuery.data?.total ?? 0}
          workerPageOffset={workerPageOffset}
          onWorkerPageChange={setWorkerPageOffset}
          onRefetchWorkers={() => void workersQuery.refetch()}
          evidenceIndex={evidenceIndex}
          evidenceBlob={evidenceBlob}
          decodedDimensions={effectiveDimensions}
          isEvidenceDigestValid={isEvidenceDigestValid}
          computedBlobSha256={effectiveBlobSha256}
          blobDigestError={blobDigestError}
          dimensionsError={dimensionsError}
          onRefetchContext={() => void contextQuery.refetch()}
        />
      ) : (
        <div
          data-testid="no-subject-selected-notice"
          className="rounded-md border border-dashed border-[#D3D1CB] bg-[#F7F6F3] p-4 text-center text-xs text-[#6B6B6B]"
        >
          Vui lòng chọn một đối tượng PERSON bên trên để xem xét danh tính hoặc nhập quyết định.
        </div>
      )}
    </div>
  );
}

interface ObservationIdentitySubjectFormProps {
  tabId: string;
  tabPanelId: string;
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  eventId: string;
  currentSubject: ObservationIdentitySubjectResponse;
  eventPayloadHash: string;
  workers: ObservationIdentityWorkerResponse[];
  isWorkersPending: boolean;
  isWorkersError: boolean;
  workersTotal: number;
  workerPageOffset: number;
  onWorkerPageChange: (offset: number) => void;
  onRefetchWorkers: () => void;
  evidenceIndex: number | null;
  evidenceBlob: Blob | null;
  decodedDimensions: { width: number; height: number } | null;
  isEvidenceDigestValid: boolean;
  computedBlobSha256: string | null;
  blobDigestError: string | null;
  dimensionsError: string | null;
  onRefetchContext: () => void;
}

function ObservationIdentitySubjectForm({
  tabId,
  tabPanelId,
  client,
  apiUrl,
  sessionScope,
  token,
  siteId,
  alertId,
  eventId,
  currentSubject,
  eventPayloadHash,
  workers,
  isWorkersPending,
  isWorkersError,
  workersTotal,
  workerPageOffset,
  onWorkerPageChange,
  onRefetchWorkers,
  evidenceIndex,
  evidenceBlob,
  decodedDimensions,
  isEvidenceDigestValid,
  computedBlobSha256,
  blobDigestError,
  dimensionsError,
  onRefetchContext,
}: ObservationIdentitySubjectFormProps) {
  const queryClient = useQueryClient();
  const reasonInputId = useId();
  const workerSelectId = useId();

  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [actionType, setActionType] = useState<'RESOLVE' | 'CLEAR'>('RESOLVE');
  const [commandTracker, setCommandTracker] = useState<CommandStateTracker | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isStaleConflict, setIsStaleConflict] = useState<boolean>(false);
  const [lastReplayed, setLastReplayed] = useState<boolean>(false);
  const [historyPageOffset, setHistoryPageOffset] = useState<number>(0);
  const [isFrameReady, setIsFrameReady] = useState<boolean>(false);

  const isSubmittingRef = useRef<boolean>(false);
  const mutationAbortControllerRef = useRef<AbortController | null>(null);

  const handleWorkerPageChange = (newOffset: number) => {
    setSelectedWorkerId('');
    setSubmitError(null);
    setIsStaleConflict(false);
    onWorkerPageChange(newOffset);
  };

  useEffect(() => {
    return () => {
      mutationAbortControllerRef.current?.abort();
    };
  }, []);

  // Subject Decisions Audit History
  const decisionsQueryKey = useMemo(
    () =>
      buildObservationIdentityDecisionsQueryKey(
        apiUrl,
        sessionScope,
        siteId,
        alertId,
        eventId,
        currentSubject.personObservationIndex,
        historyPageOffset,
        20,
      ),
    [
      apiUrl,
      sessionScope,
      siteId,
      alertId,
      eventId,
      currentSubject.personObservationIndex,
      historyPageOffset,
    ],
  );

  const decisionsQuery = useQuery({
    queryKey: decisionsQueryKey,
    queryFn: ({ signal }) =>
      client.listObservationIdentityDecisions(
        token,
        siteId,
        alertId,
        eventId,
        currentSubject.personObservationIndex,
        historyPageOffset,
        20,
        { signal },
      ),
    enabled: Boolean(token && siteId && alertId && eventId),
    staleTime: 5_000,
    gcTime: 0,
  });

  // Mutation
  const mutation = useMutation({
    mutationFn: (cmd: ObservationIdentityDecisionCommand) => {
      mutationAbortControllerRef.current?.abort();
      const controller = new AbortController();
      mutationAbortControllerRef.current = controller;
      return client.decideObservationIdentity(
        token,
        siteId,
        alertId,
        eventId,
        currentSubject.personObservationIndex,
        cmd,
        { signal: controller.signal },
      );
    },
    onSuccess: (result) => {
      isSubmittingRef.current = false;
      setLastReplayed(result.replayed);
      setSubmitError(null);
      setIsStaleConflict(false);

      // Invalidate context for all alerts sharing the same eventId
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'observation-identity-context' &&
          query.queryKey[1] === apiUrl &&
          query.queryKey[2] === sessionScope &&
          query.queryKey[3] === siteId &&
          query.queryKey[5] === eventId,
      });

      // Invalidate decisions for this person observation across all alerts sharing the same eventId
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'observation-identity-decisions' &&
          query.queryKey[1] === apiUrl &&
          query.queryKey[2] === sessionScope &&
          query.queryKey[3] === siteId &&
          query.queryKey[5] === eventId &&
          query.queryKey[6] === currentSubject.personObservationIndex,
      });

      setSelectedWorkerId('');
      setReason('');
      setCommandTracker(null);
    },
    onError: (error) => {
      isSubmittingRef.current = false;
      const formatted = formatIdentityErrorMessage(error);
      setSubmitError(formatted);
      if (
        formatted.includes('Phiên bản xem xét đã thay đổi') ||
        (error as { status?: number }).status === 409
      ) {
        setIsStaleConflict(true);
      }
    },
  });

  const handleReasonChange = (val: string) => {
    setReason(val);
    setSubmitError(null);
    setIsStaleConflict(false);
  };

  const handleWorkerChange = (val: string) => {
    setSelectedWorkerId(val);
    setSubmitError(null);
    setIsStaleConflict(false);
  };

  const handleActionChange = (action: 'RESOLVE' | 'CLEAR') => {
    setActionType(action);
    setSubmitError(null);
    setIsStaleConflict(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmittingRef.current || mutation.isPending) {
      return;
    }

    const reasonValidation = validateReason(reason);
    if (!reasonValidation.valid) {
      setSubmitError(reasonValidation.error ?? 'Lý do không hợp lệ.');
      return;
    }

    if (actionType === 'RESOLVE') {
      if (!currentSubject.canResolve) {
        setSubmitError(
          formatResolveBlockReason(currentSubject.resolveBlockReason) ||
            'Không thể xác nhận đối tượng này.',
        );
        return;
      }
      if (isWorkersPending) {
        setSubmitError('Danh bạ nhân viên đang tải, vui lòng đợi.');
        return;
      }
      if (isWorkersError) {
        setSubmitError('Danh bạ nhân viên gặp lỗi, không thể xác nhận.');
        return;
      }
      if (!selectedWorkerId) {
        setSubmitError('Vui lòng chọn nhân viên trong danh bạ.');
        return;
      }
      const isSelectedWorkerOnCurrentPage = workers.some(
        (w) => w.id === selectedWorkerId && w.isActive,
      );
      if (!isSelectedWorkerOnCurrentPage) {
        setSubmitError(
          'Nhân viên đã chọn không còn hiển thị trên trang danh bạ hiện tại hoặc đã ngừng hoạt động.',
        );
        return;
      }
      if (evidenceIndex === null || !computedBlobSha256) {
        setSubmitError('Chưa có ảnh bằng chứng được xác thực mã băm.');
        return;
      }
      if (!isEvidenceDigestValid) {
        setSubmitError('Mã băm ảnh đã xem không khớp với mô tả bằng chứng của hệ thống.');
        return;
      }

      if (!decodedDimensions || decodedDimensions.width <= 0 || decodedDimensions.height <= 0) {
        setSubmitError('Ảnh bằng chứng không thể giải mã hoặc có kích thước không hợp lệ.');
        return;
      }

      if (evidenceBlob !== null && !isFrameReady) {
        setSubmitError(
          'Khung hình bằng chứng và hộp bao đối tượng chưa sẵn sàng để hiển thị hoặc có kích thước không hợp lệ.',
        );
        return;
      }

      const scope: ObservationIdentityCommandScope = {
        apiUrl,
        sessionScope,
        siteId,
        alertId,
        eventId,
        personObservationIndex: currentSubject.personObservationIndex,
      };

      const params: Extract<ObservationIdentityCommandInput, { action: 'RESOLVE' }> = {
        action: 'RESOLVE',
        expectedRevision: currentSubject.revision,
        expectedEventHash: eventPayloadHash,
        reason: reasonValidation.trimmed,
        workerId: selectedWorkerId,
        evidenceIndex,
        expectedEvidenceSha256: computedBlobSha256,
      };

      const nextTracker = getOrGenerateCommandId(commandTracker, scope, params);
      setCommandTracker(nextTracker);

      const command: ObservationIdentityDecisionCommand = {
        commandId: nextTracker.commandId,
        ...params,
      };

      isSubmittingRef.current = true;
      mutation.mutate(command);
    } else {
      if (!currentSubject.canClear) {
        setSubmitError(
          formatClearBlockReason(currentSubject.clearBlockReason) ||
            'Không thể thu hồi quyết định cho đối tượng này.',
        );
        return;
      }

      const scope: ObservationIdentityCommandScope = {
        apiUrl,
        sessionScope,
        siteId,
        alertId,
        eventId,
        personObservationIndex: currentSubject.personObservationIndex,
      };

      const params: Extract<ObservationIdentityCommandInput, { action: 'CLEAR' }> = {
        action: 'CLEAR',
        expectedRevision: currentSubject.revision,
        expectedEventHash: eventPayloadHash,
        reason: reasonValidation.trimmed,
      };

      const nextTracker = getOrGenerateCommandId(commandTracker, scope, params);
      setCommandTracker(nextTracker);

      const command: ObservationIdentityDecisionCommand = {
        commandId: nextTracker.commandId,
        ...params,
      };

      isSubmittingRef.current = true;
      mutation.mutate(command);
    }
  };

  return (
    <div
      id={tabPanelId}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      className="space-y-3 text-xs focus:outline-hidden"
    >
      {/* Full Frame Evidence with Exact Bounding Box Overlay */}
      {evidenceBlob && (
        <EvidenceFullFrameViewer
          evidenceBlob={evidenceBlob}
          subject={currentSubject}
          naturalDimensions={decodedDimensions}
          isEvidenceDigestValid={isEvidenceDigestValid}
          onReadyChange={setIsFrameReady}
        />
      )}

      {/* Identity Distinction Grid: AI Technical Candidate vs Manual Decision */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* Technical Candidate (Read-only, AI pipeline fact) */}
        <div className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
            <span>Gợi ý kỹ thuật (AI)</span>
            <span className="rounded bg-[#EAEAEA] px-1 py-0.5 text-[10px] text-[#2F3437]">
              {formatTechnicalStatus(currentSubject.technicalIdentity.status)}
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px]">
            {currentSubject.technicalIdentity.candidates.length > 0 ? (
              currentSubject.technicalIdentity.candidates.map((cand, idx) => (
                <div key={idx} className="flex items-center justify-between text-[#2F3437]">
                  <span className="font-mono">{cand.candidateWorkerId ?? 'Chưa rõ'}</span>
                  {cand.similarityScore !== undefined && (
                    <span className="text-[#6B6B6B]">
                      Độ tương đồng: {(cand.similarityScore * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="text-[#787774]">Không có ứng viên nhận diện khuôn mặt</div>
            )}
          </div>
        </div>

        {/* Latest Manual Decision (Immutable human audit head) */}
        <div className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
            <span>Xác minh thủ công gần nhất</span>
            <span className="text-[10px] text-[#787774]">Rev: #{currentSubject.revision}</span>
          </div>
          <div className="mt-1.5 text-[11px]">
            {currentSubject.latestManualDecision ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 font-semibold text-[#2F3437]">
                  {currentSubject.latestManualDecision.action === 'RESOLVE' ? (
                    <>
                      <CheckCircle className="h-3 w-3 text-[#346538]" />
                      <span>Đã xác nhận: {currentSubject.latestManualDecision.workerId}</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 text-[#9F2F2D]" />
                      <span>Đã thu hồi (CLEAR)</span>
                    </>
                  )}
                </div>
                <div className="text-[10px] text-[#6B6B6B]">
                  Lý do: &quot;{currentSubject.latestManualDecision.reason}&quot;
                </div>
              </div>
            ) : (
              <div className="text-[#787774]">Chưa xác minh thủ công</div>
            )}
          </div>
        </div>
      </div>

      {/* Original Zone Entry Decisions (Untouched & Read-only) */}
      <div className="rounded border border-[#EAEAEA] bg-white p-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
          <span>Quyết định vào vùng gốc (Original Zone Decisions - Bất biến)</span>
          <span className="text-[10px] text-[#787774]">
            Tổng: {currentSubject.originalZoneDecisions.total}
          </span>
        </div>
        <div className="mt-1.5 space-y-1">
          {currentSubject.originalZoneDecisions.items.length > 0 ? (
            currentSubject.originalZoneDecisions.items.map((z) => (
              <div
                key={z.id}
                className="flex flex-wrap items-center justify-between gap-1 rounded bg-[#F7F6F3] px-1.5 py-1 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1 text-[10px] font-bold ${
                      z.status === 'ALLOWED'
                        ? 'bg-[#EDF3EC] text-[#346538]'
                        : z.status === 'DENIED'
                          ? 'bg-[#FDEBEC] text-[#9F2F2D]'
                          : 'bg-[#EAEAEA] text-[#6B6B6B]'
                    }`}
                  >
                    {z.status}
                  </span>
                  <span className="text-[#2F3437]">{z.reasonCode}</span>
                </div>
                <span className="text-[10px] text-[#6B6B6B]">
                  {new Date(z.evaluatedAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-[#787774]">
              Không có quyết định kiểm soát vào vùng đã lưu cho sự kiện này.
            </div>
          )}
        </div>
        <div className="mt-1 text-[10px] text-[#787774]">
          * Xác minh thủ công chỉ mang tính hồi cứu cho quan sát này, không cấp quyền ra/vào vùng
          (Zone Access) và không thay đổi các quyết định đã ghi.
        </div>
      </div>

      {/* Evidence Digest Status Check */}
      <div className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-2 text-[11px]">
        <div className="flex items-center justify-between font-semibold text-[#6B6B6B]">
          <span>Kiểm tra toàn vẹn ảnh bằng chứng (Mã băm SHA-256)</span>
          {isEvidenceDigestValid ? (
            <span className="inline-flex items-center gap-1 text-[#346538]">
              <CheckCircle className="h-3 w-3" />
              Đã khớp SHA-256
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#9F2F2D]">
              <Warning className="h-3 w-3" />
              Chưa xác thực
            </span>
          )}
        </div>
        {blobDigestError && <div className="mt-1 text-[#9F2F2D]">{blobDigestError}</div>}
        {dimensionsError && <div className="mt-1 text-[#9F2F2D]">{dimensionsError}</div>}
        {!evidenceBlob && (
          <div className="mt-1 text-[#787774]">
            Ảnh bằng chứng chưa được tải hoặc đã hết hạn. Nút xác nhận mới (RESOLVE) bị vô hiệu hóa;
            nút thu hồi (CLEAR) vẫn khả dụng nếu có quyết định trước đó.
          </div>
        )}
      </div>

      {/* Action Form: RESOLVE vs CLEAR */}
      <form onSubmit={handleSubmit} className="space-y-2.5 rounded border border-[#EAEAEA] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#111111]">Thực hiện đánh giá</span>
          <div className="flex gap-2">
            <label className="flex items-center gap-1 cursor-pointer text-[11px]">
              <input
                type="radio"
                name="actionType"
                checked={actionType === 'RESOLVE'}
                onChange={() => handleActionChange('RESOLVE')}
                disabled={!currentSubject.canResolve}
                className="cursor-pointer"
              />
              <span className={currentSubject.canResolve ? 'text-[#111111]' : 'text-[#A3A09C]'}>
                Xác nhận nhân viên (RESOLVE)
              </span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer text-[11px]">
              <input
                type="radio"
                name="actionType"
                checked={actionType === 'CLEAR'}
                onChange={() => handleActionChange('CLEAR')}
                disabled={!currentSubject.canClear}
                className="cursor-pointer"
              />
              <span className={currentSubject.canClear ? 'text-[#111111]' : 'text-[#A3A09C]'}>
                Thu hồi xác minh (CLEAR)
              </span>
            </label>
          </div>
        </div>

        {/* Block reason notice if disabled */}
        {actionType === 'RESOLVE' && !currentSubject.canResolve && (
          <div className="rounded bg-[#F7F6F3] p-2 text-[11px] text-[#6B6B6B]">
            {formatResolveBlockReason(currentSubject.resolveBlockReason)}
          </div>
        )}

        {actionType === 'CLEAR' && !currentSubject.canClear && (
          <div className="rounded bg-[#F7F6F3] p-2 text-[11px] text-[#6B6B6B]">
            {formatClearBlockReason(currentSubject.clearBlockReason)}
          </div>
        )}

        {/* Worker Picker (Only required for RESOLVE) */}
        {actionType === 'RESOLVE' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label
                htmlFor={workerSelectId}
                className="block text-[11px] font-semibold text-[#6B6B6B]"
              >
                Chọn nhân viên trong danh bạ
              </label>
              {workersTotal > 50 && (
                <div className="flex items-center gap-1 text-[10px] text-[#6B6B6B]">
                  <span>
                    Trang {Math.floor(workerPageOffset / 50) + 1} /{' '}
                    {Math.max(1, Math.ceil(workersTotal / 50))}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleWorkerPageChange(Math.max(0, workerPageOffset - 50))}
                    disabled={workerPageOffset === 0 || isWorkersPending}
                    className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                  >
                    Trước
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWorkerPageChange(workerPageOffset + 50)}
                    disabled={workerPageOffset + 50 >= workersTotal || isWorkersPending}
                    className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                  >
                    Sau
                  </button>
                </div>
              )}
            </div>

            {isWorkersError && (
              <div
                role="alert"
                className="flex items-center justify-between rounded bg-[#FDEBEC] p-1.5 text-[11px] text-[#9F2F2D]"
              >
                <span>Không thể tải danh bạ nhân viên.</span>
                <button
                  type="button"
                  onClick={onRefetchWorkers}
                  className="font-bold underline hover:no-underline"
                >
                  Thử lại
                </button>
              </div>
            )}

            <select
              id={workerSelectId}
              value={selectedWorkerId}
              onChange={(e) => handleWorkerChange(e.target.value)}
              disabled={!currentSubject.canResolve || isWorkersPending || isWorkersError}
              className="mt-1 w-full rounded border border-[#EAEAEA] bg-white px-2 py-1.5 text-xs text-[#2F3437] focus:border-[#111111] focus:outline-hidden disabled:bg-[#F7F6F3] disabled:text-[#A3A09C]"
            >
              {isWorkersPending ? (
                <option value="">Đang tải danh sách nhân viên…</option>
              ) : isWorkersError ? (
                <option value="">Lỗi tải danh sách nhân viên</option>
              ) : workers.length === 0 ? (
                <option value="">Danh bạ công trường chưa có nhân viên nào</option>
              ) : (
                <>
                  <option value="">-- Chọn nhân viên trong danh bạ --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id} disabled={!w.isActive}>
                      {w.displayName} ({w.externalId}) {!w.isActive ? ' - Đã ngừng hoạt động' : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
            <div className="mt-0.5 text-[10px] text-[#787774]">
              Nhà thầu: Không khả dụng (Thông tin thuộc danh bạ hiện hành)
            </div>
          </div>
        )}

        {/* Mandatory Reason Input (>=5 characters) */}
        <div>
          <label htmlFor={reasonInputId} className="block text-[11px] font-semibold text-[#6B6B6B]">
            Lý do đánh giá (Bắt buộc, từ 5 đến 1000 ký tự)
          </label>
          <textarea
            id={reasonInputId}
            rows={2}
            value={reason}
            onChange={(e) => handleReasonChange(e.target.value)}
            placeholder="Nhập lý do xác minh hoặc thu hồi nhận diện đối tượng…"
            className="mt-1 w-full rounded border border-[#EAEAEA] bg-white px-2 py-1 text-xs text-[#2F3437] placeholder-[#A3A09C] focus:border-[#111111] focus:outline-hidden"
          />
        </div>

        {/* Replay Notice */}
        {lastReplayed && (
          <div className="flex items-center gap-1.5 rounded bg-[#EDF3EC] p-2 text-[11px] text-[#346538]">
            <Info className="h-3.5 w-3.5" />
            <span>Lệnh đã được hệ thống ghi nhận trước đó (trùng lặp an toàn).</span>
          </div>
        )}

        {/* Submit / Stale Error Banners */}
        {submitError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-1.5 rounded bg-[#FDEBEC] p-2 text-[11px] text-[#9F2F2D]"
          >
            <span>{submitError}</span>
            {isStaleConflict && (
              <button
                type="button"
                onClick={() => {
                  onRefetchContext();
                  void decisionsQuery.refetch();
                  setSubmitError(null);
                  setIsStaleConflict(false);
                }}
                className="inline-flex items-center gap-1 font-bold underline hover:no-underline"
              >
                <ArrowClockwise className="h-3 w-3" />
                <span>Làm mới dữ liệu</span>
              </button>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={
              mutation.isPending ||
              (actionType === 'RESOLVE' &&
                (!currentSubject.canResolve ||
                  !isEvidenceDigestValid ||
                  !decodedDimensions ||
                  decodedDimensions.width <= 0 ||
                  decodedDimensions.height <= 0 ||
                  (evidenceBlob !== null && !isFrameReady) ||
                  !selectedWorkerId ||
                  isWorkersPending ||
                  isWorkersError ||
                  !workers.some((w) => w.id === selectedWorkerId && w.isActive))) ||
              (actionType === 'CLEAR' && !currentSubject.canClear)
            }
            className="inline-flex items-center gap-1.5 rounded bg-[#111111] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#333333] disabled:cursor-not-allowed disabled:bg-[#EAEAEA] disabled:text-[#A3A09C]"
          >
            {mutation.isPending ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Đang lưu…</span>
              </>
            ) : (
              <span>{actionType === 'RESOLVE' ? 'Xác nhận danh tính' : 'Thu hồi xác minh'}</span>
            )}
          </button>
        </div>
      </form>

      {/* Audit History (Immutable) */}
      <div className="rounded border border-[#EAEAEA] bg-white p-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
          <span className="flex items-center gap-1">
            <ClockCounterClockwise className="h-3 w-3" />
            Lịch sử đánh giá đối tượng (Audit Log)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#787774]">
              Tổng số: {decisionsQuery.data?.total ?? 0}
            </span>
            {(decisionsQuery.data?.total ?? 0) > 20 && (
              <div className="flex items-center gap-1 text-[10px]">
                <span>
                  Trang {Math.floor(historyPageOffset / 20) + 1} /{' '}
                  {Math.max(1, Math.ceil((decisionsQuery.data?.total ?? 0) / 20))}
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryPageOffset((prev) => Math.max(0, prev - 20))}
                  disabled={historyPageOffset === 0}
                  className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryPageOffset((prev) => prev + 20)}
                  disabled={historyPageOffset + 20 >= (decisionsQuery.data?.total ?? 0)}
                  className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            )}
          </div>
        </div>

        {decisionsQuery.isPending && (
          <div className="mt-2 text-center text-[11px] text-[#787774]">
            Đang tải lịch sử đánh giá…
          </div>
        )}

        {decisionsQuery.isError && (
          <div
            role="alert"
            className="mt-2 flex items-center justify-between rounded bg-[#FDEBEC] p-1.5 text-[11px] text-[#9F2F2D]"
          >
            <span>Không thể tải lịch sử đánh giá đối tượng.</span>
            <button
              type="button"
              onClick={() => void decisionsQuery.refetch()}
              className="font-bold underline hover:no-underline"
            >
              Thử lại
            </button>
          </div>
        )}

        {!decisionsQuery.isPending &&
          !decisionsQuery.isError &&
          (!decisionsQuery.data?.items || decisionsQuery.data.items.length === 0) && (
            <div className="mt-1.5 text-[11px] text-[#787774]">
              Chưa có lịch sử đánh giá cho đối tượng này.
            </div>
          )}

        {!decisionsQuery.isPending &&
          !decisionsQuery.isError &&
          decisionsQuery.data?.items &&
          decisionsQuery.data.items.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {decisionsQuery.data.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-1.5 text-[11px]"
                >
                  <div className="flex items-center justify-between font-medium text-[#2F3437]">
                    <span>
                      Rev #{item.revision}:{' '}
                      {item.action === 'RESOLVE' ? `Gán ${item.workerId}` : 'Thu hồi (CLEAR)'}
                    </span>
                    <span className="text-[10px] text-[#6B6B6B]">
                      {new Date(item.recordedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#6B6B6B]">
                    Lý do: &quot;{item.reason}&quot; · Người duyệt: {item.actorUserId}
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

interface EvidenceFullFrameViewerProps {
  evidenceBlob: Blob;
  subject: ObservationIdentitySubjectResponse;
  naturalDimensions: { width: number; height: number } | null;
  isEvidenceDigestValid: boolean;
  onReadyChange?: (ready: boolean) => void;
}

function EvidenceFullFrameViewer({
  evidenceBlob,
  subject,
  naturalDimensions,
  isEvidenceDigestValid,
  onReadyChange,
}: EvidenceFullFrameViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const [blobUrlState, setBlobUrlState] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    let allocatedUrl: string | null = null;
    try {
      allocatedUrl = URL.createObjectURL(evidenceBlob);
    } catch {
      allocatedUrl = null;
    }

    if (allocatedUrl) {
      const urlToSet = allocatedUrl;
      queueMicrotask(() => {
        if (active) {
          setBlobUrlState({ blob: evidenceBlob, url: urlToSet });
        }
      });
    }

    return () => {
      active = false;
      if (allocatedUrl) {
        try {
          URL.revokeObjectURL(allocatedUrl);
        } catch {
          // ignore
        }
      }
    };
  }, [evidenceBlob]);

  const activeObjectUrl =
    evidenceBlob && blobUrlState?.blob === evidenceBlob ? blobUrlState.url : null;

  const [loadedBlob, setLoadedBlob] = useState<Blob | null>(null);
  const [imageErrorBlob, setImageErrorBlob] = useState<Blob | null>(null);

  const handleImageLoad = () => {
    setLoadedBlob(evidenceBlob);
  };

  const handleImageError = () => {
    setImageErrorBlob(evidenceBlob);
  };

  const isImageLoaded = Boolean(evidenceBlob && loadedBlob === evidenceBlob);
  const isImageError = Boolean(evidenceBlob && imageErrorBlob === evidenceBlob);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      } else {
        setContainerSize({ width: 0, height: 0 });
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateSize());
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const box = subject.subjectRef?.personBoundingBox;
  const hasNormalizedBox = Boolean(
    box &&
    Number.isFinite(box.x1) &&
    Number.isFinite(box.y1) &&
    Number.isFinite(box.x2) &&
    Number.isFinite(box.y2) &&
    box.x1 >= 0 &&
    box.y1 >= 0 &&
    box.x2 <= 1 &&
    box.y2 <= 1 &&
    box.x1 < box.x2 &&
    box.y1 < box.y2,
  );

  let overlayRect: { left: number; top: number; width: number; height: number } | null = null;
  if (
    isEvidenceDigestValid &&
    isImageLoaded &&
    hasNormalizedBox &&
    box &&
    naturalDimensions &&
    naturalDimensions.width > 0 &&
    naturalDimensions.height > 0 &&
    containerSize.width > 0 &&
    containerSize.height > 0
  ) {
    const rect = computeBoxOverlayRect(
      box,
      naturalDimensions.width,
      naturalDimensions.height,
      containerSize.width,
      containerSize.height,
    );
    if (rect.valid) {
      const roundPx = (val: number) => Math.round(val * 100) / 100;
      overlayRect = {
        left: roundPx(rect.left),
        top: roundPx(rect.top),
        width: roundPx(rect.width),
        height: roundPx(rect.height),
      };
    }
  }

  useEffect(() => {
    onReadyChange?.(Boolean(isEvidenceDigestValid && isImageLoaded && overlayRect !== null));
  }, [isEvidenceDigestValid, isImageLoaded, overlayRect, onReadyChange]);

  return (
    <div
      data-testid="evidence-frame-container"
      ref={containerRef}
      className="relative flex h-[360px] w-full items-center justify-center overflow-hidden rounded-md border border-[#EAEAEA] bg-[#111111]"
    >
      {activeObjectUrl ? (
        <img
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0 && loadedBlob !== evidenceBlob) {
              handleImageLoad();
            }
          }}
          src={activeObjectUrl}
          alt="Khung hình bằng chứng quan sát"
          onLoad={handleImageLoad}
          onError={handleImageError}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="text-xs text-white/70">Đang chuẩn bị hình ảnh bằng chứng…</div>
      )}

      {isImageError && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-black/80 p-3 text-center text-xs text-[#FDEBEC]"
        >
          <span>Không thể tải hoặc hiển thị ảnh bằng chứng.</span>
        </div>
      )}

      {isImageLoaded && !overlayRect && (
        <div
          role="status"
          className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[11px] text-white/90 shadow-xs"
        >
          {!isEvidenceDigestValid
            ? 'Ảnh bằng chứng chưa được xác thực tính toàn vẹn (SHA-256 không khớp hoặc chưa hoàn tất). Không thể hiển thị hộp bao đối tượng.'
            : !hasNormalizedBox
              ? 'Không có hộp bao đối tượng hợp lệ để hiển thị.'
              : !naturalDimensions || naturalDimensions.width <= 0 || naturalDimensions.height <= 0
                ? 'Không thể giải mã kích thước gốc của ảnh bằng chứng.'
                : containerSize.width <= 0 || containerSize.height <= 0
                  ? 'Khung hiển thị chưa đo lường được kích thước (chiều rộng hoặc chiều cao bằng 0).'
                  : 'Vùng chọn đối tượng nằm ngoài khung hình hiển thị.'}
        </div>
      )}

      {overlayRect && (
        <div
          data-testid="person-bounding-box-overlay"
          style={{
            left: `${overlayRect.left}px`,
            top: `${overlayRect.top}px`,
            width: `${overlayRect.width}px`,
            height: `${overlayRect.height}px`,
            position: 'absolute',
          }}
          className="pointer-events-none rounded-xs border-2 border-[#111111] bg-black/15 shadow-sm"
        >
          <span className="absolute -top-5 left-0 rounded bg-[#111111] px-1 py-0.5 text-[9px] font-bold text-white shadow-xs whitespace-nowrap">
            PERSON #{subject.personObservationIndex}
            {subject.trackId !== null ? ` (Track #${subject.trackId})` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
