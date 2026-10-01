import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { FaceGateDecisionResponse, FaceGateVerificationResponse } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconClock,
  IconKey,
  IconRefresh,
  IconUser,
  IconX,
} from '../icons';
import {
  captureFrameBlob,
  createSafePreviewUrl,
  getSafeReasonMessage,
  resolveGateUiState,
  revokeSafePreviewUrl,
} from './faceGateUtils';

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
  apiUrl: string;
  token?: string;
  sessionScope: string;
  selectedSiteId: string;
  sites: Array<{ id: string; name: string }>;
  onSelectSite: (siteId: string) => void;
}

const gates = SITE_GATES;

export function SecurityGateDeskView({
  apiUrl,
  token,
  sessionScope,
  selectedSiteId,
  sites,
  onSelectSite,
}: SecurityGateDeskViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  // Gate selection & direction
  const [selectedGateId, setSelectedGateId] = useState<string>(gates[0]?.id ?? '');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraMountedRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // In-memory frame preview (never stored in localStorage/sessionStorage)
  const capturedPreviewUrlRef = useRef<string | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);

  // Verification state
  const [isScanning, setIsScanning] = useState(false);
  const [networkError, setNetworkError] = useState(false);
  const [lastDecision, setLastDecision] = useState<FaceGateDecisionResponse | null>(null);
  const [candidateWorker, setCandidateWorker] = useState<
    FaceGateVerificationResponse['worker'] | null
  >(null);

  // QR Fallback modal state
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrCodeInput, setQrCodeInput] = useState('');
  const [qrOfficerNotes, setQrOfficerNotes] = useState('');
  const qrProcessing = false;

  // Recent Gate Events log
  const logQueryKey = ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId];
  const accessLogs = useQuery({
    queryKey: logQueryKey,
    enabled: !!token && !!selectedSiteId,
    queryFn: () => client.listGateAccessLogs(token!, selectedSiteId, selectedGateId),
  });
  const recentEvents: GateDeskEventRecord[] = (accessLogs.data?.items ?? []).map((log) => ({
    id: log.id,
    timestamp: new Date(log.createdAt).toLocaleString(),
    workerName: log.workerName ?? 'Unknown',
    workerExternalId: log.workerExternalId ?? '—',
    contractorName: log.contractorName ?? '—',
    direction: log.direction,
    method: 'FACE',
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
    const requestId = ++cameraRequestRef.current;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    return navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      })
      .then(async (stream) => {
        if (!cameraMountedRef.current || requestId !== cameraRequestRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        setCameraError(null);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        if (cameraMountedRef.current && requestId === cameraRequestRef.current)
          setCameraActive(true);
      })
      .catch((err: unknown) => {
        if (!cameraMountedRef.current || requestId !== cameraRequestRef.current) return;
        const message = err instanceof Error ? err.message : 'Webcam access failed';
        setCameraError(
          `Camera unavailable: ${message}. Check browser permissions or device connection.`,
        );
        setCameraActive(false);
      });
  }, []);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    cameraMountedRef.current = true;
    void startCamera();
    return () => {
      cameraMountedRef.current = false;
      stopCamera();
      if (capturedPreviewUrlRef.current) {
        revokeSafePreviewUrl(capturedPreviewUrlRef.current);
        capturedPreviewUrlRef.current = null;
      }
    };
  }, [startCamera, stopCamera]);

  // One frame is sent after the camera has stabilized; there is no continuous browser polling.
  const handleScanFace = useCallback(async () => {
    if (isScanning) return;
    const video = videoRef.current;
    if (!video || !cameraActive) {
      setCameraError('Webcam feed is not running.');
      return;
    }

    setIsScanning(true);
    setNetworkError(false);

    try {
      // 1. Capture exactly one single JPEG frame in memory
      const frameBlob = await captureFrameBlob(video, { maxWidth: 1280, quality: 0.9 });
      updateCapturedPreview(frameBlob);

      try {
        const data = await client.verifyFaceGate(
          token!,
          selectedSiteId,
          selectedGateId,
          frameBlob,
          direction,
        );
        setLastDecision(data.decision);
        setCandidateWorker(data.worker ?? null);
        await queryClient.invalidateQueries({
          queryKey: ['gate-access-logs', apiUrl, sessionScope, selectedSiteId, selectedGateId],
        });
      } catch {
        // Network or connection failure
        setNetworkError(true);
        setLastDecision(null);
        setCandidateWorker(null);
      }
    } catch {
      setNetworkError(true);
      setLastDecision(null);
    } finally {
      setIsScanning(false);
    }
  }, [
    apiUrl,
    client,
    queryClient,
    sessionScope,
    cameraActive,
    direction,
    isScanning,
    selectedGateId,
    selectedSiteId,
    token,
    updateCapturedPreview,
  ]);

  useEffect(() => {
    if (!cameraActive || isScanning || lastDecision || networkError || !selectedSiteId) return;
    const timer = window.setTimeout(() => void handleScanFace(), 1_200);
    return () => window.clearTimeout(timer);
  }, [cameraActive, handleScanFace, isScanning, lastDecision, networkError, selectedSiteId]);

  // Reset scan to prepare for next worker
  const handleResetScan = () => {
    updateCapturedPreview(null);
    setLastDecision(null);
    setCandidateWorker(null);
    setNetworkError(false);
  };

  // Face decisions are already saved by the Backend. Never fabricate clearance logs.
  const handleRecordGateEvent = () => {
    if (lastDecision?.authorization === 'ALLOWED') handleResetScan();
  };

  const handleConfirmQrFallback = () => {
    setQrOfficerNotes('QR clearance is not implemented. No access or log was granted.');
  };

  const uiState = resolveGateUiState({
    technicalOutcome: lastDecision?.technicalOutcome,
    authorization: lastDecision?.authorization,
    isNetworkError: networkError,
  });

  return (
    <div className="space-y-6">
      {/* Top Bar: Gate Selector & Directions */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="gate-site-select"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Active Site
            </label>
            <select
              id="gate-site-select"
              value={selectedSiteId}
              onChange={(e) => onSelectSite(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-[#F66B17] focus:outline-none"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="gate-selector"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Access Gate
            </label>
            <select
              id="gate-selector"
              value={selectedGateId}
              disabled={isScanning}
              onChange={(e) => {
                handleResetScan();
                setSelectedGateId(e.target.value);
              }}
              className="mt-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-[#F66B17] focus:outline-none"
            >
              {gates.map((gate) => (
                <option key={gate.id} value={gate.id}>
                  {gate.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Direction Switcher (IN vs OUT) */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Direction:
          </span>
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
            <button
              type="button"
              disabled={isScanning}
              onClick={() => {
                handleResetScan();
                setDirection('IN');
              }}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                direction === 'IN'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CHECK IN
            </button>
            <button
              type="button"
              disabled={isScanning}
              onClick={() => {
                handleResetScan();
                setDirection('OUT');
              }}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                direction === 'OUT'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              CHECK OUT
            </button>
          </div>
        </div>
      </section>

      {/* Main Split: Camera Feed & Decision Desk Panel */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Live Webcam Viewport (7 Cols) */}
        <div className="space-y-3 lg:col-span-7">
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-950 shadow-md">
            {/* Live Video Preview */}
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />

            {/* Inactive or Error Overlay */}
            {!cameraActive && (
              <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-slate-400">
                <IconCamera className="mb-3 h-12 w-12 text-slate-600" />
                <p className="text-sm font-semibold text-slate-300">Webcam Not Active</p>
                {cameraError && <p className="mt-2 max-w-sm text-xs text-red-400">{cameraError}</p>}
                <button
                  type="button"
                  onClick={startCamera}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <IconRefresh className="h-4 w-4" /> Restart Camera
                </button>
              </div>
            )}

            {/* Face Alignment Frame Guide */}
            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-white/40 shadow-inner">
                  <div className="flex h-full items-end justify-center pb-2">
                    <span className="rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-medium text-white/80 backdrop-blur-xs">
                      Align Face Here
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* In-Memory Snapshot Thumbnail Badge */}
            {capturedPreviewUrl && (
              <div className="absolute top-3 right-3 rounded-lg border border-white/20 bg-black/70 p-1 backdrop-blur-xs">
                <img
                  src={capturedPreviewUrl}
                  alt="Captured scan frame in memory"
                  className="h-16 w-20 rounded object-cover"
                />
                <span className="block text-center text-[9px] font-medium text-slate-300">
                  Last Frame
                </span>
              </div>
            )}

            {/* Processing Indicator */}
            {isScanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#F66B17] border-t-transparent" />
                <p className="mt-3 text-sm font-semibold text-white">Analyzing Single Frame…</p>
              </div>
            )}
          </div>

          {/* Automatic one-frame scan with an explicit next-scan control. */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 rounded-xl border border-orange-200 bg-orange-50 py-3.5 text-center text-sm font-bold text-orange-900">
              {isScanning ? 'Processing Frame…' : '📷 Scan Face Frame'}
            </div>

            {(lastDecision || networkError) && (
              <button
                type="button"
                onClick={handleResetScan}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            * One in-memory frame is sent after camera stabilization. Clear starts the next
            automatic scan.
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
                Gate Clearance Status
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
              <p className="text-sm font-semibold text-slate-900">{uiState.safeDescription}</p>
              {lastDecision?.reasonCode && (
                <p className="text-xs font-medium text-slate-600">
                  {getSafeReasonMessage(lastDecision.reasonCode)}
                </p>
              )}
            </div>

            {/* Candidate Worker Card (if identified) */}
            {candidateWorker && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                    <IconUser className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">{candidateWorker.displayName}</h4>
                    <p className="text-xs text-slate-600">Account: {candidateWorker.username}</p>
                    <p className="text-xs text-slate-500">
                      ID: <span className="font-mono">{candidateWorker.externalId}</span> ·{' '}
                      {candidateWorker.contractorName}
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                  <span className="text-slate-500">Site Assignment:</span>
                  <span className="font-semibold text-emerald-700">
                    {candidateWorker.assignmentStatus}
                  </span>
                </div>
              </div>
            )}

            {/* Actions for Security Officer */}
            <div className="mt-5 space-y-2">
              {uiState.canRecordInOut && (
                <div>
                  <p className="mb-2 text-xs text-emerald-700">
                    Quyết định {direction} đã được lưu trong DB.
                  </p>
                  <button
                    type="button"
                    onClick={handleRecordGateEvent}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <IconCheck className="h-4 w-4" /> Quét tiếp
                  </button>
                </div>
              )}

              {/* Expose QR fallback when verification is inconclusive (never on DENIED) */}
              {uiState.canUseQrFallback && (
                <button
                  type="button"
                  onClick={() => setQrModalOpen(true)}
                  className="w-full rounded-xl border border-amber-300 bg-amber-100/80 py-2.5 text-xs font-bold text-amber-900 hover:bg-amber-200"
                >
                  ⚡ Launch Dynamic QR Fallback
                </button>
              )}

              {/* Manual Review Action */}
              {uiState.type === 'MANUAL_REVIEW' && (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-xl bg-blue-700 py-2.5 text-xs font-bold text-white hover:bg-blue-800"
                >
                  Manual clearance is not implemented
                </button>
              )}

              {/* Retry on Network Failure */}
              {uiState.isRetry && (
                <button
                  type="button"
                  onClick={handleScanFace}
                  className="w-full rounded-xl bg-red-600 py-2.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  Retry Scan
                </button>
              )}
            </div>
          </div>

          {/* Quick Security Officer Guidelines */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-600">
            <h5 className="font-bold text-slate-800">Security Officer SOP</h5>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                Webcam match provides technical candidate identity only; backend grants clearance.
              </li>
              <li>
                When result is Red (Denied), do not offer QR fallback without supervisor approval.
              </li>
              <li>
                For inconclusive/unrecognized scans, request dynamic QR from worker mobile app.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* QR Fallback Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900">Worker Dynamic QR Fallback</h3>
              <button
                type="button"
                onClick={() => setQrModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                ⚠️ QR code is a fallback identity check. It does not automatically grant access
                without Security Officer verification of assignment.
              </div>

              <div>
                <label
                  htmlFor="qr-code-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Scan or Enter Worker QR Payload
                </label>
                <input
                  id="qr-code-input"
                  type="text"
                  placeholder="e.g. WKR-FALLBACK-9281-EXP..."
                  value={qrCodeInput}
                  onChange={(e) => setQrCodeInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="qr-notes-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Officer Confirmation Notes (Optional)
                </label>
                <input
                  id="qr-notes-input"
                  type="text"
                  placeholder="e.g. Visual badge verified"
                  value={qrOfficerNotes}
                  onChange={(e) => setQrOfficerNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#F66B17] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setQrModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!qrCodeInput.trim() || qrProcessing}
                  onClick={handleConfirmQrFallback}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {qrProcessing ? 'Verifying…' : `Confirm ${direction} (QR)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Gate Events Audit Trail */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <IconClock className="h-4 w-4 text-slate-500" />
            <h3 className="font-bold text-slate-900">Shift Gate Activity Log</h3>
          </div>
          <span className="text-xs text-slate-500">
            {recentEvents.length} decisions saved in DB
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Time</th>
                <th className="px-3 py-2.5">Worker Name</th>
                <th className="px-3 py-2.5">Worker ID</th>
                <th className="px-3 py-2.5">Direction</th>
                <th className="px-3 py-2.5">Method</th>
                <th className="px-3 py-2.5">Outcome</th>
                <th className="px-3 py-2.5">Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accessLogs.isPending && (
                <tr>
                  <td colSpan={7} className="p-3">
                    Loading database logs…
                  </td>
                </tr>
              )}
              {accessLogs.isError && (
                <tr>
                  <td colSpan={7} role="alert" className="p-3">
                    Could not load logs.{' '}
                    <button type="button" onClick={() => void accessLogs.refetch()}>
                      Retry
                    </button>
                  </td>
                </tr>
              )}
              {!accessLogs.isPending && !accessLogs.isError && recentEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-3">
                    No gate decisions yet.
                  </td>
                </tr>
              )}
              {recentEvents.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-mono text-slate-500">{evt.timestamp}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{evt.workerName}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{evt.workerExternalId}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 font-bold ${
                        evt.direction === 'IN'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {evt.direction}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{evt.method}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${evt.outcome === 'ALLOWED' ? 'text-emerald-700' : 'text-red-700'}`}
                    >
                      {evt.outcome}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{evt.gateName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
