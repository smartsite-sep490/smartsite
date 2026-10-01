import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { IconCamera, IconCheck, IconShield } from '../icons';
import { captureFrameBlob, createSafePreviewUrl, revokeSafePreviewUrl } from './faceGateUtils';
import { CAPTURE_GUIDANCE, enrollmentQualityMessage } from './enrollmentCapture';

export interface WorkerEnrollmentViewProps {
  apiUrl: string;
  token?: string;
  siteId: string;
  sessionScope: string;
}

type EnrollmentStep = 'consent' | 'capture-front' | 'capture-left' | 'capture-right' | 'review';

interface CapturedSample {
  blob: Blob;
  previewUrl: string;
  label: string;
  sizeKb: number;
}

type CaptureTarget = 'front' | 'left' | 'right';

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
  sessionScope,
}: WorkerEnrollmentViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const accounts = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'face-enrollment-accounts'],
    enabled: !!token && !!siteId,
    queryFn: async () => {
      const items = [];
      for (let offset = 0; ; offset += 100) {
        const result = await client.listUsers(token!, { offset, limit: 100 });
        items.push(...result.items);
        if (offset + result.items.length >= result.total || result.items.length === 0) break;
      }
      return items.filter(
        (user) =>
          user.isActive &&
          user.roleAssignments.some(
            (assignment) =>
              assignment.siteId === siteId ||
              (assignment.role === 'ADMIN' && assignment.siteId === null),
          ),
      );
    },
  });

  // The selected existing account owns enrollment; worker records are internal.
  const linkedWorkerKey = [
    'access-control',
    apiUrl,
    sessionScope,
    siteId,
    'face-enrollment-account-worker',
    accountId,
  ];
  const linkedWorker = useQuery({
    queryKey: linkedWorkerKey,
    enabled: !!token && !!siteId && !!accountId,
    queryFn: async () => {
      for (let offset = 0; ; offset += 100) {
        const page = await client.listWorkers(token!, siteId, { offset, limit: 100 });
        const worker = page.items.find((item) => item.userId === accountId);
        if (worker) return worker;
        if (offset + page.items.length >= page.total || page.items.length === 0) return null;
      }
    },
  });
  const selectedWorkerId = linkedWorker.data?.id ?? '';
  const linkAccount = useMutation({
    mutationFn: (userId: string) => client.prepareFaceAccount(token!, siteId, userId),
    onSuccess: async (worker, userId) => {
      queryClient.setQueryData(
        ['access-control', apiUrl, sessionScope, siteId, 'face-enrollment-account-worker', userId],
        worker,
      );
      await queryClient.invalidateQueries({
        queryKey: ['access-control', apiUrl, sessionScope, siteId, 'workers'],
      });
    },
  });
  const profile = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, selectedWorkerId, 'face-profile'],
    enabled: !!token && !!selectedWorkerId,
    queryFn: async () => {
      try {
        return await client.getFaceProfile(token!, selectedWorkerId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const profileStatus = profile.data?.status ?? 'NOT_ENROLLED';
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
  const captureGenerationRef = useRef(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturePhase, setCapturePhase] = useState<'ready' | 'checking' | 'accepted' | 'rejected'>(
    'ready',
  );
  const candidatePreviewRef = useRef<string | null>(null);
  const [candidatePreviewUrl, setCandidatePreviewUrl] = useState<string | null>(null);

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
      captureGenerationRef.current += 1;
      revokeSafePreviewUrl(candidatePreviewRef.current);
      stopCamera();
      revokeAllSamples();
    };
  }, [stopCamera, revokeAllSamples]);

  // When step transitions into capture, ensure camera is active
  const captureActive = captureTargetForStep(currentStep) !== null;
  useEffect(() => {
    if (!captureActive) return;
    let cancelled = false;
    let ownedStream: MediaStream | undefined;
    void navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        ownedStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        if (!cancelled) {
          setCameraError(null);
          setCameraActive(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCameraError(error instanceof Error ? error.message : 'Camera unavailable');
          setCameraActive(false);
        }
      });
    return () => {
      cancelled = true;
      ownedStream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === ownedStream) streamRef.current = null;
    };
  }, [captureActive]);

  const clearCaptureResult = () => {
    captureGenerationRef.current += 1;
    revokeSafePreviewUrl(candidatePreviewRef.current);
    candidatePreviewRef.current = null;
    setCandidatePreviewUrl(null);
    setCapturePhase('ready');
    setCountdown(null);
    setQualityMessage(null);
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
      qualityCheckInFlightRef.current
    )
      return;
    const generation = captureGenerationRef.current;
    qualityCheckInFlightRef.current = true;
    setIsQualityChecking(true);
    setCapturePhase('checking');
    setQualityMessage('Máy đã chụp ảnh. Đang kiểm tra chất lượng và hướng mặt…');
    try {
      const blob = await captureFrameBlob(video, { maxWidth: 1280, quality: 0.92 });
      if (generation !== captureGenerationRef.current) return;
      const url = createSafePreviewUrl(blob, candidatePreviewRef.current);
      candidatePreviewRef.current = url;
      setCandidatePreviewUrl(url);
      const quality = await client.checkFaceEnrollmentQuality(
        token,
        selectedWorkerId,
        blob,
        target,
      );
      if (generation !== captureGenerationRef.current) return;
      setQualityMessage(enrollmentQualityMessage(quality.reasonCode));
      if (quality.status !== 'ACCEPTED' || quality.reasonCode !== 'FACE_QUALITY_ACCEPTED') {
        setCapturePhase('rejected');
        return;
      }
      setSamples((previous) => ({
        ...previous,
        [target]: {
          blob,
          previewUrl: createSafePreviewUrl(blob, previous[target]?.previewUrl),
          label: CAPTURE_GUIDANCE[target].title,
          sizeKb: Math.round(blob.size / 1024),
        },
      }));
      setCapturePhase('accepted');
    } catch {
      if (generation !== captureGenerationRef.current) return;
      setCapturePhase('rejected');
      setQualityMessage(
        'Không kiểm tra được ảnh với máy chủ. Ảnh chưa được chấp nhận. Hãy kiểm tra kết nối rồi chụp lại.',
      );
    } finally {
      qualityCheckInFlightRef.current = false;
      if (generation === captureGenerationRef.current) setIsQualityChecking(false);
    }
  }, [cameraActive, client, currentStep, selectedWorkerId, token]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = window.setTimeout(() => {
      if (countdown > 1) setCountdown(countdown - 1);
      else {
        setCountdown(null);
        void checkAndCaptureCurrentFrame();
      }
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown, checkAndCaptureCurrentFrame]);

  const beginCapture = () => {
    const target = captureTargetForStep(currentStep);
    if (!target || !cameraActive || qualityCheckInFlightRef.current || countdown !== null) return;
    clearCaptureResult();
    setSamples((previous) => {
      revokeSafePreviewUrl(previous[target]?.previewUrl);
      return { ...previous, [target]: null };
    });
    setCountdown(3);
    setQualityMessage('Giữ yên đầu. Máy sẽ chụp sau 3 giây.');
  };

  const continueCapture = () => {
    const target = captureTargetForStep(currentStep);
    if (!target || capturePhase !== 'accepted' || !samples[target]) return;
    clearCaptureResult();
    if (target === 'front') setCurrentStep('capture-left');
    else if (target === 'left') setCurrentStep('capture-right');
    else {
      stopCamera();
      setCurrentStep('review');
    }
  };

  const retakeCapture = (target: CaptureTarget) => {
    if (isQualityChecking || countdown !== null) return;
    clearCaptureResult();
    setSamples((previous) => {
      revokeSafePreviewUrl(previous[target]?.previewUrl);
      return { ...previous, [target]: null };
    });
    setCurrentStep(`capture-${target}`);
  };

  // Submit enrollment with 3 in-memory samples
  const handleSubmitEnrollment = async () => {
    if (!selectedWorkerId || !token || !linkedWorker.data?.userId) {
      setSubmissionError('Chọn account có sẵn trước khi đăng ký khuôn mặt.');
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
      await queryClient.invalidateQueries({
        queryKey: [
          'access-control',
          apiUrl,
          sessionScope,
          siteId,
          selectedWorkerId,
          'face-profile',
        ],
      });
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
  const handleRevokeProfile = async () => {
    if (
      window.confirm(
        'Are you sure you want to revoke this biometric profile? The worker will need to re-enroll before using face gate.',
      )
    ) {
      if (!token) return;
      try {
        await client.revokeFaceProfile(token, selectedWorkerId);
        await queryClient.invalidateQueries({
          queryKey: [
            'access-control',
            apiUrl,
            sessionScope,
            siteId,
            selectedWorkerId,
            'face-profile',
          ],
        });
        setStatusMessage('Face profile revoked. Its database template has been removed.');
        handleResetWorkflow();
      } catch (error) {
        setSubmissionError(
          error instanceof Error ? error.message : 'Could not revoke the face profile.',
        );
      }
    }
  };

  // Reset workflow
  const handleResetWorkflow = () => {
    clearCaptureResult();
    setIsQualityChecking(false);
    stopCamera();
    revokeAllSamples();
    setCurrentStep('consent');
    setConsentAcknowledged(false);
    setSubmissionSuccess(false);
    setSubmissionError(null);
    setQualityMessage(null);
  };

  const selectedWorker = linkedWorker.data;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-bold">Đăng ký khuôn mặt cho account có sẵn</h2>
        <p className="mt-1 text-xs text-slate-600">
          Tìm và chọn account đang hoạt động tại công trình. Không tạo account hoặc nhập nhân công
          riêng ở đây.
        </p>
        <label htmlFor="face-account-search" className="mt-3 block text-xs font-semibold">
          Tìm account
        </label>
        <input
          id="face-account-search"
          value={accountSearch}
          onChange={(event) => setAccountSearch(event.target.value)}
          placeholder="Username hoặc họ tên"
          className="mt-1 w-full rounded border p-2"
          disabled={isSubmitting || currentStep !== 'consent'}
        />
        <label htmlFor="face-account" className="mt-3 block text-xs font-semibold">
          Account đăng ký
        </label>
        <div className="mt-2 flex gap-2">
          <select
            id="face-account"
            value={accountId}
            onChange={(event) => {
              handleResetWorkflow();
              setStatusMessage(null);
              linkAccount.reset();
              setAccountId(event.target.value);
            }}
            disabled={
              accounts.isPending ||
              accounts.isError ||
              linkAccount.isPending ||
              isSubmitting ||
              currentStep !== 'consent'
            }
            className="min-w-0 flex-1 rounded border p-2"
          >
            <option value="">Chọn account đã có trên hệ thống</option>
            {accounts.data
              ?.filter(
                (user) =>
                  user.id === accountId ||
                  (user.username + ' ' + user.displayName)
                    .toLocaleLowerCase()
                    .includes(accountSearch.trim().toLocaleLowerCase()),
              )
              .map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username} — {user.displayName}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => linkAccount.mutate(accountId)}
            disabled={
              !accountId ||
              linkedWorker.isPending ||
              linkedWorker.isError ||
              !!selectedWorkerId ||
              linkAccount.isPending
            }
            className="rounded bg-orange-600 px-3 text-white disabled:opacity-50"
          >
            {linkAccount.isPending
              ? 'Đang chuẩn bị…'
              : selectedWorkerId
                ? 'Đã chọn account'
                : 'Dùng account này'}
          </button>
        </div>
        {accounts.isError && (
          <p role="alert">
            Không tải được account.{' '}
            <button type="button" onClick={() => void accounts.refetch()}>
              Thử lại
            </button>
          </p>
        )}
        {linkedWorker.isError && (
          <p role="alert">
            Không tải được hồ sơ.{' '}
            <button type="button" onClick={() => void linkedWorker.refetch()}>
              Thử lại
            </button>
          </p>
        )}
        {accounts.data?.length === 0 && (
          <p className="mt-2 text-sm">
            Chưa có account phù hợp. Tạo account và gán công trình trong quản lý tài khoản trước.
          </p>
        )}
        {linkAccount.error && <p role="alert">{linkAccount.error.message}</p>}
      </section>

      {/* Header and Worker Status Bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <span className="block text-xs font-semibold text-slate-500">Account đã chọn</span>
            <p className="mt-1 text-sm font-semibold">
              {accounts.data?.find((user) => user.id === accountId)?.username ??
                'Chưa chọn account'}
            </p>
            <p className="text-xs text-slate-500">
              {selectedWorker?.displayName ?? 'Chọn account trước khi đăng ký khuôn mặt'}
            </p>
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
              onClick={() => void handleRevokeProfile()}
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
              SmartSite stores encrypted biometric templates in PostgreSQL, linked to your account,
              from 3 guided camera captures strictly for access verification at authorized site
              gates.
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
              disabled={
                !consentAcknowledged ||
                !selectedWorker ||
                !linkedWorker.data?.userId ||
                !linkedWorker.data?.isActive ||
                linkedWorker.isPending ||
                linkedWorker.isError
              }
              onClick={() => retakeCapture('front')}
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
                className={`h-full w-full -scale-x-100 object-cover ${cameraActive && !candidatePreviewUrl ? 'block' : 'hidden'}`}
              />

              {candidatePreviewUrl && (
                <img
                  src={candidatePreviewUrl}
                  alt="Ảnh máy vừa chụp để kiểm tra chất lượng"
                  className="h-full w-full -scale-x-100 object-cover"
                />
              )}
              {countdown !== null && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                  <span className="text-8xl font-bold text-white" aria-live="assertive">
                    {countdown}
                  </span>
                </div>
              )}

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
                    {CAPTURE_GUIDANCE[captureTargetForStep(currentStep)!].title}
                  </div>

                  <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-[#F66B17] shadow-inner" />

                  <span className="rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/80">
                    {candidatePreviewUrl
                      ? capturePhase === 'accepted'
                        ? 'Ảnh đạt yêu cầu'
                        : capturePhase === 'rejected'
                          ? 'Ảnh chưa đạt — chụp lại'
                          : 'Ảnh đã chụp — đang kiểm tra'
                      : 'Đưa mặt vào khung, đủ sáng và giữ yên'}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p
                role="status"
                aria-live="polite"
                className={`text-sm font-medium ${capturePhase === 'rejected' ? 'text-red-700' : capturePhase === 'accepted' ? 'text-emerald-700' : 'text-slate-700'}`}
              >
                {qualityMessage ?? CAPTURE_GUIDANCE[captureTargetForStep(currentStep)!].detail}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!cameraActive || isQualityChecking || countdown !== null}
                  onClick={beginCapture}
                  className="rounded-xl bg-orange-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {countdown !== null
                    ? `Giữ yên — ${countdown}`
                    : isQualityChecking
                      ? 'Đang kiểm tra ảnh…'
                      : capturePhase === 'ready'
                        ? 'Tôi đã sẵn sàng — Chụp sau 3 giây'
                        : 'Chụp lại góc này'}
                </button>
                <button
                  type="button"
                  disabled={capturePhase !== 'accepted' || isQualityChecking}
                  onClick={continueCapture}
                  className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-40"
                >
                  {currentStep === 'capture-right'
                    ? 'Ảnh đạt — Xem lại 3 ảnh'
                    : 'Ảnh đạt — Sang góc tiếp theo'}
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Máy kiểm tra một khuôn mặt, kích thước/vị trí, độ sáng, độ nét và hướng tương đối từ
                điểm trên mặt. Đây chưa phải xác minh người thật hoặc đo góc chính xác.
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
                    onClick={() => retakeCapture('front')}
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
                    onClick={() => retakeCapture('left')}
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
                    onClick={() => retakeCapture('right')}
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
                    onClick={() => retakeCapture('front')}
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
                    onClick={() => retakeCapture('left')}
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
                    onClick={() => retakeCapture('right')}
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
                onClick={() => retakeCapture('front')}
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
