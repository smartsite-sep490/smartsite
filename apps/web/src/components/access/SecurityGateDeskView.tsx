import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { FaceGateDecisionResponse, FaceGateVerificationResponse } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts/gate-permissions';
import type { QrFallbackResponse, VerifyQrCommand } from '@smartsite/contracts';
import { QrScannerView } from './QrScannerView';
import { inspectGateCamera } from './gateCameraReadiness';
import { GateCameraSession } from './gateCameraSession';
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
} from '../icons';
import {
  captureFrameBlob,
  createSafePreviewUrl,
  getSafeReasonMessage,
  resolveGateUiState,
  revokeSafePreviewUrl,
  retainGateWorker,
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

function getGateFaceMessage(reasonCode: string): string {
  const map: Record<string, string> = {
    FACE_QUALITY_ACCEPTED: 'Face quality accepted.',
    FACE_NOT_FOUND: 'No face detected. Position face within viewfinder.',
    FACE_MULTIPLE_FOUND: 'Multiple faces detected. Only one person at a time.',
    FACE_TOO_SMALL: 'Face is too far. Step closer to the camera.',
    FACE_TOO_CLOSE: 'Face is too close. Step back slightly.',
    FACE_CLIPPED: 'Face clipped at edge. Center your face.',
    FACE_NOT_CENTERED: 'Face off-center. Align with center frame.',
    FACE_TOO_DARK: 'Lighting too dim. Face toward a light source.',
    FACE_TOO_BRIGHT: 'Lighting too bright. Avoid strong direct glare.',
    FACE_BLURRY: 'Image blurry. Hold still during scan.',
    FACE_HEAD_TILTED: 'Head is tilted. Keep head upright.',
    FACE_TURN_TOO_FAR: 'Turned too far. Face the camera directly.',
    FACE_POSE_FRONT_REQUIRED: 'Look directly at the camera.',
    FACE_NOT_CLEAR: 'Face not clearly visible. Hold still and remove coverings.',
    FACE_LANDMARKS_UNAVAILABLE: 'Facial landmarks not clear. Remove coverings and pose directly.',
    FACE_IMAGE_INVALID: 'Image unreadable. Hold still for retake.',
  };
  return map[reasonCode] ?? 'Face quality insufficient. Adjust position and hold still.';
}

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
  const cameraMountedRef = useRef(false);
  const cameraSessionRef = useRef<GateCameraSession | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const cameraDeviceRef = useRef('');
  const scanGeneration = useRef(0);
  const scanBusy = useRef(false);
  const presenceSession = useRef('');
  const [scanMessage, setScanMessage] = useState('Awaiting face…');

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
      setQrResultMessage(
        `${r.authorization}: ${r.worker.displayName} · ${getSafeReasonMessage(r.reasonCode)}`,
      );
      setCandidateWorker(r.worker);
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
    timestamp: new Date(log.createdAt).toLocaleString(),
    workerName: log.workerName ?? 'Unknown',
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
      setCameraError('Webcam feed is not running.');
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
          setScanMessage('Worker already scanned. Awaiting next worker or step out of frame.');
        else if (presence.state === 'WAITING') {
          setScanMessage('Face detected. Hold still to verify…');
        } else {
          setScanMessage(getGateFaceMessage(presence.reasonCode));
        }
        return;
      }
      setIsScanning(true);
      setScanMessage('New face detected. Verifying gate access clearance…');
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
        setFallback(data.fallback ?? null);
        // Historical display only: unknown scans never inherit this worker's identity or access.
        setCandidateWorker((previous) => retainGateWorker(previous, data.worker));
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
  ]);

  useEffect(() => {
    if (!cameraActive || networkError || !selectedSiteId || !token || qrModalOpen || fallback)
      return;
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
      scanGeneration.current += 1;
    };
  }, [cameraActive, handleScanFace, networkError, selectedSiteId, token, qrModalOpen, fallback]);

  // Reset scan to prepare for next worker
  const handleResetScan = () => {
    scanGeneration.current += 1;
    presenceSession.current = '';
    setIsScanning(false);
    setScanMessage('Awaiting face…');
    updateCapturedPreview(null);
    setLastDecision(null);
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
                Active Site
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
            Direction:
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
              <span>IN (CHECK IN)</span>
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
              <span>OUT (CHECK OUT)</span>
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
                Camera Device:
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
                <option value="">Default Camera</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
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
                {cameraActive ? 'LIVE · 720p' : 'OFFLINE'}
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
                <p className="text-sm font-semibold text-slate-300">Webcam Not Active</p>
                {cameraError && (
                  <div className="mt-2 max-w-sm space-y-2">
                    <p className="text-xs text-red-400">{cameraError}</p>
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
                            ? 'Opening Session…'
                            : 'Camera Error · Use Fallback QR'}
                        </span>
                      </button>
                    )}
                    {fallbackMutation.error && (
                      <p role="alert" className="text-red-400">
                        {fallbackMutation.error.message}
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
                  <IconRefresh className="h-4 w-4" /> Restart Camera
                </button>
              </div>
            )}

            {/* Gate Overlay Tag */}
            {cameraActive && (
              <div className="pointer-events-none absolute top-3.5 left-3.5 z-10 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md border border-white/10">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  GATE: {gates.find((g) => g.id === selectedGateId)?.name ?? selectedGateId}
                </span>
              </div>
            )}

            {/* Face Alignment Frame Guide */}
            {cameraActive && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-white/50 shadow-inner">
                  <div className="flex h-full items-end justify-center pb-2">
                    <span className="rounded-full bg-black/70 px-3 py-0.5 text-[11px] font-semibold text-white/90 backdrop-blur-xs border border-white/10">
                      Align face within frame
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
                  alt="Captured scan frame in memory"
                  className="h-16 w-20 rounded-lg object-cover"
                />
                <span className="mt-1 block text-center text-[9px] font-bold tracking-wider text-slate-300 uppercase">
                  Last Frame
                </span>
              </div>
            )}

            {/* Processing Indicator */}
            {isScanning && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#F66B17] border-t-transparent" />
                <p className="mt-3 text-sm font-bold text-white">Analyzing face…</p>
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
                Clear / New Scan
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            * Automatic face detection active; repeated scans for the same person or empty frames
            are suppressed. Click Clear to reset session.
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
                Last Scan Result
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
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <p className="mb-3 text-[11px] font-semibold text-slate-500">
                  Last identified worker — retained until another worker is identified. Not
                  clearance for the person currently in camera.
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 text-sm font-bold text-white shadow-xs">
                    {candidateWorker.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate font-bold text-slate-900">
                      {candidateWorker.displayName}
                    </h4>
                    <p className="text-xs text-slate-600">Account: {candidateWorker.username}</p>
                    <p className="text-xs text-slate-500">
                      ID:{' '}
                      <span className="font-mono font-bold text-slate-700">
                        {candidateWorker.externalId}
                      </span>{' '}
                      · {candidateWorker.contractorName}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                  <span className="text-slate-500 font-medium">Site Assignment:</span>
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
                    {direction} clearance recorded in database.
                  </p>
                  <button
                    type="button"
                    onClick={handleRecordGateEvent}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-all"
                  >
                    <IconCheck className="h-4 w-4" /> Scan Next Worker
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
                  <span>⚡ Launch Dynamic QR Fallback</span>
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
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-xs font-bold text-white hover:bg-red-700 transition-all"
                >
                  <IconRefresh className="h-4 w-4" /> Retry Scan
                </button>
              )}
            </div>
          </div>

          {/* Quick Security Officer Guidelines */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs text-xs text-slate-600 space-y-2">
            <div className="flex items-center gap-2 text-slate-900 font-bold border-b border-slate-100 pb-2">
              <IconShield className="h-4 w-4 text-[#F66B17]" />
              <h5>Security Officer Operating Guidelines (SOP)</h5>
            </div>
            <ul className="list-disc space-y-1 pl-4 text-slate-600">
              <li>
                Webcam match provides preliminary identity verification; backend authorizes access
                based on zone permissions.
              </li>
              <li>
                When clearance is DENIED (red), do not admit worker or initiate QR fallback without
                supervisor authorization.
              </li>
              <li>
                For inconclusive face matches, give the worker a fallback session ID and request
                their dynamic pass from “My QR Pass”.
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
                <h3 className="font-bold text-slate-900">Worker Dynamic QR Fallback</h3>
              </div>
              <button
                type="button"
                aria-label="Close QR fallback modal"
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
                      Worker Fallback Session
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                      Direction: {fallback.direction}
                    </span>
                  </div>
                  <p className="text-xs text-blue-800">
                    Provide this session code to the worker to enter in “My QR Pass”:
                  </p>
                  <div className="rounded-xl border border-blue-200 bg-white p-2.5 font-mono text-xs text-blue-950 font-bold break-all select-all shadow-inner">
                    {fallback.id}
                  </div>
                  <p className="text-[11px] text-blue-700">
                    Expires: <span className="font-semibold">{new Date(fallback.expiresAt).toLocaleTimeString()}</span>
                  </p>
                </div>
              )}
              <QrScannerView disabled={qrProcessing || !fallback} onScan={setQrCodeInput} />
              {qrVerification.error && (
                <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                  <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  <span>{qrVerification.error.message}</span>
                </div>
              )}
              {qrResultMessage && (
                <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                  <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>{qrResultMessage}</span>
                </div>
              )}
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 leading-relaxed">
                ⚠️ Dynamic QR is a fallback method when facial recognition is inconclusive. Security
                officers must physically verify worker credentials and contractor badge before
                granting entry.
              </div>

              <div>
                <label
                  htmlFor="qr-code-input"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700"
                >
                  Worker QR Code or Token
                </label>
                <input
                  id="qr-code-input"
                  type="text"
                  placeholder="SSQ-..."
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
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!fallback || !qrCodeInput.trim() || qrProcessing}
                  onClick={handleConfirmQrFallback}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 shadow-xs"
                >
                  {qrProcessing ? 'Verifying…' : `Confirm ${direction} (QR)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Gate Events Audit Trail */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <IconClock className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Gate Access & Clearance Audit Trail</h3>
              <p className="text-[11px] text-slate-500">
                Verified clearance decisions logged to database
              </p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {recentEvents.length} entries recorded
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3.5 py-3">Timestamp</th>
                <th className="px-3.5 py-3">Worker</th>
                <th className="px-3.5 py-3">Worker ID</th>
                <th className="px-3.5 py-3">Direction</th>
                <th className="px-3.5 py-3">Method</th>
                <th className="px-3.5 py-3">Clearance</th>
                <th className="px-3.5 py-3">Gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accessLogs.isPending && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-xs text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F66B17] border-t-transparent" />
                      <span>Loading gate access logs…</span>
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
                    Unable to load access logs.{' '}
                    <button
                      type="button"
                      onClick={() => void accessLogs.refetch()}
                      className="font-bold underline hover:text-red-900"
                    >
                      Retry
                    </button>
                  </td>
                </tr>
              )}
              {!accessLogs.isPending && !accessLogs.isError && recentEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-slate-400">
                    No gate events recorded for this session yet.
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
                          <span>ALLOWED</span>
                        </>
                      ) : (
                        <>
                          <IconX className="h-3.5 w-3.5" />
                          <span>DENIED</span>
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
