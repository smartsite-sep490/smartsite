import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FaceProfileStatus } from '@smartsite/contracts';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconClock,
  IconRefresh,
  IconShield,
  IconUser,
  IconX,
} from '../icons';
import { captureFrameBlob, createSafePreviewUrl, revokeSafePreviewUrl } from './faceGateUtils';

export interface WorkerEnrollmentViewProps {
  apiUrl: string;
  token?: string;
  siteId: string;
  workers: Array<{ id: string; externalId: string; displayName: string }>;
}

type EnrollmentStep = 'consent' | 'capture-front' | 'capture-left' | 'capture-right' | 'review';

interface CapturedSample {
  blob: Blob;
  previewUrl: string;
  label: string;
  sizeKb: number;
}

type CaptureTarget = 'front' | 'left' | 'right';

type WorkerOption = { id: string; externalId: string; displayName: string };

const CONSENT_VERSION = 'v1.0-2026';

function captureTargetForStep(step: EnrollmentStep): CaptureTarget | null {
  if (step === 'capture-front') return 'front';
  if (step === 'capture-left') return 'left';
  if (step === 'capture-right') return 'right';
  return null;
}

export function WorkerEnrollmentView({
  apiUrl,
  token,
  siteId,
  workers,
}: WorkerEnrollmentViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);

  // Selected worker & profile state
  const [selectedWorkerId, setSelectedWorkerId] = useState(workers[0]?.id ?? '');
  const [createdWorkers, setCreatedWorkers] = useState<WorkerOption[]>([]);
  const [newWorkerExternalId, setNewWorkerExternalId] = useState('');
  const [newWorkerDisplayName, setNewWorkerDisplayName] = useState('');
  const [isCreatingWorker, setIsCreatingWorker] = useState(false);
  const [createWorkerError, setCreateWorkerError] = useState<string | null>(null);
  const [profileStatus, setProfileStatus] = useState<FaceProfileStatus | 'NOT_ENROLLED'>(
    'NOT_ENROLLED',
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Enrollment workflow steps
  const [currentStep, setCurrentStep] = useState<EnrollmentStep>('consent');
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);

  // Camera state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [qualityMessage, setQualityMessage] = useState<string | null>(null);
  const [isQualityChecking, setIsQualityChecking] = useState(false);
  const qualityCheckInFlightRef = useRef(false);

  // Three guided captured samples held strictly in component memory
  const [samples, setSamples] = useState<{
    front: CapturedSample | null;
    left: CapturedSample | null;
    right: CapturedSample | null;
  }>({
    front: null,
    left: null,
    right: null,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  const workerOptions = useMemo(() => {
    const workersById = new Map<string, WorkerOption>();
    workers.forEach((worker) => workersById.set(worker.id, worker));
    createdWorkers.forEach((worker) => workersById.set(worker.id, worker));
    return [...workersById.values()];
  }, [createdWorkers, workers]);

  useEffect(() => {
    if (!selectedWorkerId && workerOptions[0]) setSelectedWorkerId(workerOptions[0].id);
  }, [selectedWorkerId, workerOptions]);

  // Revoke all preview URLs helper
  const revokeAllSamples = useCallback(() => {
    setSamples((prev) => {
      revokeSafePreviewUrl(prev.front?.previewUrl);
      revokeSafePreviewUrl(prev.left?.previewUrl);
      revokeSafePreviewUrl(prev.right?.previewUrl);
      return { front: null, left: null, right: null };
    });
  }, []);

  // Camera start / stop
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraActive(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webcam error';
      setCameraError(`Camera could not be started: ${message}.`);
      setCameraActive(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
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
    return () => {
      stopCamera();
      revokeAllSamples();
    };
  }, [stopCamera, revokeAllSamples]);

  // When step transitions into capture, ensure camera is active
  useEffect(() => {
    if (currentStep !== 'consent' && currentStep !== 'review') {
      void startCamera();
    } else {
      stopCamera();
    }
  }, [currentStep, startCamera, stopCamera]);

  // Capture current sample frame
  const handleCaptureFrame = async (target: CaptureTarget, providedBlob?: Blob) => {
    const video = videoRef.current;
    if (!video || !cameraActive) return;

    try {
      const blob = providedBlob ?? (await captureFrameBlob(video, { maxWidth: 1280, quality: 0.92 }));
      if (!providedBlob && token && selectedWorkerId) {
        const quality = await client.checkFaceEnrollmentQuality(token, selectedWorkerId, blob);
        if (quality.status !== 'ACCEPTED') {
          setQualityMessage(
            'ChÆ°a Ä‘áº¡t: chá»‰ Ä‘á»ƒ má»™t ngÆ°á»i trong khung, Ä‘Æ°a máº·t vÃ o giá»¯a vÃ  Ä‘á»§ sÃ¡ng.',
          );
          return;
        }
      }
      const previousUrl = samples[target]?.previewUrl;
      const previewUrl = createSafePreviewUrl(blob, previousUrl);

      const labels = {
        front: 'Front (Straight)',
        left: 'Turn 15° Left',
        right: 'Turn 15° Right',
      };

      setSamples((prev) => ({
        ...prev,
        [target]: {
          blob,
          previewUrl,
          label: labels[target],
          sizeKb: Math.round(blob.size / 1024),
        },
      }));

      // Auto advance to next guided capture step
      if (target === 'front') setCurrentStep('capture-left');
      else if (target === 'left') setCurrentStep('capture-right');
      else if (target === 'right') setCurrentStep('review');
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Failed to capture frame.');
    }
  };

  const checkAndCaptureCurrentFrame = useCallback(async () => {
    const target = captureTargetForStep(currentStep);
    const video = videoRef.current;
    if (
      !target ||
      !video ||
      !cameraActive ||
      !token ||
      !selectedWorkerId ||
      qualityCheckInFlightRef.current ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    )
      return;

    qualityCheckInFlightRef.current = true;
    setIsQualityChecking(true);
    setQualityMessage('Đang kiểm tra khuôn mặt…');
    const stepAtStart = currentStep;
    try {
      const blob = await captureFrameBlob(video, { maxWidth: 1280, quality: 0.92 });
      const quality = await client.checkFaceEnrollmentQuality(token, selectedWorkerId, blob);
      if (quality.status === 'ACCEPTED' && captureTargetForStep(stepAtStart) === target) {
        const labels = {
          front: 'Front (Straight)',
          left: 'Turn 15 degrees Left',
          right: 'Turn 15 degrees Right',
        };
        setSamples((previous) => {
          const previewUrl = createSafePreviewUrl(blob, previous[target]?.previewUrl);
          return {
            ...previous,
            [target]: {
              blob,
              previewUrl,
              label: labels[target],
              sizeKb: Math.round(blob.size / 1024),
            },
          };
        });
        setQualityMessage('Ảnh đạt yêu cầu, đã tự động lưu.');
        if (target === 'front') setCurrentStep('capture-left');
        else if (target === 'left') setCurrentStep('capture-right');
        else setCurrentStep('review');
      } else {
        setQualityMessage(
          'Chưa đạt: chỉ để một người trong khung, đưa mặt vào giữa và đủ sáng. Đang tự thử lại…',
        );
      }
    } catch (err) {
      setQualityMessage(
        err instanceof Error
          ? `${err.message} Đang tự thử lại…`
          : 'Chưa kiểm tra được ảnh. Đang tự thử lại…',
      );
    } finally {
      qualityCheckInFlightRef.current = false;
      setIsQualityChecking(false);
    }
  }, [cameraActive, client, currentStep, selectedWorkerId, token]);

  useEffect(() => {
    if (!cameraActive || !captureTargetForStep(currentStep)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await checkAndCaptureCurrentFrame();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1_200);
    };
    timer = window.setTimeout(() => void poll(), 450);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [cameraActive, checkAndCaptureCurrentFrame, currentStep]);

  const handleCreateWorker = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const externalId = newWorkerExternalId.trim();
    const displayName = newWorkerDisplayName.trim();
    if (!externalId || !displayName) {
      setCreateWorkerError('Nhập mã nhân công và họ tên trước khi đăng ký khuôn mặt.');
      return;
    }
    if (!token || !siteId) {
      setCreateWorkerError('Bạn cần đăng nhập và chọn công trường trước.');
      return;
    }

    setIsCreatingWorker(true);
    setCreateWorkerError(null);
    try {
      const worker = await client.createWorker(token, siteId, { externalId, displayName });
      setCreatedWorkers((previous) => [
        ...previous.filter((entry) => entry.id !== worker.id),
        worker,
      ]);
      setSelectedWorkerId(worker.id);
      setNewWorkerExternalId('');
      setNewWorkerDisplayName('');
      revokeAllSamples();
      setCurrentStep('consent');
      setConsentAcknowledged(false);
      setSubmissionSuccess(false);
      setSubmissionError(null);
      setQualityMessage(null);
      setProfileStatus('NOT_ENROLLED');
      setStatusMessage(`Đã tạo hồ sơ cho ${worker.displayName}. Tiếp tục xác nhận và chụp khuôn mặt.`);
    } catch (err) {
      setCreateWorkerError(err instanceof Error ? err.message : 'Không thể tạo hồ sơ nhân công.');
    } finally {
      setIsCreatingWorker(false);
    }
  };

  // Submit enrollment with 3 in-memory samples
  const handleSubmitEnrollment = async () => {
    if (!selectedWorkerId || !token) {
      setSubmissionError('Tạo hoặc chọn nhân công trước khi gửi đăng ký khuôn mặt.');
      return;
    }
    if (!samples.front || !samples.left || !samples.right) {
      setSubmissionError('All 3 guided face samples are required before submitting.');
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const session = await client.startFaceEnrollment(token, selectedWorkerId, CONSENT_VERSION);

      for (const sample of [samples.front.blob, samples.left.blob, samples.right.blob]) {
        await client.uploadFaceEnrollmentSample(token, session.id, sample);
      }

      const profile = await client.completeFaceEnrollment(token, session.id);
      if (profile.status !== 'ACTIVE')
        throw new Error('Backend did not activate the face profile.');
      setProfileStatus('ACTIVE');
      setSubmissionSuccess(true);
      setStatusMessage('Face biometric profile successfully registered and active.');
    } catch (err) {
      setSubmissionError(
        err instanceof Error ? err.message : 'Failed to submit enrollment session.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revoke profile action
  const handleRevokeProfile = () => {
    if (
      window.confirm(
        'Are you sure you want to revoke this biometric profile? The worker will need to re-enroll before using face gate.',
      )
    ) {
      setProfileStatus('REVOKED');
      setStatusMessage('FaceProfile has been revoked. Re-enrollment required.');
      handleResetWorkflow();
    }
  };

  // Reset workflow
  const handleResetWorkflow = () => {
    revokeAllSamples();
    setCurrentStep('consent');
    setConsentAcknowledged(false);
    setSubmissionSuccess(false);
    setSubmissionError(null);
    setQualityMessage(null);
  };

  const selectedWorker = workerOptions.find((worker) => worker.id === selectedWorkerId);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-xs">
        <div>
          <h2 className="text-sm font-bold text-slate-950">Tạo nhân công để đăng ký khuôn mặt</h2>
          <p className="mt-1 text-xs text-slate-600">
            Tự nhập mã và họ tên. Thông tin này sẽ được hiện tại Gate Desk khi khuôn mặt được nhận diện.
          </p>
        </div>
        <form onSubmit={handleCreateWorker} className="mt-4 grid gap-3 sm:grid-cols-[0.7fr_1fr_auto]">
          <label className="text-xs font-semibold text-slate-700">
            Mã nhân công
            <input
              required
              maxLength={64}
              value={newWorkerExternalId}
              onChange={(event) => setNewWorkerExternalId(event.target.value)}
              placeholder="WRK-001"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Họ và tên
            <input
              required
              maxLength={255}
              value={newWorkerDisplayName}
              onChange={(event) => setNewWorkerDisplayName(event.target.value)}
              placeholder="Nguyễn Văn A"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={isCreatingWorker || !siteId}
            className="self-end rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {isCreatingWorker ? 'Đang tạo…' : 'Tạo & chọn'}
          </button>
        </form>
        {createWorkerError && <p role="alert" className="mt-3 text-xs font-medium text-red-700">{createWorkerError}</p>}
      </section>

      {/* Header and Worker Status Bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="worker-select"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-500"
            >
              Select Worker
            </label>
            <select
              id="worker-select"
              value={selectedWorkerId}
              onChange={(e) => {
                setSelectedWorkerId(e.target.value);
                handleResetWorkflow();
              }}
              disabled={workerOptions.length === 0}
              className="mt-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-[#F66B17] focus:outline-none"
            >
              {workerOptions.length === 0 && <option value="">Tạo nhân công ở trên trước</option>}
              {workerOptions.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.displayName} ({worker.externalId})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-4">
            <span className="text-xs text-slate-500">Face Profile: </span>
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
                profileStatus === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-800'
                  : profileStatus === 'REVOKED'
                    ? 'bg-red-100 text-red-800'
                    : profileStatus === 'NEEDS_REENROLL'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-600'
              }`}
            >
              {profileStatus}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profileStatus === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleRevokeProfile}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
            >
              Revoke Profile
            </button>
          )}
          <button
            type="button"
            onClick={handleResetWorkflow}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            New Enrollment Session
          </button>
        </div>
      </section>

      {statusMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800">
          ✓ {statusMessage}
        </div>
      )}

      {/* Step Progress Indicator */}
      <nav
        aria-label="Enrollment Steps"
        className="flex items-center justify-between border-b border-slate-200 pb-3 text-xs"
      >
        <div
          className={`flex items-center gap-2 ${currentStep === 'consent' ? 'font-bold text-[#F66B17]' : 'text-slate-500'}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
            1
          </span>
          <span>Consent</span>
        </div>
        <span className="text-slate-300">→</span>
        <div
          className={`flex items-center gap-2 ${currentStep === 'capture-front' ? 'font-bold text-[#F66B17]' : 'text-slate-500'}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
            2
          </span>
          <span>Front Face</span>
        </div>
        <span className="text-slate-300">→</span>
        <div
          className={`flex items-center gap-2 ${currentStep === 'capture-left' ? 'font-bold text-[#F66B17]' : 'text-slate-500'}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
            3
          </span>
          <span>Left Angle</span>
        </div>
        <span className="text-slate-300">→</span>
        <div
          className={`flex items-center gap-2 ${currentStep === 'capture-right' ? 'font-bold text-[#F66B17]' : 'text-slate-500'}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
            4
          </span>
          <span>Right Angle</span>
        </div>
        <span className="text-slate-300">→</span>
        <div
          className={`flex items-center gap-2 ${currentStep === 'review' ? 'font-bold text-[#F66B17]' : 'text-slate-500'}`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100">
            5
          </span>
          <span>Review & Submit</span>
        </div>
      </nav>

      {/* STEP 1: Consent Acknowledgment */}
      {currentStep === 'consent' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#F66B17]">
              <IconShield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">
                Biometric Consent Notice ({CONSENT_VERSION})
              </h3>
              <p className="text-xs text-slate-500">MF01 Worker Onboarding Compliance</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
            <p>
              SmartSite utilizes local, encrypted biometric templates derived from 3 guided camera
              captures strictly for access verification at authorized site gates.
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Raw photos and embeddings are never stored in public database fields or browser
                storage.
              </li>
              <li>
                Face identification is limited to gate access points and does not perform continuous
                CCTV tracking.
              </li>
              <li>
                You may request profile revocation or re-enrollment at any time through your
                Contractor Representative.
              </li>
            </ul>
          </div>

          <label className="mt-5 flex items-start gap-3 text-xs font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={consentAcknowledged}
              onChange={(e) => setConsentAcknowledged(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-[#F66B17] focus:ring-[#F66B17]"
            />
            <span>
              I confirm that the worker ({selectedWorker?.displayName}) has reviewed and agreed to
              the biometric data collection terms under consent version {CONSENT_VERSION}.
            </span>
          </label>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={!consentAcknowledged || !selectedWorker}
              onClick={() => setCurrentStep('capture-front')}
              className="rounded-xl bg-[#F66B17] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#e05b0d] disabled:opacity-50"
            >
              Begin Guided Captures →
            </button>
          </div>
        </section>
      )}

      {/* STEPS 2, 3, 4: Guided Webcam Captures */}
      {(currentStep === 'capture-front' ||
        currentStep === 'capture-left' ||
        currentStep === 'capture-right') && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Left: Live Viewport with Target Angle Prompt */}
          <div className="space-y-3 lg:col-span-8">
            <div className="relative aspect-4/3 w-full overflow-hidden rounded-2xl border-2 border-slate-800 bg-slate-950 shadow-md">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />

              {!cameraActive && (
                <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-slate-400">
                  <IconCamera className="mb-3 h-10 w-10 text-slate-600" />
                  <p className="text-sm font-semibold text-slate-300">Activating Guided Camera…</p>
                  {cameraError && <p className="mt-2 text-xs text-red-400">{cameraError}</p>}
                </div>
              )}

              {/* Angle Prompt Overlay */}
              {cameraActive && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between p-6">
                  <div className="rounded-full bg-black/70 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-xs">
                    {currentStep === 'capture-front' && 'Step 1/3: Look Straight into the Camera'}
                    {currentStep === 'capture-left' && 'Step 2/3: Turn Head Slightly Left (~15°)'}
                    {currentStep === 'capture-right' && 'Step 3/3: Turn Head Slightly Right (~15°)'}
                  </div>

                  <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-[#F66B17] shadow-inner" />

                  <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
                    Ensure face is centered with good lighting
                  </span>
                </div>
              )}
            </div>

            {/* Shutter Button */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!cameraActive || isQualityChecking}
                onClick={() => {
                  if (currentStep === 'capture-front') void handleCaptureFrame('front');
                  else if (currentStep === 'capture-left') void handleCaptureFrame('left');
                  else if (currentStep === 'capture-right') void handleCaptureFrame('right');
                }}
                className="flex-1 rounded-xl bg-[#F66B17] py-3 text-center text-sm font-bold text-white shadow-xs hover:bg-[#e05b0d] disabled:opacity-50"
              >
                📸 Capture{' '}
                {currentStep === 'capture-front'
                  ? 'Front Sample'
                  : currentStep === 'capture-left'
                    ? 'Left Sample'
                    : 'Right Sample'}
              </button>
              <p className="text-xs text-slate-500">
                {qualityMessage ?? 'Đang tự kiểm tra; ảnh đạt yêu cầu sẽ được chụp tự động.'}
              </p>
            </div>
          </div>

          {/* Right: Captured Samples Strip */}
          <div className="space-y-4 lg:col-span-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Captured Samples
            </h4>

            {/* Slot 1: Front */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">1. Front View</span>
                {samples.front ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Ready ({samples.front.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400">Pending</span>
                )}
              </div>
              {samples.front && (
                <div className="mt-2 flex items-center gap-3">
                  <img
                    src={samples.front.previewUrl}
                    alt="Front capture"
                    className="h-14 w-18 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-front')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Slot 2: Left */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">2. Left 15°</span>
                {samples.left ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Ready ({samples.left.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400">Pending</span>
                )}
              </div>
              {samples.left && (
                <div className="mt-2 flex items-center gap-3">
                  <img
                    src={samples.left.previewUrl}
                    alt="Left capture"
                    className="h-14 w-18 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-left')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Slot 3: Right */}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">3. Right 15°</span>
                {samples.right ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Ready ({samples.right.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400">Pending</span>
                )}
              </div>
              {samples.right && (
                <div className="mt-2 flex items-center gap-3">
                  <img
                    src={samples.right.previewUrl}
                    alt="Right capture"
                    className="h-14 w-18 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-right')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Shortcut to Review if all 3 exist */}
            {samples.front && samples.left && samples.right && (
              <button
                type="button"
                onClick={() => setCurrentStep('review')}
                className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-bold text-white hover:bg-slate-800"
              >
                Proceed to Review →
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 5: Review & Submit */}
      {currentStep === 'review' && (
        <section className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900">Review 3 Guided Face Samples</h3>
            <p className="text-xs text-slate-500">
              Worker:{' '}
              <span className="font-semibold text-slate-800">{selectedWorker?.displayName}</span> (
              {selectedWorker?.externalId})
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Front Review */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold text-slate-700">1. Front View</p>
              {samples.front ? (
                <div className="mt-2 space-y-2">
                  <img
                    src={samples.front.previewUrl}
                    alt="Front sample"
                    className="mx-auto h-32 w-full rounded-lg object-cover"
                  />
                  <p className="text-[11px] text-slate-500">{samples.front.sizeKb} KB · JPEG</p>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-front')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs text-red-600">Missing</p>
              )}
            </div>

            {/* Left Review */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold text-slate-700">2. Left 15°</p>
              {samples.left ? (
                <div className="mt-2 space-y-2">
                  <img
                    src={samples.left.previewUrl}
                    alt="Left sample"
                    className="mx-auto h-32 w-full rounded-lg object-cover"
                  />
                  <p className="text-[11px] text-slate-500">{samples.left.sizeKb} KB · JPEG</p>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-left')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs text-red-600">Missing</p>
              )}
            </div>

            {/* Right Review */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-semibold text-slate-700">3. Right 15°</p>
              {samples.right ? (
                <div className="mt-2 space-y-2">
                  <img
                    src={samples.right.previewUrl}
                    alt="Right sample"
                    className="mx-auto h-32 w-full rounded-lg object-cover"
                  />
                  <p className="text-[11px] text-slate-500">{samples.right.sizeKb} KB · JPEG</p>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('capture-right')}
                    className="text-xs font-semibold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs text-red-600">Missing</p>
              )}
            </div>
          </div>

          {submissionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              ⚠️ {submissionError}
            </div>
          )}

          {submissionSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
                <IconCheck className="h-5 w-5" />
              </div>
              <h4 className="font-bold text-emerald-900">Enrollment Completed</h4>
              <p className="mt-1 text-xs text-emerald-700">
                Encrypted biometric profile is now active. The worker can authenticate at the
                security gate desk.
              </p>
              <button
                type="button"
                onClick={handleResetWorkflow}
                className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
              >
                Enroll Another Worker
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setCurrentStep('capture-front')}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back to Captures
              </button>
              <button
                type="button"
                disabled={isSubmitting || !samples.front || !samples.left || !samples.right}
                onClick={handleSubmitEnrollment}
                className="rounded-xl bg-[#F66B17] px-6 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#e05b0d] disabled:opacity-50"
              >
                {isSubmitting ? 'Registering Encrypted Profile…' : 'Confirm & Register Biometrics'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
