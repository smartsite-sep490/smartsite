import { localizedError, localizeMessage } from '../../../i18n/messages';
import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { FaceGateDecisionResponse, FaceGateVerificationResponse } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import type {
  QrFallbackResponse,
  VerifyQrCommand,
  AccessAttemptResponse,
  GateEventResponse,
} from '@smartsite/contracts';
import { QrScannerView } from './QrScannerView';
import { inspectGateCamera } from '../enrollment/gateCameraReadiness';
import { GateCameraSession } from '../enrollment/gateCameraSession';
import {
  IconAlertTriangle,
  IconBuilding2,
  IconCamera,
  IconCheck,
  IconClock,
  IconKey,
  IconRefresh,
  IconShield,
  IconX,
} from '../../icons';
import {
  captureFrameBlob,
  createSafePreviewUrl,
  getSafeReasonMessage,
  resolveGateUiState,
  revokeSafePreviewUrl,
  retainGateWorker,
} from '../enrollment/faceGateUtils';

export interface GateDeskEventRecord {
  id: string;
  timestamp: string;
  workerName: string;
  workerExternalId: string;
  contractorName: string;
  direction: 'IN' | 'OUT';
  method: 'FACE' | 'QR' | 'MANUAL';
  outcome: 'ALLOWED' | 'DENIED' | 'MANUAL_REVIEW';
  reasonCode: string;
  gateName: string;
}

export interface SecurityGateDeskViewProps {
  canManualVerify?: boolean;
  apiUrl: string;
  token?: string;
  sessionScope: string;
  selectedSiteId: string;
  sites: Array<{ id: string; name: string }>;
  onSelectSite: (siteId: string) => void;
}

const gates = SITE_GATES;

function getGateFaceMessage(reasonCode: string): string {
  const map: Record<string, string> = {
    FACE_QUALITY_ACCEPTED: tr('common.face_quality_accepted'),
    FACE_NOT_FOUND: tr('security_gate_desk_view.no_face_detected_position_face_within_viewfinder'),
    FACE_MULTIPLE_FOUND: tr(
      'security_gate_desk_view.multiple_faces_detected_only_one_person_at_a_time',
    ),
    FACE_TOO_SMALL: tr('worker_enrollment_view.face_is_too_far_step_closer_to_the_camera'),
    FACE_TOO_CLOSE: tr('security_gate_desk_view.face_is_too_close_step_back_slightly'),
    FACE_CLIPPED: tr('security_gate_desk_view.face_clipped_at_edge_center_your_face'),
    FACE_NOT_CENTERED: tr('security_gate_desk_view.face_off_center_align_with_center_frame'),
    FACE_TOO_DARK: tr('worker_enrollment_view.lighting_too_dim_face_toward_a_light_source'),
    FACE_TOO_BRIGHT: tr('security_gate_desk_view.lighting_too_bright_avoid_strong_direct_glare'),
    FACE_BLURRY: tr('security_gate_desk_view.image_blurry_hold_still_during_scan'),
    FACE_HEAD_TILTED: tr('security_gate_desk_view.head_is_tilted_keep_head_upright'),
    FACE_TURN_TOO_FAR: tr('security_gate_desk_view.turned_too_far_face_the_camera_directly'),
    FACE_POSE_FRONT_REQUIRED: tr('security_gate_desk_view.look_directly_at_the_camera'),
    FACE_NOT_CLEAR: tr(
      'security_gate_desk_view.face_not_clearly_visible_hold_still_and_remove_coverings',
    ),
    FACE_LANDMARKS_UNAVAILABLE: tr(
      'security_gate_desk_view.facial_landmarks_not_clear_remove_coverings_and_pose_directly',
    ),
    FACE_IMAGE_INVALID: tr('security_gate_desk_view.image_unreadable_hold_still_for_retake'),
  };
  return (
    map[reasonCode] ??
    tr('security_gate_desk_view.face_quality_insufficient_adjust_position_and_hold_still')
  );
}

export function SecurityGateDeskView({
  canManualVerify = false,
  apiUrl,
  token,
  sessionScope,
  selectedSiteId,
  sites,
  onSelectSite,
}: SecurityGateDeskViewProps) {
  useTranslation();

  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  // Gate selection & direction
  const [selectedGateId, setSelectedGateId] = useState<string>(gates[0]?.id ?? '');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraMountedRef = useRef(false);
  const cameraSessionRef = useRef<GateCameraSession | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const cameraDeviceRef = useRef('');
  const scanGeneration = useRef(0);
  useEffect(
    () => () => {
      scanGeneration.current += 1;
    },
    [apiUrl, sessionScope, selectedSiteId, selectedGateId, direction, token],
  );
  const scanBusy = useRef(false);
  const presenceSession = useRef('');
  const [scanMessage, setScanMessage] = useState(tr('common.awaiting_face'));

  // In-memory frame preview (never stored in localStorage/sessionStorage)
  const capturedPreviewUrlRef = useRef<string | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);

  // Verification state
  const [isScanning, setIsScanning] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [lastDecision, setLastDecision] = useState<FaceGateDecisionResponse | null>(null);
  const [currentAttempt, setCurrentAttempt] = useState<AccessAttemptResponse | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [repeatNotice, setRepeatNotice] = useState('');
  const [separatePassage, setSeparatePassage] = useState(false);
  const [confirmedEvent, setConfirmedEvent] = useState<GateEventResponse | null>(null);
  const [manualWorkerId, setManualWorkerId] = useState('');
  const [manualIdentityConfirmed, setManualIdentityConfirmed] = useState(false);
  const handleNoScheduleDenial = useCallback(() => {
    setCurrentAttempt((attempt) =>
      attempt ? { ...attempt, status: 'DENIED', scheduleStatus: 'NO_SCHEDULE' } : null,
    );
    setLastDecision({
      technicalOutcome: 'MATCHED',
      authorization: 'DENIED',
      reasonCode: 'NO_SCHEDULE',
      qrFallbackAllowed: false,
    });
    setScanMessage(getSafeReasonMessage('NO_SCHEDULE'));
    setConfirmedEvent(null);
    setRepeatNotice('');
    setSeparatePassage(false);
  }, []);
  const manualWorkers = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, selectedSiteId, 'manual-worker-choices'],
    enabled: canManualVerify && !!token && !!selectedSiteId,
    queryFn: () => client.listWorkers(token!, selectedSiteId, { limit: 100 }),
  });
  const manualRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const manual = useMutation({
    mutationFn: () => {
      const fingerprint = JSON.stringify([
        selectedSiteId,
        selectedGateId,
        direction,
        manualWorkerId,
        reviewNote,
      ]);
      if (manualRequest.current?.fingerprint !== fingerprint)
        manualRequest.current = { fingerprint, id: crypto.randomUUID() };
      return client.manuallyVerifyWorker(token!, selectedSiteId, selectedGateId, {
        requestId: manualRequest.current.id,
        workerId: manualWorkerId,
        direction,
        identityConfirmed: true,
        reviewNote: reviewNote.trim(),
      });
    },
    onSuccess: (attempt) => {
      const worker = manualWorkers.data?.items.find((w) => w.id === manualWorkerId);
      setCurrentAttempt(attempt);
      setLastDecision(null);
      setCandidateWorker(
        worker
          ? {
              id: worker.id,
              userId: worker.userId ?? null,
              username: '',
              externalId: worker.externalId,
              displayName: worker.displayName,
              contractorName: '',
              assignmentStatus: attempt.status,
            }
          : null,
      );
    },
  });
  const passageKey = useRef<{ attemptId: string; idempotencyKey: string } | null>(null);
  const passage = useMutation({
    mutationFn: () => {
      if (!currentAttempt) throw new Error(tr('security_gate_desk_view.verify_the_worker_first'));
      if (passageKey.current?.attemptId !== currentAttempt.id)
        passageKey.current = { attemptId: currentAttempt.id, idempotencyKey: crypto.randomUUID() };
      return client.confirmGatePassage(token!, selectedSiteId, currentAttempt.id, {
        idempotencyKey: passageKey.current.idempotencyKey,
        reviewNote: reviewNote.trim() || undefined,
        separatePassage: separatePassage || undefined,
      });
    },
    onSuccess: (event) => {
      setRepeatNotice('');
      setSeparatePassage(false);
      setCurrentAttempt(null);
      setConfirmedEvent(event);
      void queryClient.invalidateQueries({
        queryKey: ['attendance', apiUrl, sessionScope, selectedSiteId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['attendance-days', apiUrl, sessionScope, selectedSiteId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId],
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.backendError?.code === 'WORKER_NO_SCHEDULE') {
        handleNoScheduleDenial();
        return;
      }
      if (
        error instanceof ApiError &&
        error.backendError?.code === 'GATE_PASSAGE_ALREADY_RECORDED'
      ) {
        setRepeatNotice(error.message);
        setSeparatePassage(false);
        setReviewNote('');
      }
    },
  });
  const [candidateWorker, setCandidateWorker] = useState<
    FaceGateVerificationResponse['worker'] | null
  >(null);

  // QR Fallback modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrCodeInput, setQrCodeInput] = useState('');
  const [fallback, setFallback] = useState<QrFallbackResponse | null>(null);
  const [qrResultMessage, setQrResultMessage] = useState('');
  const qrCommand = useRef<VerifyQrCommand | null>(null);
  const fallbackMutation = useMutation({
    mutationFn: () =>
      client.openCameraQrFallback(token!, selectedSiteId, selectedGateId, direction),
    onSuccess: (r) => {
      setFallback(r);
      setQrModalOpen(true);
    },
  });
  const qrVerification = useMutation({
    mutationFn: (input: VerifyQrCommand) =>
      client.verifyWorkerQr(token!, selectedSiteId, selectedGateId, input),
    onSuccess: (r) => {
      setRepeatNotice('');
      setSeparatePassage(false);
      setQrResultMessage(
        `${r.authorization}: ${r.worker.displayName} · ${getSafeReasonMessage(r.reasonCode)}`,
      );
      setCandidateWorker(r.worker);
      setCurrentAttempt(r.attempt ?? null);
      setQrCodeInput('');
      setFallback(null);
      qrCommand.current = null;
      void queryClient.invalidateQueries({
        queryKey: ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId],
      });
    },
  });
  const qrProcessing = qrVerification.isPending;

  // Recent Gate Events log
  const logQueryKey = ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId];
  const accessLogs = useQuery({
    queryKey: logQueryKey,
    enabled: !!token && !!selectedSiteId,
    queryFn: () => client.listGateAccessLogs(token!, selectedSiteId, selectedGateId),
  });
  const recentEvents: GateDeskEventRecord[] = (accessLogs.data?.items ?? []).map((log) => ({
    id: log.id,
    timestamp: new Date(log.createdAt).toLocaleString(uiLocale()),
    workerName: log.workerName ?? tr('common.unknown'),
    workerExternalId: log.workerExternalId ?? '—',
    contractorName: log.contractorName ?? '—',
    direction: log.direction,
    method: log.method ?? 'FACE',
    outcome: log.decision.authorization,
    reasonCode: log.decision.reasonCode,
    gateName: gates.find((gate) => gate.id === log.gateId)?.name ?? log.gateId,
  }));

  // Safe preview URL update helper
  const updateCapturedPreview = useCallback((blob: Blob | null) => {
    if (!blob) {
      if (capturedPreviewUrlRef.current) {
        revokeSafePreviewUrl(capturedPreviewUrlRef.current);
        capturedPreviewUrlRef.current = null;
      }
      setCapturedPreviewUrl(null);
      return;
    }
    const newUrl = createSafePreviewUrl(blob, capturedPreviewUrlRef.current);
    capturedPreviewUrlRef.current = newUrl;
    setCapturedPreviewUrl(newUrl);
  }, []);

  // Initialize and tear down webcam
  const startCamera = useCallback(() => {
    setCameraActive(false);
    setCameraError(null);
    return cameraSessionRef.current?.start(cameraDeviceRef.current);
  }, []);

  const stopCamera = useCallback(() => {
    scanGeneration.current += 1;
    presenceSession.current = '';
    cameraSessionRef.current?.stop();
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    cameraMountedRef.current = true;
    const cameraSession = new GateCameraSession({
      video: () => videoRef.current,
      ready: (devices, deviceId) => {
        setCameraError(null);
        setCameraActive(true);
        setCameraDevices(devices);
        cameraDeviceRef.current = deviceId;
        setCameraDeviceId(deviceId);
      },
      failed: (message) => {
        scanGeneration.current += 1;
        presenceSession.current = '';
        setCameraActive(false);
        setCameraError(message);
        setIsScanning(false);
        setScanMessage(message);
      },
    });
    cameraSessionRef.current = cameraSession;
    void cameraSession.start(cameraDeviceRef.current);
    return () => {
      cameraMountedRef.current = false;
      scanGeneration.current += 1;
      presenceSession.current = '';
      cameraSession.stop();
      cameraSessionRef.current = null;
      if (capturedPreviewUrlRef.current) {
        revokeSafePreviewUrl(capturedPreviewUrlRef.current);
        capturedPreviewUrlRef.current = null;
      }
    };
  }, [updateCapturedPreview]);

  // Presence checks do not create gate events; only a confirmed new face is verified.
  const handleScanFace = useCallback(async () => {
    if (scanBusy.current || !token || !selectedSiteId) return;
    const video = videoRef.current;
    if (!video || !cameraActive) {
      setCameraError(tr('security_gate_desk_view.webcam_feed_is_not_running'));
      return;
    }

    scanBusy.current = true;
    const generation = scanGeneration.current;

    try {
      const blocked = inspectGateCamera(video);
      if (blocked) {
        setScanMessage(blocked);
        return;
      }
      const frameBlob = await captureFrameBlob(video, { maxWidth: 1280, quality: 0.9 });
      if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
      if (!presenceSession.current) presenceSession.current = crypto.randomUUID();
      const presence = await client.observeGateFace(
        token!,
        selectedSiteId,
        selectedGateId,
        presenceSession.current,
        frameBlob,
      );
      if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
      if (presence.state !== 'NEW_FACE' && presence.state !== 'AI_UNAVAILABLE') {
        if (presence.state === 'SAME_FACE')
          setScanMessage(
            tr(
              'security_gate_desk_view.worker_already_scanned_awaiting_next_worker_or_step_out_of_frame',
            ),
          );
        else if (presence.state === 'WAITING') {
          setScanMessage(tr('security_gate_desk_view.face_detected_hold_still_to_verify'));
        } else {
          setScanMessage(getGateFaceMessage(presence.reasonCode));
        }
        return;
      }
      setIsScanning(true);
      setScanMessage(
        tr('security_gate_desk_view.new_face_detected_verifying_gate_access_clearance'),
      );
      updateCapturedPreview(frameBlob);

      try {
        const data = await client.verifyFaceGate(
          token!,
          selectedSiteId,
          selectedGateId,
          frameBlob,
          direction,
        );
        if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
        setLastDecision(data.decision);
        setCurrentAttempt(data.attempt ?? null);
        setFallback(data.fallback ?? null);
        // Historical display only: unknown scans never inherit this worker's identity or access.
        setCandidateWorker((previous) => retainGateWorker(previous, data.worker));
        if (data.decision?.authorization === 'ALLOWED' && data.attempt?.id) {
          try {
            if (passageKey.current?.attemptId !== data.attempt.id)
              passageKey.current = {
                attemptId: data.attempt.id,
                idempotencyKey: crypto.randomUUID(),
              };
            const event = await client.confirmGatePassage(token!, selectedSiteId, data.attempt.id, {
              idempotencyKey: passageKey.current.idempotencyKey,
            });
            if (generation === scanGeneration.current && cameraMountedRef.current) {
              setConfirmedEvent(event);
              setCurrentAttempt(null);
            }
            void queryClient.invalidateQueries({
              queryKey: ['attendance', apiUrl, sessionScope, selectedSiteId],
            });
            void queryClient.invalidateQueries({
              queryKey: ['attendance-days', apiUrl, sessionScope, selectedSiteId],
            });
          } catch (error) {
            if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
            if (error instanceof ApiError && error.backendError?.code === 'WORKER_NO_SCHEDULE')
              handleNoScheduleDenial();
            if (
              error instanceof ApiError &&
              error.backendError?.code === 'GATE_PASSAGE_ALREADY_RECORDED'
            ) {
              setRepeatNotice(error.message);
              setSeparatePassage(false);
              setReviewNote('');
              setScanMessage(error.message);
            }
            // Keep attempt for manual confirmation if auto-confirm is blocked
          }
        }
        await queryClient.invalidateQueries({
          queryKey: ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId],
        });
      } catch {
        if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
        // Network or connection failure
        setNetworkError(true);
      }
    } catch {
      if (generation !== scanGeneration.current || !cameraMountedRef.current) return;
      setNetworkError(true);
    } finally {
      scanBusy.current = false;
      if (generation === scanGeneration.current && cameraMountedRef.current) setIsScanning(false);
    }
  }, [
    apiUrl,
    client,
    queryClient,
    sessionScope,
    cameraActive,
    direction,
    selectedGateId,
    selectedSiteId,
    token,
    updateCapturedPreview,
    handleNoScheduleDenial,
  ]);

  useEffect(() => {
    if (!cameraActive || networkError || !selectedSiteId || !token || qrModalOpen || fallback)
      return;
    if (currentAttempt && candidateWorker) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await handleScanFace();
      if (!cancelled) timer = setTimeout(() => void tick(), 1_000);
    };
    timer = setTimeout(() => void tick(), 1_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    cameraActive,
    handleScanFace,
    networkError,
    selectedSiteId,
    token,
    qrModalOpen,
    fallback,
    currentAttempt,
    candidateWorker,
  ]);

  // Reset scan to prepare for next worker
  const handleResetScan = () => {
    scanGeneration.current += 1;
    presenceSession.current = '';
    setIsScanning(false);
    setScanMessage(tr('common.awaiting_face'));
    updateCapturedPreview(null);
    setLastDecision(null);
    setCurrentAttempt(null);
    setConfirmedEvent(null);
    passageKey.current = null;
    setReviewNote('');
    setRepeatNotice('');
    setSeparatePassage(false);
    setCandidateWorker(null);
    setNetworkError(false);
    setFallback(null);
    setQrCodeInput('');
    qrCommand.current = null;
  };

  // Face decisions are already saved by the Backend. Never fabricate clearance logs.
  const handleRecordGateEvent = () => {
    if (lastDecision?.authorization === 'ALLOWED') handleResetScan();
  };

  const handleConfirmQrFallback = () => {
    if (!fallback || !token) return;
    const old = qrCommand.current;
    const input =
      old && old.token === qrCodeInput.trim() && old.direction === fallback.direction
        ? old
        : {
            token: qrCodeInput.trim(),
            direction: fallback.direction,
            requestId: crypto.randomUUID(),
          };
    qrCommand.current = input;
    setQrResultMessage('');
    qrVerification.mutate(input);
  };

  const uiState = resolveGateUiState({
    technicalOutcome: lastDecision?.technicalOutcome,
    authorization: lastDecision?.authorization,
    isNetworkError: networkError,
  });

  return (
    <div className="space-y-6">
      {/* Top Bar: Gate Selector & Direction Command Strip */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100/80 text-[#F66B17]">
              <IconBuilding2 className="h-4 w-4" />
            </div>
            <div>
              <label
                htmlFor="gate-site-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                {tr('common.active_site')}
              </label>
              <select
                id="gate-site-select"
                value={selectedSiteId}
                onChange={(e) => {
                  handleResetScan();
                  onSelectSite(e.target.value);
                }}
                className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none"
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-200 hidden sm:block" />

          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <IconKey className="h-4 w-4" />
            </div>
            <div>
              <label
                htmlFor="gate-selector"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                {tr('common.access_gate')}
              </label>
              <select
                id="gate-selector"
                value={selectedGateId}
                disabled={isScanning}
                onChange={(e) => {
                  handleResetScan();
                  setSelectedGateId(e.target.value);
                }}
                className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-bold text-slate-800 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none disabled:bg-slate-100"
              >
                {gates.map((gate) => (
                  <option key={gate.id} value={gate.id}>
                    {gate.name} ({gate.id})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Direction Switcher (IN vs OUT) */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {tr('common.direction')}
          </span>
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/90 p-1 shadow-2xs">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => {
                handleResetScan();
                setDirection('IN');
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                direction === 'IN'
                  ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              <span>{tr('common.in_check_in')}</span>
            </button>
            <button
              type="button"
              disabled={isScanning}
              onClick={() => {
                handleResetScan();
                setDirection('OUT');
              }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                direction === 'OUT'
                  ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/20'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-blue-300" />
              <span>{tr('common.out_check_out')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: Camera Feed & Decision Desk Panel */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Live Webcam Viewport (7 Cols) */}
        <div className="space-y-3 lg:col-span-7">
          {/* Camera Device Selector & Status Banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <IconCamera className="h-4 w-4 text-[#F66B17]" />
              <label
                htmlFor="gate-camera-device-select"
                className="text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                {tr('common.camera_device')}
              </label>
              <select
                id="gate-camera-device-select"
                value={cameraDeviceId}
                disabled={isScanning}
                className="rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-[#F66B17] focus:bg-white focus:outline-none"
                onChange={(event) => {
                  cameraDeviceRef.current = event.target.value;
                  setCameraDeviceId(event.target.value);
                  handleResetScan();
                  stopCamera();
                  void startCamera();
                }}
              >
                <option value="">{tr('common.default_camera')}</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || tr('common.camera_value', { value1: index + 1 })}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cameraActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${cameraActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}
                />
                {cameraActive ? tr('common.live_720p') : 'OFFLINE'}
              </span>
            </div>
          </div>

          <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-950 shadow-md">
            {/* Live Video Preview */}
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />

            {/* Tactical Viewfinder Corners */}
            <div className="pointer-events-none absolute top-3 left-3 h-4 w-4 rounded-tl border-t-2 border-l-2 border-[#F66B17]/90" />
            <div className="pointer-events-none absolute top-3 right-3 h-4 w-4 rounded-tr border-t-2 border-r-2 border-[#F66B17]/90" />
            <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 rounded-bl border-b-2 border-l-2 border-[#F66B17]/90" />
            <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 rounded-br border-b-2 border-r-2 border-[#F66B17]/90" />

            {/* Inactive or Error Overlay */}
            {!cameraActive && (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-slate-400">
                <IconCamera className="mb-3 h-12 w-12 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">
                  {tr('common.webcam_not_active')}
                </p>
                {cameraError && (
                  <div className="mt-2 max-w-sm space-y-2">
                    <p className="text-xs text-red-400">{localizeMessage(cameraError)}</p>
                    {lastDecision?.authorization !== 'DENIED' && (
                      <button
                        type="button"
                        disabled={!token || fallbackMutation.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-xs transition-all disabled:opacity-50"
                        onClick={() => {
                          stopCamera();
                          qrVerification.reset();
                          setQrResultMessage('');
                          fallbackMutation.mutate();
                        }}
                      >
                        <IconKey className="h-3.5 w-3.5" />
                        <span>
                          {fallbackMutation.isPending
                            ? tr('common.opening_session')
                            : tr('security_gate_desk_view.camera_error_use_fallback_qr')}
                        </span>
                      </button>
                    )}
                    {fallbackMutation.error && (
                      <p role="alert" className="text-red-400">
                        {localizedError(fallbackMutation.error.message)}
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    handleResetScan();
                    stopCamera();
                    void startCamera();
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-bold text-white hover:bg-orange-700 shadow-sm transition-all"
                >
                  <IconRefresh className="h-4 w-4" /> {tr('common.restart_camera')}
                </button>
              </div>
            )}

            {/* Gate Overlay Tag */}
            {cameraActive && (
              <div className="pointer-events-none absolute top-3.5 left-3.5 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md border border-white/10">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  {tr('common.gate_value', {
                    value1: gates.find((g) => g.id === selectedGateId)?.name ?? selectedGateId,
                  })}
                </span>
              </div>
            )}

            {/* Face Alignment Frame Guide */}
            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-white/50 shadow-inner">
                  <div className="flex h-full items-end justify-center pb-2">
                    <span className="rounded-full bg-black/70 px-3 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-xs border border-white/10">
                      {tr('security_gate_desk_view.align_face_within_frame')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* In-Memory Snapshot Thumbnail Badge */}
            {capturedPreviewUrl && (
              <div className="absolute top-3.5 right-3.5 z-10 rounded-xl border border-white/20 bg-black/80 p-1.5 backdrop-blur-md shadow-lg">
                <img
                  src={capturedPreviewUrl}
                  alt={tr('security_gate_desk_view.captured_scan_frame_in_memory')}
                  className="h-16 w-20 rounded-lg object-cover"
                />
                <span className="mt-1 block text-center text-[9px] font-bold tracking-wider text-slate-300 uppercase">
                  {tr('common.last_frame')}
                </span>
              </div>
            )}

            {/* Processing Indicator */}
            {isScanning && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#F66B17] border-t-transparent" />
                <p className="mt-3 text-sm font-bold text-white">{tr('common.analyzing_face')}</p>
              </div>
            )}
          </div>

          {/* Automatic one-frame scan with an explicit next-scan control. */}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-orange-200/90 bg-orange-50/70 p-3 shadow-2xs">
            <div className="flex items-center gap-2.5 pl-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#F66B17] animate-pulse shrink-0" />
              <span role="status" aria-live="polite" className="text-xs font-bold text-orange-950">
                {scanMessage}
              </span>
            </div>

            {(lastDecision || networkError) && (
              <button
                type="button"
                onClick={handleResetScan}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-2xs transition-all"
              >
                {tr('security_gate_desk_view.clear_new_scan')}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {tr(
              'security_gate_desk_view.automatic_face_detection_active_repeated_scans_for_the_same_person_or_empty_frames',
            )}
          </p>
        </div>

        {/* Right Column: Authorization & Technical Result Panel (5 Cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div
            className={`rounded-2xl border p-5 shadow-xs transition-colors ${uiState.panelClass}`}
          >
            {/* Header: Outcome Badge */}
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
              <span className="text-xs font-bold tracking-wider text-slate-500 uppercase">
                {tr('common.last_scan_result')}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${uiState.badgeClass}`}
              >
                {uiState.type === 'ALLOWED' && <IconCheck className="h-3.5 w-3.5" />}
                {uiState.type === 'DENIED' && <IconX className="h-3.5 w-3.5" />}
                {uiState.type === 'FALLBACK_REQUIRED' && (
                  <IconAlertTriangle className="h-3.5 w-3.5" />
                )}
                {uiState.type === 'MANUAL_REVIEW' && <IconKey className="h-3.5 w-3.5" />}
                {uiState.label}
              </span>
            </div>

            {/* Description & Safe Reason Message */}
            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold text-slate-900">
                {lastDecision?.reasonCode === 'NO_SCHEDULE'
                  ? getSafeReasonMessage('NO_SCHEDULE')
                  : uiState.safeDescription}
              </p>
              {lastDecision?.reasonCode && lastDecision.reasonCode !== 'NO_SCHEDULE' && (
                <p className="text-xs font-medium text-slate-600">
                  {getSafeReasonMessage(lastDecision.reasonCode)}
                </p>
              )}
            </div>

            {/* Candidate Worker Card (if identified) */}
            {candidateWorker && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <p className="mb-3 text-[11px] font-semibold text-slate-500">
                  {tr(
                    'security_gate_desk_view.last_identified_worker_retained_until_another_worker_is_identified_not_clearance_f',
                  )}
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 text-sm font-bold text-white shadow-xs">
                    {candidateWorker.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-bold text-slate-900">
                      {candidateWorker.displayName}
                    </h4>
                    <p className="text-xs text-slate-600">
                      {tr('common.account_value', { value1: candidateWorker.username })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {tr('common.id')}{' '}
                      <span className="font-mono font-bold text-slate-700">
                        {candidateWorker.externalId}
                      </span>{' '}
                      · {candidateWorker.contractorName}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                  <span className="text-slate-500 font-medium">{tr('common.site_assignment')}</span>
                  <span className="font-bold text-emerald-700">
                    {candidateWorker.assignmentStatus}
                  </span>
                </div>
              </div>
            )}

            {/* Actions for Security Officer */}
            <div className="mt-5 space-y-2">
              {uiState.canRecordInOut && (
                <div>
                  <p className="mb-2 text-xs font-medium text-emerald-700">
                    {tr('security_gate_desk_view.value_clearance_recorded_in_database', {
                      value1: direction,
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={handleRecordGateEvent}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-all"
                  >
                    <IconCheck className="h-4 w-4" /> {tr('common.scan_next_worker')}
                  </button>
                </div>
              )}

              {/* Expose QR fallback when verification is inconclusive (never on DENIED) */}
              {uiState.canUseQrFallback && (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    qrVerification.reset();
                    setQrResultMessage('');
                    setQrModalOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-100/90 py-3 text-xs font-bold text-amber-950 hover:bg-amber-200 transition-all"
                >
                  <span>{tr('security_gate_desk_view.launch_dynamic_qr_fallback')}</span>
                </button>
              )}

              {/* Manual Review Action */}
              {uiState.type === 'MANUAL_REVIEW' && (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-xl bg-blue-700 py-2.5 text-xs font-bold text-white hover:bg-blue-800"
                >
                  {tr('security_gate_desk_view.manual_clearance_is_not_implemented')}
                </button>
              )}

              {/* Retry on Network Failure */}
              {uiState.isRetry && (
                <button
                  type="button"
                  onClick={handleScanFace}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-xs font-bold text-white hover:bg-red-700 transition-all"
                >
                  <IconRefresh className="h-4 w-4" /> {tr('common.retry_scan')}
                </button>
              )}
            </div>
          </div>

          {/* Quick Security Officer Guidelines */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs text-xs text-slate-600 space-y-2">
            <div className="flex items-center gap-2 text-slate-900 font-bold border-b border-slate-100 pb-2">
              <IconShield className="h-4 w-4 text-[#F66B17]" />
              <h5>{tr('security_gate_desk_view.security_officer_operating_guidelines_sop')}</h5>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-slate-600">
              <li>
                {tr(
                  'security_gate_desk_view.webcam_match_provides_preliminary_identity_verification_backend_authorizes_access',
                )}
              </li>
              <li>
                {tr(
                  'security_gate_desk_view.when_clearance_is_denied_red_do_not_admit_worker_or_initiate_qr_fallback_without_s',
                )}
              </li>
              <li>
                {tr(
                  'security_gate_desk_view.for_inconclusive_face_matches_give_the_worker_a_fallback_session_id_and_request_th',
                )}
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* QR Fallback Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <IconKey className="h-5 w-5 text-[#F66B17]" />
                <h3 className="font-bold text-slate-900">
                  {tr('security_gate_desk_view.worker_dynamic_qr_fallback')}
                </h3>
              </div>
              <button
                type="button"
                aria-label={tr('security_gate_desk_view.close_qr_fallback_modal')}
                onClick={() => setQrModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {fallback && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                      <IconKey className="h-3.5 w-3.5 text-blue-600" />
                      {tr('common.worker_fallback_session')}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                      {tr('common.direction_value', { value1: fallback.direction })}
                    </span>
                  </div>
                  <p className="text-xs text-blue-800">
                    {tr(
                      'security_gate_desk_view.provide_this_session_code_to_the_worker_to_enter_in_my_qr_pass',
                    )}
                  </p>
                  <div className="rounded-xl border border-blue-200 bg-white p-2.5 font-mono text-xs text-blue-950 font-bold break-all select-all shadow-inner">
                    {fallback.id}
                  </div>
                  <p className="text-[11px] text-blue-700">
                    {tr('common.expires')}{' '}
                    <span className="font-semibold">
                      {new Date(fallback.expiresAt).toLocaleTimeString(uiLocale())}
                    </span>
                  </p>
                </div>
              )}
              <QrScannerView disabled={qrProcessing || !fallback} onScan={setQrCodeInput} />
              {qrVerification.error && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700"
                >
                  <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{localizedError(qrVerification.error.message)}</span>
                </div>
              )}
              {qrResultMessage && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800"
                >
                  <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{qrResultMessage}</span>
                </div>
              )}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
                {tr(
                  'security_gate_desk_view.dynamic_qr_is_a_fallback_method_when_facial_recognition_is_inconclusive_security_o',
                )}
              </div>

              <div>
                <label
                  htmlFor="qr-code-input"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700"
                >
                  {tr('security_gate_desk_view.worker_qr_code_or_token')}
                </label>
                <input
                  id="qr-code-input"
                  type="text"
                  placeholder={tr('common.ssq')}
                  disabled={qrProcessing}
                  value={qrCodeInput}
                  onChange={(e) => setQrCodeInput(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm font-mono focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  {tr('common.cancel')}
                </button>
                <button
                  type="button"
                  disabled={!fallback || !qrCodeInput.trim() || qrProcessing}
                  onClick={handleConfirmQrFallback}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-xs"
                >
                  {qrProcessing
                    ? tr('common.verifying')
                    : tr('common.confirm_value_qr', { value1: direction })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {canManualVerify && (
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <h3 className="font-semibold">{tr('common.security_manual_verification')}</h3>
          <label className="block text-xs">
            {tr('common.worker_profile')}
            <select
              value={manualWorkerId}
              onChange={(e) => {
                setManualWorkerId(e.target.value);
                setManualIdentityConfirmed(false);
              }}
              className="mt-1 block w-full rounded border p-2"
            >
              <option value="">{tr('common.select_worker')}</option>
              {manualWorkers.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.displayName} · {w.externalId}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            {tr('common.verification_reason')}
            <input
              className="mt-1 block w-full rounded border p-2"
              value={reviewNote}
              maxLength={1000}
              onChange={(e) => setReviewNote(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <input
              type="checkbox"
              checked={manualIdentityConfirmed}
              onChange={(e) => setManualIdentityConfirmed(e.target.checked)}
            />{' '}
            {tr('security_gate_desk_view.i_physically_verified_this_worker_apos_s_identity')}
          </label>
          <button
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
            disabled={
              !manualIdentityConfirmed || !manualWorkerId || !reviewNote.trim() || manual.isPending
            }
            onClick={() => manual.mutate()}
          >
            {tr('common.verify_worker_manually')}
          </button>
          {manualWorkers.error && <p role="alert">{localizedError(manualWorkers.error.message)}</p>}
          {manual.error && <p role="alert">{localizedError(manual.error.message)}</p>}
          {manual.data?.status === 'DENIED' && (
            <p role="alert">
              {manual.data.scheduleStatus === 'NO_SCHEDULE'
                ? getSafeReasonMessage('NO_SCHEDULE')
                : tr(
                    'security_gate_desk_view.worker_identity_verified_site_entry_permission_was_denied',
                  )}
            </p>
          )}
        </section>
      )}
      {currentAttempt &&
        ['READY', 'PENDING'].includes(currentAttempt.status) &&
        candidateWorker && (
          <section className="rounded-xl border bg-white p-5 space-y-3">
            <p className="font-semibold">
              {tr(
                'security_gate_desk_view.verification_recorded_confirm_the_actual_passage_for_value',
                { value1: candidateWorker.displayName },
              )}
            </p>
            <p className="text-xs">
              {tr(
                'security_gate_desk_view.schedule_value_temporary_passage_does_not_create_attendance',
                { value1: currentAttempt.scheduleStatus },
              )}
            </p>
            <label className="block text-xs">
              {tr(
                'security_gate_desk_view.security_review_reason_required_outside_a_shift_or_for_a_separate_passage',
              )}
              <input
                className="mt-1 block w-full rounded border p-2"
                value={reviewNote}
                maxLength={1000}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </label>
            <button
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={
                passage.isPending ||
                (Boolean(
                  repeatNotice ||
                  (passage.error instanceof ApiError &&
                    passage.error.backendError?.code === 'GATE_PASSAGE_ALREADY_RECORDED'),
                ) &&
                  (!separatePassage || reviewNote.trim().length < 5)) ||
                (direction === 'IN' &&
                  currentAttempt.scheduleStatus !== 'SCHEDULED' &&
                  !canManualVerify)
              }
              onClick={() => passage.mutate()}
            >
              {tr('common.confirm_actual_passage')}
            </button>
            {(repeatNotice ||
              (passage.error instanceof ApiError &&
                passage.error.backendError?.code === 'GATE_PASSAGE_ALREADY_RECORDED')) && (
              <div className="space-y-2">
                <p role="status">{localizedError(repeatNotice || passage.error?.message)}</p>
                {canManualVerify && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={separatePassage}
                      onChange={(event) => setSeparatePassage(event.target.checked)}
                    />
                    {tr(
                      'security_gate_desk_view.this_is_a_separate_physical_passage_not_a_repeated_scan',
                    )}
                  </label>
                )}
                <button type="button" onClick={handleResetScan}>
                  {tr('common.dismiss_repeated_scan')}
                </button>
              </div>
            )}
            {passage.error && <p role="alert">{localizedError(passage.error.message)}</p>}
            {direction === 'IN' &&
              currentAttempt.scheduleStatus !== 'SCHEDULED' &&
              !canManualVerify && (
                <p className="text-sm text-amber-700">
                  {tr(
                    'security_gate_desk_view.security_must_verify_and_confirm_entry_outside_a_scheduled_shift',
                  )}
                </p>
              )}
          </section>
        )}
      {passage.isSuccess && <p role="status">{tr('common.actual_passage_recorded')}</p>}
      {confirmedEvent && canManualVerify && (
        <section className="space-y-3 rounded-xl border bg-white p-5">
          <p className="text-sm">
            {tr(
              'security_gate_desk_view.this_value_is_recorded_attendance_has_been_updated_automatically',
              { value1: confirmedEvent.direction === 'IN' ? 'entry' : 'exit' },
            )}
          </p>
        </section>
      )}
      {/* Recent verification decisions */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <IconClock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">
                {tr('security_gate_desk_view.gate_access_clearance_audit_trail')}
              </h3>
              <p className="text-[11px] text-slate-500">
                {tr(
                  'security_gate_desk_view.verification_decisions_actual_passage_requires_confirmation',
                )}
              </p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {tr('common.value_entries_recorded', { value1: recentEvents.length })}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3.5 py-3">{tr('common.timestamp')}</th>
                <th className="px-3.5 py-3">{tr('common.worker')}</th>
                <th className="px-3.5 py-3">{tr('common.worker_id')}</th>
                <th className="px-3.5 py-3">{tr('common.direction_9c8a95')}</th>
                <th className="px-3.5 py-3">{tr('common.method')}</th>
                <th className="px-3.5 py-3">{tr('common.clearance')}</th>
                <th className="px-3.5 py-3">{tr('common.gate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accessLogs.isPending && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                      <span>{tr('security_gate_desk_view.loading_gate_access_logs')}</span>
                    </div>
                  </td>
                </tr>
              )}
              {accessLogs.isError && (
                <tr>
                  <td
                    colSpan={7}
                    role="alert"
                    className="p-4 text-center text-xs text-red-700 bg-red-50"
                  >
                    {tr('security_gate_desk_view.unable_to_load_access_logs')}{' '}
                    <button
                      type="button"
                      onClick={() => void accessLogs.refetch()}
                      className="font-bold underline hover:text-red-900"
                    >
                      {tr('common.retry')}
                    </button>
                  </td>
                </tr>
              )}
              {!accessLogs.isPending && !accessLogs.isError && recentEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-slate-400">
                    {tr('security_gate_desk_view.no_gate_events_recorded_for_this_session_yet')}
                  </td>
                </tr>
              )}
              {recentEvents.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-3.5 py-2.5 font-mono text-slate-500">{evt.timestamp}</td>
                  <td className="px-3.5 py-2.5 font-bold text-slate-900">{evt.workerName}</td>
                  <td className="px-3.5 py-2.5 font-mono text-slate-600">{evt.workerExternalId}</td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        evt.direction === 'IN'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {evt.direction === 'IN' ? 'IN' : 'OUT'}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                      {evt.method}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        evt.outcome === 'ALLOWED' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {evt.outcome === 'ALLOWED' ? (
                        <>
                          <IconCheck className="h-3.5 w-3.5" />
                          <span>{tr('common.allowed')}</span>
                        </>
                      ) : (
                        <>
                          <IconX className="h-3.5 w-3.5" />
                          <span>{tr('common.denied')}</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 font-medium text-slate-600">{evt.gateName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
