import { localizedError } from '../../i18n/messages';
import { localizeMessage } from '../../i18n/messages';
import { localizedLabel } from '../../i18n/labels';
import { uiLocale } from '../../i18n';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowClockwise } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { ShieldCheck } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { User } from '@phosphor-icons/react/dist/csr/User';
import { Warning } from '@phosphor-icons/react/dist/csr/Warning';
import { XCircle } from '@phosphor-icons/react/dist/csr/XCircle';
import {
  ApiError,
  type ObservationIdentityDecisionCommand,
  type ObservationIdentityWorkerResponse,
  type SafetyAlertDetectionResponse,
  type SmartSiteManagementClient,
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

function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 401) return true;
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    (error as { status: unknown }).status === 401
  ) {
    return true;
  }
  return false;
}

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
  onUnauthorized?: () => void;
}

export function ObservationIdentityReviewPanel(props: ObservationIdentityReviewPanelProps) {
  useTranslation();

  if (!props.token || !props.token.trim()) {
    return (
      <div
        role="status"
        data-testid="observation-identity-unauthenticated"
        className="mt-3 rounded-md border border-dashed border-[#D3D1CB] bg-[#F7F6F3] p-4 text-center text-xs text-[#6B6B6B]"
      >
        {tr(
          'observation_identity_review_panel.vui_long_ang_nhap_e_xem_thong_tin_nhan_dien_oi_tuong',
        )}
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
  onUnauthorized,
}: ObservationIdentityReviewPanelProps) {
  useTranslation();

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

  useEffect(() => {
    if (isUnauthorizedError(contextQuery.error)) {
      onUnauthorized?.();
    }
  }, [contextQuery.error, onUnauthorized]);

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

  useEffect(() => {
    if (isUnauthorizedError(workersQuery.error)) {
      onUnauthorized?.();
    }
  }, [workersQuery.error, onUnauthorized]);

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
        digestError =
          err instanceof Error
            ? err.message
            : tr('observation_identity_review_panel.loi_kiem_tra_tinh_toan_ven_cua_anh');
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
              dimensionsError = tr(
                'observation_identity_review_panel.kich_thuoc_anh_a_giai_ma_khong_hop_le_chieu_dai_hoac_chieu_rong_khong_hop_le',
              );
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
            err instanceof Error
              ? err.message
              : tr('observation_identity_review_panel.khong_the_giai_ma_hinh_anh_bang_chung');
        }
      } else {
        // Decoder unavailable -> Fail closed! Never invent dummy dimensions!
        dimensionsError = tr(
          'observation_identity_review_panel.trinh_duyet_khong_ho_tro_giai_ma_anh_bang_chung_thieu_bo_giai_ma_createimagebitmap',
        );
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
    (evidenceBlob && !activeBlobAudit
      ? tr('observation_identity_review_panel.ang_kiem_tra_va_giai_ma_anh_bang_chung')
      : null);

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
        <span>{tr('observation_identity_review_panel.ang_tai_du_lieu_nhan_dien_oi_tuong')}</span>
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
          <span>{tr('common.thu_lai')}</span>
        </button>
      </div>
    );
  }

  // Empty Subjects
  if (subjects.length === 0) {
    return (
      <div className="rounded-md border border-[#EAEAEA] bg-[#F7F6F3] p-3 text-[11px] text-[#6B6B6B]">
        {tr('observation_identity_review_panel.khong_co_oi_tuong_person_nao_trong_su_kien_nay')}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#EAEAEA] bg-white p-3 shadow-xs">
      {/* Header & Subject Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAEAEA] pb-2.5">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-[#111111]" aria-hidden="true" />
          <span className="text-xs font-semibold text-[#111111]">
            {tr('observation_identity_review_panel.xac_minh_nguoi_trong_anh')}
          </span>
        </div>
        <div
          className="flex flex-wrap gap-1"
          role="tablist"
          aria-label={tr('observation_identity_review_panel.danh_sach_oi_tuong_nguoi')}
        >
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
                <span>{tr('common.person_value', { value1: sub.personObservationIndex })}</span>
                {sub.trackId !== null && (
                  <span className="opacity-70">
                    {tr('common.track_value', { value1: sub.trackId })}
                  </span>
                )}
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
          onUnauthorized={onUnauthorized}
        />
      ) : (
        <div
          data-testid="no-subject-selected-notice"
          className="rounded-md border border-dashed border-[#D3D1CB] bg-[#F7F6F3] p-4 text-center text-xs text-[#6B6B6B]"
        >
          {tr(
            'observation_identity_review_panel.vui_long_chon_mot_oi_tuong_person_ben_tren_e_xem_xet_danh_tinh_hoac_nhap_quyet_inh',
          )}
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
  onUnauthorized?: () => void;
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
  onUnauthorized,
}: ObservationIdentitySubjectFormProps) {
  useTranslation();

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
  const isMountedRef = useRef<boolean>(true);
  const mutationAbortControllerRef = useRef<AbortController | null>(null);

  const handleWorkerPageChange = (newOffset: number) => {
    setSelectedWorkerId('');
    setSubmitError(null);
    setIsStaleConflict(false);
    onWorkerPageChange(newOffset);
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
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

  useEffect(() => {
    if (isUnauthorizedError(decisionsQuery.error)) {
      onUnauthorized?.();
    }
  }, [decisionsQuery.error, onUnauthorized]);

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
      // Abort is advisory: a retired subject/session must ignore a late transport result.
      if (!isMountedRef.current) return;
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
      if (!isMountedRef.current) return;
      isSubmittingRef.current = false;
      const formatted = formatIdentityErrorMessage(error);
      setSubmitError(formatted);
      if (
        formatted.includes(tr('observation_identity_review_panel.phien_ban_xem_xet_a_thay_oi')) ||
        (error as { status?: number }).status === 409
      ) {
        setIsStaleConflict(true);
      }
      if (isUnauthorizedError(error)) {
        onUnauthorized?.();
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
      setSubmitError(
        reasonValidation.error ?? tr('observation_identity_review_panel.ly_do_khong_hop_le'),
      );
      return;
    }

    if (actionType === 'RESOLVE') {
      if (!currentSubject.canResolve) {
        setSubmitError(
          formatResolveBlockReason(currentSubject.resolveBlockReason) ||
            tr('observation_identity_review_panel.khong_the_xac_nhan_oi_tuong_nay'),
        );
        return;
      }
      if (isWorkersPending) {
        setSubmitError(
          tr('observation_identity_review_panel.danh_ba_nhan_vien_ang_tai_vui_long_oi'),
        );
        return;
      }
      if (isWorkersError) {
        setSubmitError(
          tr('observation_identity_review_panel.danh_ba_nhan_vien_gap_loi_khong_the_xac_nhan'),
        );
        return;
      }
      if (!selectedWorkerId) {
        setSubmitError(
          tr('observation_identity_review_panel.vui_long_chon_nhan_vien_trong_danh_ba'),
        );
        return;
      }
      const isSelectedWorkerOnCurrentPage = workers.some(
        (w) => w.id === selectedWorkerId && w.isActive,
      );
      if (!isSelectedWorkerOnCurrentPage) {
        setSubmitError(
          tr(
            'observation_identity_review_panel.nhan_vien_a_chon_khong_con_hien_thi_tren_trang_danh_ba_hien_tai_hoac_a_ngung_hoat',
          ),
        );
        return;
      }
      if (evidenceIndex === null || !computedBlobSha256) {
        setSubmitError(
          tr('observation_identity_review_panel.chua_co_anh_bang_chung_uoc_xac_thuc_ma_bam'),
        );
        return;
      }
      if (!isEvidenceDigestValid) {
        setSubmitError(
          tr(
            'observation_identity_review_panel.ma_bam_anh_a_xem_khong_khop_voi_mo_ta_bang_chung_cua_he_thong',
          ),
        );
        return;
      }

      if (!decodedDimensions || decodedDimensions.width <= 0 || decodedDimensions.height <= 0) {
        setSubmitError(
          tr(
            'observation_identity_review_panel.anh_bang_chung_khong_the_giai_ma_hoac_co_kich_thuoc_khong_hop_le',
          ),
        );
        return;
      }

      if (evidenceBlob !== null && !isFrameReady) {
        setSubmitError(
          tr(
            'observation_identity_review_panel.khung_hinh_bang_chung_va_hop_bao_oi_tuong_chua_san_sang_e_hien_thi_hoac_co_kich_th',
          ),
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
            tr('observation_identity_review_panel.khong_the_thu_hoi_quyet_inh_cho_oi_tuong_nay'),
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
            <span>{tr('observation_identity_review_panel.goi_y_ky_thuat_ai')}</span>
            <span className="rounded bg-[#EAEAEA] px-1 py-0.5 text-[10px] text-[#2F3437]">
              {formatTechnicalStatus(currentSubject.technicalIdentity.status)}
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11px]">
            {currentSubject.technicalIdentity.candidates.length > 0 ? (
              currentSubject.technicalIdentity.candidates.map((cand, idx) => (
                <div key={idx} className="flex items-center justify-between text-[#2F3437]">
                  <span className="font-mono">
                    {cand.candidateWorkerId ?? tr('common.chua_ro')}
                  </span>
                  {cand.similarityScore !== undefined && (
                    <span className="text-[#6B6B6B]">
                      {tr('observation_identity_review_panel.o_tuong_ong_value', {
                        value1: (cand.similarityScore * 100).toFixed(0),
                      })}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <div className="text-[#787774]">
                {tr('observation_identity_review_panel.khong_co_ung_vien_nhan_dien_khuon_mat')}
              </div>
            )}
          </div>
        </div>

        {/* Latest Manual Decision (Immutable human audit head) */}
        <div className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
            <span>{tr('observation_identity_review_panel.xac_minh_thu_cong_gan_nhat')}</span>
            <span className="text-[10px] text-[#787774]">
              {tr('common.rev_value', { value1: currentSubject.revision })}
            </span>
          </div>
          <div className="mt-1.5 text-[11px]">
            {currentSubject.latestManualDecision ? (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 font-semibold text-[#2F3437]">
                  {currentSubject.latestManualDecision.action === 'RESOLVE' ? (
                    <>
                      <CheckCircle className="h-3 w-3 text-[#346538]" />
                      <span>
                        {tr('observation_identity_review_panel.a_xac_nhan_value', {
                          value1: currentSubject.latestManualDecision.workerId,
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3 w-3 text-[#9F2F2D]" />
                      <span>{tr('observation_identity_review_panel.a_thu_hoi_clear')}</span>
                    </>
                  )}
                </div>
                <div className="text-[10px] text-[#6B6B6B]">
                  {tr('common.ly_do_quot_value_quot', {
                    value1: currentSubject.latestManualDecision.reason,
                  })}
                </div>
              </div>
            ) : (
              <div className="text-[#787774]">
                {tr('observation_identity_review_panel.chua_xac_minh_thu_cong')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Original Zone Entry Decisions (Untouched & Read-only) */}
      <div className="rounded border border-[#EAEAEA] bg-white p-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
          <span>
            {tr(
              'observation_identity_review_panel.quyet_inh_vao_vung_goc_original_zone_decisions_bat_bien',
            )}
          </span>
          <span className="text-[10px] text-[#787774]">
            {tr('common.tong_value', { value1: currentSubject.originalZoneDecisions.total })}
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
                    {localizedLabel(z.status)}
                  </span>
                  <span className="text-[#2F3437]">{localizedLabel(z.reasonCode)}</span>
                </div>
                <span className="text-[10px] text-[#6B6B6B]">
                  {new Date(z.evaluatedAt).toLocaleTimeString(uiLocale())}
                </span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-[#787774]">
              {tr(
                'observation_identity_review_panel.khong_co_quyet_inh_kiem_soat_vao_vung_a_luu_cho_su_kien_nay',
              )}
            </div>
          )}
        </div>
        <div className="mt-1 text-[10px] text-[#787774]">
          {tr(
            'observation_identity_review_panel.xac_minh_thu_cong_chi_mang_tinh_hoi_cuu_cho_quan_sat_nay_khong_cap_quyen_ra_vao_vu',
          )}
        </div>
      </div>

      {/* Evidence Digest Status Check */}
      <div className="rounded border border-[#EAEAEA] bg-[#F7F6F3] p-2 text-[11px]">
        <div className="flex items-center justify-between font-semibold text-[#6B6B6B]">
          <span>
            {tr(
              'observation_identity_review_panel.kiem_tra_toan_ven_anh_bang_chung_ma_bam_sha_256',
            )}
          </span>
          {isEvidenceDigestValid ? (
            <span className="inline-flex items-center gap-1 text-[#346538]">
              <CheckCircle className="h-3 w-3" />
              {tr('common.a_khop_sha_256')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#9F2F2D]">
              <Warning className="h-3 w-3" />
              {tr('common.chua_xac_thuc')}
            </span>
          )}
        </div>
        {blobDigestError && (
          <div className="mt-1 text-[#9F2F2D]">{localizedError(blobDigestError ?? undefined)}</div>
        )}
        {dimensionsError && (
          <div className="mt-1 text-[#9F2F2D]">{localizedError(dimensionsError ?? undefined)}</div>
        )}
        {!evidenceBlob && (
          <div className="mt-1 text-[#787774]">
            {tr(
              'observation_identity_review_panel.anh_bang_chung_chua_uoc_tai_hoac_a_het_han_nut_xac_nhan_moi_resolve_bi_vo_hieu_hoa',
            )}
          </div>
        )}
      </div>

      {/* Action Form: RESOLVE vs CLEAR */}
      <form onSubmit={handleSubmit} className="space-y-2.5 rounded border border-[#EAEAEA] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#111111]">
            {tr('observation_identity_review_panel.thuc_hien_anh_gia')}
          </span>
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
                {tr('observation_identity_review_panel.xac_nhan_nhan_vien_resolve')}
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
                {tr('observation_identity_review_panel.thu_hoi_xac_minh_clear')}
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
                {tr('observation_identity_review_panel.chon_nhan_vien_trong_danh_ba')}
              </label>
              {workersTotal > 50 && (
                <div className="flex items-center gap-1 text-[10px] text-[#6B6B6B]">
                  <span>
                    {tr('observation_identity_review_panel.trang_value_value', {
                      value1: Math.floor(workerPageOffset / 50) + 1,
                      value2: Math.max(1, Math.ceil(workersTotal / 50)),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleWorkerPageChange(Math.max(0, workerPageOffset - 50))}
                    disabled={workerPageOffset === 0 || isWorkersPending}
                    className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                  >
                    {tr('common.truoc')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleWorkerPageChange(workerPageOffset + 50)}
                    disabled={workerPageOffset + 50 >= workersTotal || isWorkersPending}
                    className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                  >
                    {tr('common.sau')}
                  </button>
                </div>
              )}
            </div>

            {isWorkersError && (
              <div
                role="alert"
                className="flex items-center justify-between rounded bg-[#FDEBEC] p-1.5 text-[11px] text-[#9F2F2D]"
              >
                <span>
                  {tr('observation_identity_review_panel.khong_the_tai_danh_ba_nhan_vien')}
                </span>
                <button
                  type="button"
                  onClick={onRefetchWorkers}
                  className="font-bold underline hover:no-underline"
                >
                  {tr('common.thu_lai')}
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
                <option value="">
                  {tr('observation_identity_review_panel.ang_tai_danh_sach_nhan_vien')}
                </option>
              ) : isWorkersError ? (
                <option value="">
                  {tr('observation_identity_review_panel.loi_tai_danh_sach_nhan_vien')}
                </option>
              ) : workers.length === 0 ? (
                <option value="">
                  {tr(
                    'observation_identity_review_panel.danh_ba_cong_truong_chua_co_nhan_vien_nao',
                  )}
                </option>
              ) : (
                <>
                  <option value="">
                    {tr('observation_identity_review_panel.chon_nhan_vien_trong_danh_ba_ea4b72')}
                  </option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id} disabled={!w.isActive}>
                      {w.displayName} ({w.externalId}){' '}
                      {!w.isActive ? tr('observation_identity_review_panel.a_ngung_hoat_ong') : ''}
                    </option>
                  ))}
                </>
              )}
            </select>
            <div className="mt-0.5 text-[10px] text-[#787774]">
              {tr(
                'observation_identity_review_panel.nha_thau_khong_kha_dung_thong_tin_thuoc_danh_ba_hien_hanh',
              )}
            </div>
          </div>
        )}

        {/* Mandatory Reason Input (>=5 characters) */}
        <div>
          <label htmlFor={reasonInputId} className="block text-[11px] font-semibold text-[#6B6B6B]">
            {tr('observation_identity_review_panel.ly_do_anh_gia_bat_buoc_tu_5_en_1000_ky_tu')}
          </label>
          <textarea
            id={reasonInputId}
            rows={2}
            value={reason}
            onChange={(e) => handleReasonChange(e.target.value)}
            placeholder={tr(
              'observation_identity_review_panel.nhap_ly_do_xac_minh_hoac_thu_hoi_nhan_dien_oi_tuong',
            )}
            className="mt-1 w-full rounded border border-[#EAEAEA] bg-white px-2 py-1 text-xs text-[#2F3437] placeholder-[#A3A09C] focus:border-[#111111] focus:outline-hidden"
          />
        </div>

        {/* Replay Notice */}
        {lastReplayed && (
          <div className="flex items-center gap-1.5 rounded bg-[#EDF3EC] p-2 text-[11px] text-[#346538]">
            <Info className="h-3.5 w-3.5" />
            <span>
              {tr(
                'observation_identity_review_panel.lenh_a_uoc_he_thong_ghi_nhan_truoc_o_trung_lap_an_toan',
              )}
            </span>
          </div>
        )}

        {/* Submit / Stale Error Banners */}
        {submitError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-1.5 rounded bg-[#FDEBEC] p-2 text-[11px] text-[#9F2F2D]"
          >
            <span>{localizeMessage(submitError)}</span>
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
                <span>{tr('observation_identity_review_panel.lam_moi_du_lieu')}</span>
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
                <span>{tr('common.ang_luu')}</span>
              </>
            ) : (
              <span>
                {actionType === 'RESOLVE'
                  ? tr('observation_identity_review_panel.xac_nhan_danh_tinh')
                  : tr('observation_identity_review_panel.thu_hoi_xac_minh')}
              </span>
            )}
          </button>
        </div>
      </form>

      {/* Audit History (Immutable) */}
      <div className="rounded border border-[#EAEAEA] bg-white p-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#6B6B6B]">
          <span className="flex items-center gap-1">
            <ClockCounterClockwise className="h-3 w-3" />
            {tr('observation_identity_review_panel.lich_su_anh_gia_oi_tuong_audit_log')}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#787774]">
              {tr('common.tong_so_value', { value1: decisionsQuery.data?.total ?? 0 })}
            </span>
            {(decisionsQuery.data?.total ?? 0) > 20 && (
              <div className="flex items-center gap-1 text-[10px]">
                <span>
                  {tr('observation_identity_review_panel.trang_value_value', {
                    value1: Math.floor(historyPageOffset / 20) + 1,
                    value2: Math.max(1, Math.ceil((decisionsQuery.data?.total ?? 0) / 20)),
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryPageOffset((prev) => Math.max(0, prev - 20))}
                  disabled={historyPageOffset === 0}
                  className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                >
                  {tr('common.truoc')}
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryPageOffset((prev) => prev + 20)}
                  disabled={historyPageOffset + 20 >= (decisionsQuery.data?.total ?? 0)}
                  className="rounded border border-[#EAEAEA] px-1 py-0.5 hover:bg-[#F7F6F3] disabled:opacity-40"
                >
                  {tr('common.sau')}
                </button>
              </div>
            )}
          </div>
        </div>

        {decisionsQuery.isPending && (
          <div className="mt-2 text-center text-[11px] text-[#787774]">
            {tr('observation_identity_review_panel.ang_tai_lich_su_anh_gia')}
          </div>
        )}

        {decisionsQuery.isError && (
          <div
            role="alert"
            className="mt-2 flex items-center justify-between rounded bg-[#FDEBEC] p-1.5 text-[11px] text-[#9F2F2D]"
          >
            <span>
              {tr('observation_identity_review_panel.khong_the_tai_lich_su_anh_gia_oi_tuong')}
            </span>
            <button
              type="button"
              onClick={() => void decisionsQuery.refetch()}
              className="font-bold underline hover:no-underline"
            >
              {tr('common.thu_lai')}
            </button>
          </div>
        )}

        {!decisionsQuery.isPending &&
          !decisionsQuery.isError &&
          (!decisionsQuery.data?.items || decisionsQuery.data.items.length === 0) && (
            <div className="mt-1.5 text-[11px] text-[#787774]">
              {tr('observation_identity_review_panel.chua_co_lich_su_anh_gia_cho_oi_tuong_nay')}
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
                      {tr('common.rev_value_value', {
                        value1: item.revision,
                        value2:
                          item.action === 'RESOLVE'
                            ? tr('messages.e6fc7e4c3516', { value1: item.workerId })
                            : tr('common.thu_hoi_clear'),
                      })}
                    </span>
                    <span className="text-[10px] text-[#6B6B6B]">
                      {new Date(item.recordedAt).toLocaleString(uiLocale())}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#6B6B6B]">
                    {tr(
                      'observation_identity_review_panel.ly_do_quot_value_quot_nguoi_duyet_value',
                      { value1: item.reason, value2: item.actorUserId },
                    )}
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
  useTranslation();

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
          alt={tr('observation_identity_review_panel.khung_hinh_bang_chung_quan_sat')}
          onLoad={handleImageLoad}
          onError={handleImageError}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="text-xs text-white/70">
          {tr('observation_identity_review_panel.ang_chuan_bi_hinh_anh_bang_chung')}
        </div>
      )}

      {isImageError && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-black/80 p-3 text-center text-xs text-[#FDEBEC]"
        >
          <span>
            {tr('observation_identity_review_panel.khong_the_tai_hoac_hien_thi_anh_bang_chung')}
          </span>
        </div>
      )}

      {isImageLoaded && !overlayRect && (
        <div
          role="status"
          className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[11px] text-white/90 shadow-xs"
        >
          {!isEvidenceDigestValid
            ? tr(
                'observation_identity_review_panel.anh_bang_chung_chua_uoc_xac_thuc_tinh_toan_ven_sha_256_khong_khop_hoac_chua_hoan_t',
              )
            : !hasNormalizedBox
              ? tr('observation_identity_review_panel.khong_co_hop_bao_oi_tuong_hop_le_e_hien_thi')
              : !naturalDimensions || naturalDimensions.width <= 0 || naturalDimensions.height <= 0
                ? tr(
                    'observation_identity_review_panel.khong_the_giai_ma_kich_thuoc_goc_cua_anh_bang_chung',
                  )
                : containerSize.width <= 0 || containerSize.height <= 0
                  ? tr(
                      'observation_identity_review_panel.khung_hien_thi_chua_o_luong_uoc_kich_thuoc_chieu_rong_hoac_chieu_cao_bang_0',
                    )
                  : tr(
                      'observation_identity_review_panel.vung_chon_oi_tuong_nam_ngoai_khung_hinh_hien_thi',
                    )}
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
            {tr('common.person_valuevalue', {
              value1: subject.personObservationIndex,
              value2:
                subject.trackId !== null
                  ? tr('messages.1e50a92b018d', { value1: subject.trackId })
                  : '',
            })}
          </span>
        </div>
      )}
    </div>
  );
}
