import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { IconCamera, IconCheck, IconShield, IconUsers } from '../icons';
import { captureFrameBlob, createSafePreviewUrl, revokeSafePreviewUrl } from './faceGateUtils';
import { GateCameraSession } from './gateCameraSession';
import { inspectGateCamera } from './gateCameraReadiness';

export interface WorkerEnrollmentViewProps {
  apiUrl: string;
  token?: string;
  siteId: string;
  sessionScope: string;
  canManageAccounts?: boolean;
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

const EN_CAPTURE_GUIDANCE: Record<CaptureTarget, { title: string; detail: string }> = {
  front: {
    title: 'Step 1/3: Look directly into camera',
    detail:
      'Position your entire face in the frame, look straight ahead, keep head level and hold still.',
  },
  left: {
    title: 'Step 2/3: Turn slightly to your left',
    detail:
      'Turn your whole head slowly to your left without tilting. Keep face in frame and hold still.',
  },
  right: {
    title: 'Step 3/3: Turn slightly to your right',
    detail: 'Turn your head from center slowly to your right. Do not turn too far and hold still.',
  },
};

function getEnrollmentEnglishMessage(reasonCode: string): string {
  const map: Record<string, string> = {
    FACE_QUALITY_ACCEPTED:
      'Sample accepted: single face, good lighting, clear focus, within frame and properly oriented.',
    FACE_NOT_FOUND: 'No face detected. Position your entire face in frame and retake.',
    FACE_MULTIPLE_FOUND: 'Multiple faces detected. Only the enrolling worker should be in frame.',
    FACE_TOO_SMALL: 'Face is too far. Step closer to the camera.',
    FACE_TOO_CLOSE: 'Face is too close. Step back slightly to fit full face in frame.',
    FACE_CLIPPED: 'Face is clipped at edge. Position your whole face within frame.',
    FACE_NOT_CENTERED: 'Face is off-center. Align with center frame.',
    FACE_TOO_DARK: 'Lighting too dim. Face toward a light source.',
    FACE_TOO_BRIGHT: 'Lighting too bright. Avoid direct glare.',
    FACE_BLURRY: 'Image blurry. Hold still and ensure camera lens is clean.',
    FACE_HEAD_TILTED: 'Head is tilted. Keep your head straight without tilting shoulders.',
    FACE_TURN_TOO_FAR: 'Turned too far. Turn slightly so facial landmarks remain visible.',
    FACE_POSE_FRONT_REQUIRED: 'Frontal angle required. Look directly into the camera.',
    FACE_POSE_LEFT_REQUIRED: 'Left angle required. Turn slightly to your left and retake.',
    FACE_POSE_RIGHT_REQUIRED: 'Right angle required. Turn slightly to your right and retake.',
    FACE_NOT_CLEAR: 'Face not clearly visible. Hold still, remove coverings, and adjust light.',
    FACE_LANDMARKS_UNAVAILABLE:
      'Facial landmarks could not be identified. Remove coverings and pose directly.',
    FACE_IMAGE_INVALID: 'Captured image could not be processed. Please retake.',
  };
  return (
    map[reasonCode] ?? 'Sample does not meet quality requirements. Adjust lighting and hold still.'
  );
}

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
  canManageAccounts = true,
}: WorkerEnrollmentViewProps) {
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const queryClient = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [directWorkerId, setDirectWorkerId] = useState('');
  const enrollmentSession = useRef<{ id: string; workerId: string; consentToken?: string } | null>(
    null,
  );
  const workerChoices = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'enrollment-worker-choices'],
    enabled: !!token && !!siteId,
    queryFn: () => client.listWorkers(token!, siteId, { limit: 100 }),
  });
  const [accountSearch, setAccountSearch] = useState('');
  const accounts = useQuery({
    queryKey: ['access-control', apiUrl, sessionScope, siteId, 'face-enrollment-accounts'],
    enabled: canManageAccounts && !!token && !!siteId,
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
    directWorkerId,
  ];
  const linkedWorker = useQuery({
    queryKey: linkedWorkerKey,
    enabled: !!token && !!siteId && (!!accountId || !!directWorkerId),
    queryFn: async () => {
      for (let offset = 0; ; offset += 100) {
        const page = await client.listWorkers(token!, siteId, { offset, limit: 100 });
        const worker = page.items.find((item) =>
          directWorkerId ? item.id === directWorkerId : item.userId === accountId,
        );
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
  const cameraSessionRef = useRef<GateCameraSession | null>(null);
  const cameraDeviceRef = useRef('');
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraRevision, setCameraRevision] = useState(0);
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
    cameraSessionRef.current?.stop();
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
    const session = new GateCameraSession({
      video: () => videoRef.current,
      ready: (devices, deviceId) => {
        setCameraError(null);
        setCameraDevices(devices);
        cameraDeviceRef.current = deviceId;
        setCameraDeviceId(deviceId);
        setCameraActive(true);
      },
      failed: (message) => {
        captureGenerationRef.current += 1;
        setCameraError(message);
        setCameraActive(false);
        setCountdown(null);
        setIsQualityChecking(false);
        setCapturePhase('rejected');
        setQualityMessage(message);
        revokeSafePreviewUrl(candidatePreviewRef.current);
        candidatePreviewRef.current = null;
        setCandidatePreviewUrl(null);
      },
    });
    cameraSessionRef.current = session;
    void session.start(cameraDeviceRef.current);
    return () => {
      captureGenerationRef.current += 1;
      session.stop();
      if (cameraSessionRef.current === session) cameraSessionRef.current = null;
    };
  }, [captureActive, cameraRevision]);

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
    setQualityMessage('Frame captured. Verifying quality and head pose…');
    try {
      const blocked = inspectGateCamera(video);
      if (blocked) {
        setCapturePhase('rejected');
        setQualityMessage(blocked);
        return;
      }
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
      setQualityMessage(getEnrollmentEnglishMessage(quality.reasonCode));
      if (quality.status !== 'ACCEPTED' || quality.reasonCode !== 'FACE_QUALITY_ACCEPTED') {
        setCapturePhase('rejected');
        return;
      }
      setSamples((previous) => ({
        ...previous,
        [target]: {
          blob,
          previewUrl: createSafePreviewUrl(blob, previous[target]?.previewUrl),
          label: EN_CAPTURE_GUIDANCE[target].title,
          sizeKb: Math.round(blob.size / 1024),
        },
      }));
      setCapturePhase('accepted');
    } catch {
      if (generation !== captureGenerationRef.current) return;
      setCapturePhase('rejected');
      setQualityMessage('Unable to verify image with server. Please check connection and retake.');
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
    setQualityMessage('Hold still. Capturing frame in 3 seconds…');
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
    if (!selectedWorkerId || !token || enrollmentSession.current?.workerId !== selectedWorkerId) {
      setSubmissionError('The Worker must confirm consent before enrolling face biometrics.');
      return;
    }
    if (!samples.front || !samples.left || !samples.right) {
      setSubmissionError('All 3 guided face samples are required before submitting.');
      return;
    }

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const session = enrollmentSession.current;

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
      enrollmentSession.current = null;
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
  const handleRevokeProfile = async (erase = false) => {
    if (
      window.confirm(
        'Are you sure you want to revoke this biometric profile? The worker will need to re-enroll before using face gate.',
      )
    ) {
      if (!token) return;
      try {
        if (erase) await client.deleteWorkerFaceTemplate(token, selectedWorkerId);
        else await client.revokeFaceProfile(token, selectedWorkerId);
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
    const session = enrollmentSession.current;
    enrollmentSession.current = null;
    if (token && session) {
      setIsSubmitting(true);
      void client
        .cancelFaceEnrollment(token, session.id)
        .catch(() =>
          setSubmissionError('Unable to cancel enrollment. Retry before starting a new capture.'),
        )
        .finally(() => setIsSubmitting(false));
    }
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
      {submissionError && currentStep === 'consent' && (
        <p role="alert" className="text-red-700">
          {submissionError}
        </p>
      )}
      {/* STEP 0: Account Selection Card */}
      {canManageAccounts && (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100/80 text-[#F66B17] ring-1 ring-orange-500/20">
                <IconUsers className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Enroll Biometrics for Existing Account
                </h2>
                <p className="text-xs text-slate-500">
                  Search and select an active account assigned to this construction site. Free-form
                  worker creation is disabled.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-orange-500/20">
              Step 0: Select Account
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-12 pt-1">
            <div className="sm:col-span-5">
              <label
                htmlFor="face-account-search"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                Search Account
              </label>
              <div className="relative mt-1.5">
                <input
                  id="face-account-search"
                  value={accountSearch}
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder="Username or display name"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all"
                  disabled={isSubmitting || currentStep !== 'consent'}
                />
              </div>
            </div>

            <div className="sm:col-span-7">
              <label
                htmlFor="face-account"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                Target Account
              </label>
              <div className="mt-1.5 flex gap-2">
                <select
                  id="face-account"
                  value={accountId}
                  onChange={(event) => {
                    handleResetWorkflow();
                    setStatusMessage(null);
                    setDirectWorkerId('');
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
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-sm font-medium text-slate-900 focus:border-[#F66B17] focus:bg-white focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all disabled:bg-slate-100"
                >
                  <option value="">
                    Select existing account (Chọn account đã có trên hệ thống)
                  </option>
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
                  className="shrink-0 rounded-xl bg-[#F66B17] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#e05b0d] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {linkAccount.isPending
                    ? 'Preparing…'
                    : selectedWorkerId
                      ? 'Account Selected'
                      : 'Use This Account'}
                </button>
              </div>
            </div>
          </div>

          {accounts.isError && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              <span>Unable to load accounts.</span>
              <button
                type="button"
                onClick={() => void accounts.refetch()}
                className="font-bold underline hover:text-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {linkedWorker.isError && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              <span>Unable to load worker profile.</span>
              <button
                type="button"
                onClick={() => void linkedWorker.refetch()}
                className="font-bold underline hover:text-red-900"
              >
                Retry
              </button>
            </div>
          )}

          {accounts.data?.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              No eligible accounts found. Create an account and assign it to this site in Account
              Management first.
            </p>
          )}

          {linkAccount.error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
            >
              {linkAccount.error.message}
            </div>
          )}
        </section>
      )}

      {/* Header and Worker Status Bar */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 text-sm font-bold text-white shadow-xs">
            {(accounts.data?.find((user) => user.id === accountId)?.displayName ?? 'WS')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Enrolling Account:
              </span>
              <span className="font-mono text-xs font-bold text-slate-900">
                {accounts.data?.find((user) => user.id === accountId)?.username ??
                  'No account selected'}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 font-medium">
              {selectedWorker?.displayName ?? 'Select an account before enrolling face biometrics'}
              {selectedWorker?.externalId ? ` · Worker ID: ${selectedWorker.externalId}` : ''}
            </p>
          </div>

          <div className="border-l border-slate-200 pl-4 ml-1">
            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Biometric Status
            </span>
            <span
              className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                profileStatus === 'ACTIVE'
                  ? 'bg-emerald-100 text-emerald-800'
                  : profileStatus === 'REVOKED'
                    ? 'bg-red-100 text-red-800'
                    : profileStatus === 'NEEDS_REENROLL'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-600'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  profileStatus === 'ACTIVE'
                    ? 'bg-emerald-600'
                    : profileStatus === 'REVOKED'
                      ? 'bg-red-600'
                      : profileStatus === 'NEEDS_REENROLL'
                        ? 'bg-amber-600'
                        : 'bg-slate-400'
                }`}
              />
              {profileStatus === 'ACTIVE'
                ? 'ACTIVE'
                : profileStatus === 'REVOKED'
                  ? 'REVOKED'
                  : profileStatus === 'NEEDS_REENROLL'
                    ? 'NEEDS RE-ENROLLMENT'
                    : profileStatus === 'DELETED'
                      ? 'DELETED'
                      : 'NOT ENROLLED'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {profileStatus === 'REVOKED' && (
            <button
              type="button"
              onClick={() => void handleRevokeProfile(true)}
              className="rounded-xl border border-red-200 px-3 py-2 text-xs text-red-700"
            >
              Delete Template Record
            </button>
          )}
          {profileStatus === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => void handleRevokeProfile()}
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 shadow-2xs"
            >
              Revoke Profile
            </button>
          )}
          <button
            type="button"
            onClick={handleResetWorkflow}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 shadow-2xs"
          >
            New Enrollment Session
          </button>
        </div>
      </section>

      {statusMessage && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-bold text-emerald-800 shadow-xs">
          <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Step Progress Wizard */}
      <nav
        aria-label="Enrollment Steps"
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs text-xs"
      >
        {[
          { key: 'consent', num: '1', title: 'Consent', sub: 'Compliance Policy' },
          { key: 'capture-front', num: '2', title: 'Front Face', sub: 'Guided Angle 1' },
          { key: 'capture-left', num: '3', title: 'Left View', sub: 'Guided Angle 2' },
          { key: 'capture-right', num: '4', title: 'Right View', sub: 'Guided Angle 3' },
          { key: 'review', num: '5', title: 'Review & Submit', sub: 'Verification' },
        ].map((step, idx) => {
          const isCurrent = currentStep === step.key;
          return (
            <div key={step.key} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2 transition-all ${
                  isCurrent
                    ? 'bg-orange-50 font-bold text-[#F66B17] ring-1 ring-orange-500/30 shadow-2xs'
                    : 'text-slate-500 font-medium'
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    isCurrent ? 'bg-[#F66B17] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {step.num}
                </span>
                <div>
                  <span className="block leading-tight font-bold">{step.title}</span>
                  <span className="block text-[10px] text-slate-400 font-normal">{step.sub}</span>
                </div>
              </div>
              {idx < 4 && <span className="text-slate-300 hidden sm:inline px-1">→</span>}
            </div>
          );
        })}
      </nav>

      {/* STEP 1: Consent Acknowledgment */}
      {currentStep === 'consent' && (
        <section className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
          <label className="mb-4 block text-xs font-semibold">
            Existing Worker profile (account optional)
            <select
              className="mt-1 block w-full rounded border p-2"
              value={directWorkerId}
              onChange={(e) => {
                handleResetWorkflow();
                setAccountId('');
                setDirectWorkerId(e.target.value);
              }}
            >
              <option value="">Use selected account</option>
              {workerChoices.data?.items
                .filter((w) => w.isActive)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.displayName} · {w.externalId}
                  </option>
                ))}
            </select>
          </label>
          {workerChoices.error && <p role="alert">{workerChoices.error.message}</p>}
          <p className="mb-3 text-xs text-slate-600">
            Hand the screen to the Worker. Only the Worker may confirm consent; the assisting
            operator must not confirm on their behalf.
          </p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#F66B17]">
              <IconShield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">
                Biometric Data Collection Consent & Policy ({CONSENT_VERSION})
              </h3>
              <p className="text-xs text-slate-500">MF01 Worker Biometric Consent & Compliance</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-800">
              SmartSite stores an encrypted face template linked to the Worker profile, derived from
              3 guided angle captures to facilitate site gate access control.
            </p>
            <ul className="list-disc space-y-1.5 pl-4 text-slate-600">
              <li>
                Raw face photos and embeddings are never stored in public browser storage or
                unprotected database tables.
              </li>
              <li>
                Facial verification is executed exclusively at designated gate control checkpoints;
                continuous CCTV surveillance is not performed.
              </li>
              <li>
                Workers or contractor representatives maintain the right to revoke their biometric
                profile or re-enroll at any time.
              </li>
            </ul>
          </div>

          <label className="mt-5 flex items-start gap-3 text-xs font-semibold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={consentAcknowledged}
              onChange={(e) => setConsentAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#F66B17] focus:ring-[#F66B17]"
            />
            <span>
              Worker confirmation: I am {selectedWorker?.displayName ?? 'the selected Worker'}. I
              have read and agree to biometric data processing under policy version{' '}
              {CONSENT_VERSION}.
            </span>
          </label>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={
                !consentAcknowledged ||
                !selectedWorker ||
                isSubmitting ||
                !linkedWorker.data?.isActive ||
                linkedWorker.isPending ||
                linkedWorker.isError
              }
              onClick={() => {
                setIsSubmitting(true);
                setSubmissionError(null);
                void (async () => {
                  const session =
                    enrollmentSession.current ??
                    (await client.startFaceEnrollment(token!, selectedWorkerId, CONSENT_VERSION));
                  if (!session.consentToken)
                    throw new Error('Worker consent handoff is unavailable.');
                  enrollmentSession.current = {
                    id: session.id,
                    workerId: selectedWorkerId,
                    consentToken: session.consentToken,
                  };
                  await client.confirmWorkerFaceConsent(session.id, session.consentToken);
                  retakeCapture('front');
                })()
                  .catch((error) =>
                    setSubmissionError(
                      error instanceof Error ? error.message : 'Unable to confirm consent.',
                    ),
                  )
                  .finally(() => setIsSubmitting(false));
              }}
              className="rounded-xl bg-[#F66B17] px-6 py-3 text-xs font-bold text-white shadow-md shadow-orange-500/15 hover:bg-[#e05b0d] hover:shadow-lg disabled:opacity-50 transition-all"
            >
              Begin Guided Face Captures →
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
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="enrollment-camera" className="text-xs text-slate-600">
                Camera
              </label>
              <select
                id="enrollment-camera"
                value={cameraDeviceId}
                disabled={isQualityChecking || countdown !== null}
                onChange={(event) => {
                  cameraDeviceRef.current = event.target.value;
                  setCameraDeviceId(event.target.value);
                  clearCaptureResult();
                  stopCamera();
                  setCameraRevision((value) => value + 1);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">Default Camera</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isQualityChecking || countdown !== null}
                onClick={() => {
                  clearCaptureResult();
                  stopCamera();
                  setCameraRevision((value) => value + 1);
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                Restart Camera
              </button>
            </div>
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
                  alt="Captured frame for quality inspection"
                  className="h-full w-full -scale-x-100 object-cover"
                />
              )}
              {countdown !== null && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-2xs">
                  <span
                    className="text-8xl font-black text-white drop-shadow-lg"
                    aria-live="assertive"
                  >
                    {countdown}
                  </span>
                </div>
              )}

              {/* Tactical Viewfinder Corners */}
              <div className="pointer-events-none absolute top-3 left-3 h-4 w-4 rounded-tl border-t-2 border-l-2 border-[#F66B17]/90" />
              <div className="pointer-events-none absolute top-3 right-3 h-4 w-4 rounded-tr border-t-2 border-r-2 border-[#F66B17]/90" />
              <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 rounded-bl border-b-2 border-l-2 border-[#F66B17]/90" />
              <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 rounded-br border-b-2 border-r-2 border-[#F66B17]/90" />

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
                  <div className="rounded-full bg-black/70 px-4 py-1.5 text-xs font-bold text-white backdrop-blur-xs border border-white/10">
                    {EN_CAPTURE_GUIDANCE[captureTargetForStep(currentStep)!].title}
                  </div>

                  <div className="h-64 w-52 rounded-4xl border-2 border-dashed border-[#F66B17] shadow-inner" />

                  <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-xs border border-white/10">
                    {candidatePreviewUrl
                      ? capturePhase === 'accepted'
                        ? 'Sample accepted'
                        : capturePhase === 'rejected'
                          ? 'Sample rejected — please retake'
                          : 'Captured — checking quality…'
                      : 'Position face in frame with good light and hold still'}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs">
              <p
                role="status"
                aria-live="polite"
                className={`text-sm font-bold ${capturePhase === 'rejected' ? 'text-red-700' : capturePhase === 'accepted' ? 'text-emerald-700' : 'text-slate-800'}`}
              >
                {qualityMessage ?? EN_CAPTURE_GUIDANCE[captureTargetForStep(currentStep)!].detail}
              </p>
              <div className="mt-3.5 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!cameraActive || isQualityChecking || countdown !== null}
                  onClick={beginCapture}
                  className="rounded-xl bg-[#F66B17] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#e05b0d] disabled:opacity-50 transition-all"
                >
                  {countdown !== null
                    ? `Hold still — ${countdown}`
                    : isQualityChecking
                      ? 'Checking sample…'
                      : capturePhase === 'ready'
                        ? 'I am ready — Capture in 3s'
                        : 'Retake this angle'}
                </button>
                <button
                  type="button"
                  disabled={capturePhase !== 'accepted' || isQualityChecking}
                  onClick={continueCapture}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-40 transition-all"
                >
                  {currentStep === 'capture-right'
                    ? 'Accepted — Review 3 Samples'
                    : 'Accepted — Next Angle'}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
                * System checks single face, head size, lighting, clarity, and relative pose from
                landmarks. This is an onboarding quality check.
              </p>
            </div>
          </div>

          {/* Right: Captured Samples Strip */}
          <div className="space-y-4 lg:col-span-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Captured Samples
            </h4>

            {/* Slot 1: Front */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">1. Front Angle</span>
                {samples.front ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Accepted ({samples.front.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">Not captured</span>
                )}
              </div>
              {samples.front && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.front.previewUrl}
                    alt="Front capture"
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('front')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Slot 2: Left */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">2. Slight Left Angle</span>
                {samples.left ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Accepted ({samples.left.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">Not captured</span>
                )}
              </div>
              {samples.left && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.left.previewUrl}
                    alt="Left capture"
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('left')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              )}
            </div>

            {/* Slot 3: Right */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">3. Slight Right Angle</span>
                {samples.right ? (
                  <span className="font-bold text-emerald-600">
                    ✓ Accepted ({samples.right.sizeKb}KB)
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">Not captured</span>
                )}
              </div>
              {samples.right && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.right.previewUrl}
                    alt="Right capture"
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('right')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
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
                className="w-full rounded-xl bg-slate-900 py-3 text-xs font-bold text-white hover:bg-slate-800 shadow-sm transition-all"
              >
                Proceed to Review Step →
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 5: Review & Submit */}
      {currentStep === 'review' && (
        <section className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900">Review 3 Guided Face Samples</h3>
            <p className="text-xs text-slate-500">
              Worker:{' '}
              <span className="font-bold text-slate-800">{selectedWorker?.displayName}</span> (
              {selectedWorker?.externalId})
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Front Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">1. Front Angle</p>
              {samples.front ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.front.previewUrl}
                    alt="Front sample"
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {samples.front.sizeKb} KB · JPEG
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('front')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">Missing photo</p>
              )}
            </div>

            {/* Left Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">2. Slight Left Angle</p>
              {samples.left ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.left.previewUrl}
                    alt="Left sample"
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {samples.left.sizeKb} KB · JPEG
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('left')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">Missing photo</p>
              )}
            </div>

            {/* Right Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">3. Slight Right Angle</p>
              {samples.right ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.right.previewUrl}
                    alt="Right sample"
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {samples.right.sizeKb} KB · JPEG
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('right')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    Retake
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">Missing photo</p>
              )}
            </div>
          </div>

          {submissionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              ⚠️ {submissionError}
            </div>
          )}

          {submissionSuccess ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-xs">
              <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                <IconCheck className="h-6 w-6" />
              </div>
              <h4 className="font-bold text-emerald-900 text-base">
                Biometric Enrollment Completed
              </h4>
              <p className="mt-1 text-xs text-emerald-700 max-w-md mx-auto">
                Face biometric profile has been encrypted and activated in the system. The worker
                can now authenticate at security gate desks.
              </p>
              <button
                type="button"
                onClick={handleResetWorkflow}
                className="mt-4 rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 shadow-xs"
              >
                Enroll Another Worker
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => retakeCapture('front')}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                Back to Camera
              </button>
              <button
                type="button"
                disabled={isSubmitting || !samples.front || !samples.left || !samples.right}
                onClick={handleSubmitEnrollment}
                className="rounded-xl bg-[#F66B17] px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/15 hover:bg-[#e05b0d] hover:shadow-lg disabled:opacity-50 transition-all"
              >
                {isSubmitting ? 'Encrypting & Saving Profile…' : 'Confirm & Save Face Profile'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
