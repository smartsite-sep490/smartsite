import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedError, localizeMessage } from '../../../i18n/messages';
import { localizedLabel } from '../../../i18n/labels';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { IconCamera, IconCheck, IconShield, IconUsers } from '../../icons';
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
    get title() {
      return tr('worker_enrollment_view.step_1_3_look_directly_into_camera');
    },
    get detail() {
      return tr(
        'worker_enrollment_view.position_your_entire_face_in_the_frame_look_straight_ahead_keep_head_level_and_hol',
      );
    },
  },
  left: {
    get title() {
      return tr('worker_enrollment_view.step_2_3_turn_slightly_to_your_left');
    },
    get detail() {
      return tr(
        'worker_enrollment_view.turn_your_whole_head_slowly_to_your_left_without_tilting_keep_face_in_frame_and_ho',
      );
    },
  },
  right: {
    get title() {
      return tr('worker_enrollment_view.step_3_3_turn_slightly_to_your_right');
    },
    get detail() {
      return tr(
        'worker_enrollment_view.turn_your_head_from_center_slowly_to_your_right_do_not_turn_too_far_and_hold_still',
      );
    },
  },
};

function getEnrollmentEnglishMessage(reasonCode: string): string {
  const map: Record<string, string> = {
    FACE_QUALITY_ACCEPTED: tr(
      'worker_enrollment_view.sample_accepted_single_face_good_lighting_clear_focus_within_frame_and_properly_or',
    ),
    FACE_NOT_FOUND: tr(
      'worker_enrollment_view.no_face_detected_position_your_entire_face_in_frame_and_retake',
    ),
    FACE_MULTIPLE_FOUND: tr(
      'worker_enrollment_view.multiple_faces_detected_only_the_enrolling_worker_should_be_in_frame',
    ),
    FACE_TOO_SMALL: tr('worker_enrollment_view.face_is_too_far_step_closer_to_the_camera'),
    FACE_TOO_CLOSE: tr(
      'worker_enrollment_view.face_is_too_close_step_back_slightly_to_fit_full_face_in_frame',
    ),
    FACE_CLIPPED: tr(
      'worker_enrollment_view.face_is_clipped_at_edge_position_your_whole_face_within_frame',
    ),
    FACE_NOT_CENTERED: tr('worker_enrollment_view.face_is_off_center_align_with_center_frame'),
    FACE_TOO_DARK: tr('worker_enrollment_view.lighting_too_dim_face_toward_a_light_source'),
    FACE_TOO_BRIGHT: tr('worker_enrollment_view.lighting_too_bright_avoid_direct_glare'),
    FACE_BLURRY: tr(
      'worker_enrollment_view.image_blurry_hold_still_and_ensure_camera_lens_is_clean',
    ),
    FACE_HEAD_TILTED: tr(
      'worker_enrollment_view.head_is_tilted_keep_your_head_straight_without_tilting_shoulders',
    ),
    FACE_TURN_TOO_FAR: tr(
      'worker_enrollment_view.turned_too_far_turn_slightly_so_facial_landmarks_remain_visible',
    ),
    FACE_POSE_FRONT_REQUIRED: tr(
      'worker_enrollment_view.frontal_angle_required_look_directly_into_the_camera',
    ),
    FACE_POSE_LEFT_REQUIRED: tr(
      'worker_enrollment_view.left_angle_required_turn_slightly_to_your_left_and_retake',
    ),
    FACE_POSE_RIGHT_REQUIRED: tr(
      'worker_enrollment_view.right_angle_required_turn_slightly_to_your_right_and_retake',
    ),
    FACE_NOT_CLEAR: tr(
      'worker_enrollment_view.face_not_clearly_visible_hold_still_remove_coverings_and_adjust_light',
    ),
    FACE_LANDMARKS_UNAVAILABLE: tr(
      'worker_enrollment_view.facial_landmarks_could_not_be_identified_remove_coverings_and_pose_directly',
    ),
    FACE_IMAGE_INVALID: tr(
      'worker_enrollment_view.captured_image_could_not_be_processed_please_retake',
    ),
  };
  return (
    map[reasonCode] ??
    tr(
      'worker_enrollment_view.sample_does_not_meet_quality_requirements_adjust_lighting_and_hold_still',
    )
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
  useTranslation();

  const client = useManagementClient(apiUrl);
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
    setQualityMessage(tr('worker_enrollment_view.frame_captured_verifying_quality_and_head_pose'));
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
      setQualityMessage(
        tr(
          'worker_enrollment_view.unable_to_verify_image_with_server_please_check_connection_and_retake',
        ),
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
    setQualityMessage(tr('worker_enrollment_view.hold_still_capturing_frame_in_3_seconds'));
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
      setSubmissionError(
        tr(
          'worker_enrollment_view.the_worker_must_confirm_consent_before_enrolling_face_biometrics',
        ),
      );
      return;
    }
    if (!samples.front || !samples.left || !samples.right) {
      setSubmissionError(
        tr('worker_enrollment_view.all_3_guided_face_samples_are_required_before_submitting'),
      );
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
        throw new Error(tr('worker_enrollment_view.backend_did_not_activate_the_face_profile'));
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
      setStatusMessage(
        tr('worker_enrollment_view.face_biometric_profile_successfully_registered_and_active'),
      );
    } catch (err) {
      setSubmissionError(
        err instanceof Error
          ? err.message
          : tr('worker_enrollment_view.failed_to_submit_enrollment_session'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Revoke profile action
  const handleRevokeProfile = async (erase = false) => {
    if (
      window.confirm(
        tr(
          'worker_enrollment_view.are_you_sure_you_want_to_revoke_this_biometric_profile_the_worker_will_need_to_re',
        ),
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
        setStatusMessage(
          tr('worker_enrollment_view.face_profile_revoked_its_database_template_has_been_removed'),
        );
        handleResetWorkflow();
      } catch (error) {
        setSubmissionError(
          error instanceof Error
            ? error.message
            : tr('worker_enrollment_view.could_not_revoke_the_face_profile'),
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
          setSubmissionError(
            tr(
              'worker_enrollment_view.unable_to_cancel_enrollment_retry_before_starting_a_new_capture',
            ),
          ),
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
          {localizedError(submissionError ?? undefined)}
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
                  {tr('worker_enrollment_view.enroll_biometrics_for_existing_account')}
                </h2>
                <p className="text-xs text-slate-500">
                  {tr(
                    'worker_enrollment_view.search_and_select_an_active_account_assigned_to_this_construction_site_free_form_w',
                  )}
                </p>
              </div>
            </div>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-orange-700 ring-1 ring-orange-500/20">
              {tr('worker_enrollment_view.step_0_select_account')}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-12 pt-1">
            <div className="sm:col-span-5">
              <label
                htmlFor="face-account-search"
                className="block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                {tr('common.search_account')}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="face-account-search"
                  value={accountSearch}
                  onChange={(event) => setAccountSearch(event.target.value)}
                  placeholder={tr('worker_enrollment_view.username_or_display_name')}
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
                {tr('common.target_account')}
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
                    {tr(
                      'worker_enrollment_view.select_existing_account_chon_account_a_co_tren_he_thong',
                    )}
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
                    ? tr('common.preparing')
                    : selectedWorkerId
                      ? tr('common.account_selected')
                      : tr('common.use_this_account')}
                </button>
              </div>
            </div>
          </div>

          {accounts.isError && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              <span>{tr('worker_enrollment_view.unable_to_load_accounts')}</span>
              <button
                type="button"
                onClick={() => void accounts.refetch()}
                className="font-bold underline hover:text-red-900"
              >
                {tr('common.retry')}
              </button>
            </div>
          )}

          {linkedWorker.isError && (
            <div
              role="alert"
              className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
            >
              <span>{tr('worker_enrollment_view.unable_to_load_worker_profile')}</span>
              <button
                type="button"
                onClick={() => void linkedWorker.refetch()}
                className="font-bold underline hover:text-red-900"
              >
                {tr('common.retry')}
              </button>
            </div>
          )}

          {accounts.data?.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              {tr(
                'worker_enrollment_view.no_eligible_accounts_found_create_an_account_and_assign_it_to_this_site_in_account',
              )}
            </p>
          )}

          {linkAccount.error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"
            >
              {localizedError(linkAccount.error.message)}
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
                {tr('common.enrolling_account')}
              </span>
              <span className="font-mono text-xs font-bold text-slate-900">
                {accounts.data?.find((user) => user.id === accountId)?.username ??
                  tr('common.no_account_selected')}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 font-medium">
              {selectedWorker?.displayName ??
                tr('worker_enrollment_view.select_an_account_before_enrolling_face_biometrics')}
              {selectedWorker?.externalId
                ? tr('worker_enrollment_view.worker_id_value', {
                    value1: selectedWorker.externalId,
                  })
                : ''}
            </p>
          </div>

          <div className="border-l border-slate-200 pl-4 ml-1">
            <span className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              {tr('common.biometric_status')}
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
                ? localizedLabel('ACTIVE')
                : profileStatus === 'REVOKED'
                  ? localizedLabel('REVOKED')
                  : profileStatus === 'NEEDS_REENROLL'
                    ? tr('common.needs_re_enrollment')
                    : profileStatus === 'DELETED'
                      ? localizedLabel('DELETED')
                      : tr('common.not_enrolled')}
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
              {tr('common.delete_template_record')}
            </button>
          )}
          {profileStatus === 'ACTIVE' && (
            <button
              type="button"
              onClick={() => void handleRevokeProfile()}
              className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 shadow-2xs"
            >
              {tr('common.revoke_profile')}
            </button>
          )}
          <button
            type="button"
            onClick={handleResetWorkflow}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 shadow-2xs"
          >
            {tr('common.new_enrollment_session')}
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
        aria-label={tr('common.enrollment_steps')}
        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs text-xs"
      >
        {[
          {
            key: 'consent',
            num: '1',
            get title() {
              return tr('common.consent');
            },
            get sub() {
              return tr('common.compliance_policy');
            },
          },
          {
            key: 'capture-front',
            num: '2',
            get title() {
              return tr('common.front_face');
            },
            get sub() {
              return tr('common.guided_angle_1');
            },
          },
          {
            key: 'capture-left',
            num: '3',
            get title() {
              return tr('common.left_view');
            },
            get sub() {
              return tr('common.guided_angle_2');
            },
          },
          {
            key: 'capture-right',
            num: '4',
            get title() {
              return tr('common.right_view');
            },
            get sub() {
              return tr('common.guided_angle_3');
            },
          },
          {
            key: 'review',
            num: '5',
            get title() {
              return tr('common.review_submit');
            },
            get sub() {
              return tr('common.verification_7140f4');
            },
          },
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
            {tr('worker_enrollment_view.existing_worker_profile_account_optional')}
            <select
              className="mt-1 block w-full rounded border p-2"
              value={directWorkerId}
              onChange={(e) => {
                handleResetWorkflow();
                setAccountId('');
                setDirectWorkerId(e.target.value);
              }}
            >
              <option value="">{tr('common.use_selected_account')}</option>
              {workerChoices.data?.items
                .filter((w) => w.isActive)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.displayName} · {w.externalId}
                  </option>
                ))}
            </select>
          </label>
          {workerChoices.error && <p role="alert">{localizedError(workerChoices.error.message)}</p>}
          <p className="mb-3 text-xs text-slate-600">
            {tr(
              'worker_enrollment_view.hand_the_screen_to_the_worker_only_the_worker_may_confirm_consent_the_assisting_op',
            )}
          </p>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#F66B17]">
              <IconShield className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">
                {tr('worker_enrollment_view.biometric_data_collection_consent_policy_value', {
                  value1: CONSENT_VERSION,
                })}
              </h3>
              <p className="text-xs text-slate-500">
                {tr('worker_enrollment_view.mf01_worker_biometric_consent_compliance')}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
            <p className="font-semibold text-slate-800">
              {tr(
                'worker_enrollment_view.smartsite_stores_an_encrypted_face_template_linked_to_the_worker_profile_derived_f',
              )}
            </p>
            <ul className="list-disc space-y-1.5 pl-4 text-slate-600">
              <li>
                {tr(
                  'worker_enrollment_view.raw_face_photos_and_embeddings_are_never_stored_in_public_browser_storage_or_unpro',
                )}
              </li>
              <li>
                {tr(
                  'worker_enrollment_view.facial_verification_is_executed_exclusively_at_designated_gate_control_checkpoints',
                )}
              </li>
              <li>
                {tr(
                  'worker_enrollment_view.workers_or_contractor_representatives_maintain_the_right_to_revoke_their_biometric',
                )}
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
              {tr(
                'worker_enrollment_view.worker_confirmation_i_am_value_i_have_read_and_agree_to_biometric_data_processing',
                {
                  value1: selectedWorker?.displayName ?? tr('common.the_selected_worker'),
                  value2: CONSENT_VERSION,
                },
              )}
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
                    throw new Error(
                      tr('worker_enrollment_view.worker_consent_handoff_is_unavailable'),
                    );
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
                      error instanceof Error
                        ? error.message
                        : tr('worker_enrollment_view.unable_to_confirm_consent'),
                    ),
                  )
                  .finally(() => setIsSubmitting(false));
              }}
              className="rounded-xl bg-[#F66B17] px-6 py-3 text-xs font-bold text-white shadow-md shadow-orange-500/15 hover:bg-[#e05b0d] hover:shadow-lg disabled:opacity-50 transition-all"
            >
              {tr('worker_enrollment_view.begin_guided_face_captures')}
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
                {tr('common.camera')}
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
                <option value="">{tr('common.default_camera')}</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || tr('common.camera_value', { value1: index + 1 })}
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
                {tr('common.restart_camera')}
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
                  alt={tr('worker_enrollment_view.captured_frame_for_quality_inspection')}
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
                  <p className="text-sm font-semibold text-slate-300">
                    {tr('common.activating_guided_camera')}
                  </p>
                  {cameraError && (
                    <p className="mt-2 text-xs text-red-400">{localizeMessage(cameraError)}</p>
                  )}
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
                        ? tr('common.sample_accepted')
                        : capturePhase === 'rejected'
                          ? tr('worker_enrollment_view.sample_rejected_please_retake')
                          : tr('worker_enrollment_view.captured_checking_quality')
                      : tr(
                          'worker_enrollment_view.position_face_in_frame_with_good_light_and_hold_still',
                        )}
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
                    ? tr('worker_enrollment_view.hold_still_value', { value1: countdown })
                    : isQualityChecking
                      ? tr('common.checking_sample')
                      : capturePhase === 'ready'
                        ? tr('worker_enrollment_view.i_am_ready_capture_in_3s')
                        : tr('common.retake_this_angle')}
                </button>
                <button
                  type="button"
                  disabled={capturePhase !== 'accepted' || isQualityChecking}
                  onClick={continueCapture}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-40 transition-all"
                >
                  {currentStep === 'capture-right'
                    ? tr('worker_enrollment_view.accepted_review_3_samples')
                    : tr('worker_enrollment_view.accepted_next_angle')}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
                {tr(
                  'worker_enrollment_view.system_checks_single_face_head_size_lighting_clarity_and_relative_pose_from_landma',
                )}
              </p>
            </div>
          </div>

          {/* Right: Captured Samples Strip */}
          <div className="space-y-4 lg:col-span-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {tr('common.captured_samples')}
            </h4>

            {/* Slot 1: Front */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">{tr('common.1_front_angle')}</span>
                {samples.front ? (
                  <span className="font-bold text-emerald-600">
                    {tr('common.accepted_valuekb', { value1: samples.front.sizeKb })}
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">{tr('common.not_captured')}</span>
                )}
              </div>
              {samples.front && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.front.previewUrl}
                    alt={tr('common.front_capture')}
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('front')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
                  </button>
                </div>
              )}
            </div>

            {/* Slot 2: Left */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">
                  {tr('worker_enrollment_view.2_slight_left_angle')}
                </span>
                {samples.left ? (
                  <span className="font-bold text-emerald-600">
                    {tr('common.accepted_valuekb', { value1: samples.left.sizeKb })}
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">{tr('common.not_captured')}</span>
                )}
              </div>
              {samples.left && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.left.previewUrl}
                    alt={tr('common.left_capture')}
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('left')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
                  </button>
                </div>
              )}
            </div>

            {/* Slot 3: Right */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-900">
                  {tr('worker_enrollment_view.3_slight_right_angle')}
                </span>
                {samples.right ? (
                  <span className="font-bold text-emerald-600">
                    {tr('common.accepted_valuekb', { value1: samples.right.sizeKb })}
                  </span>
                ) : (
                  <span className="text-slate-400 font-medium">{tr('common.not_captured')}</span>
                )}
              </div>
              {samples.right && (
                <div className="mt-2.5 flex items-center gap-3">
                  <img
                    src={samples.right.previewUrl}
                    alt={tr('common.right_capture')}
                    className="h-16 w-20 rounded-xl object-cover border border-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => retakeCapture('right')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
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
                {tr('worker_enrollment_view.proceed_to_review_step')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* STEP 5: Review & Submit */}
      {currentStep === 'review' && (
        <section className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900">
              {tr('worker_enrollment_view.review_3_guided_face_samples')}
            </h3>
            <p className="text-xs text-slate-500">
              {tr('common.worker_e02402')}{' '}
              <span className="font-bold text-slate-800">{selectedWorker?.displayName}</span> (
              {selectedWorker?.externalId})
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Front Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">{tr('common.1_front_angle')}</p>
              {samples.front ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.front.previewUrl}
                    alt={tr('common.front_sample')}
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {tr('worker_enrollment_view.value_kb_jpeg', { value1: samples.front.sizeKb })}
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('front')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">{tr('common.missing_photo')}</p>
              )}
            </div>

            {/* Left Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">
                {tr('worker_enrollment_view.2_slight_left_angle')}
              </p>
              {samples.left ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.left.previewUrl}
                    alt={tr('common.left_sample')}
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {tr('worker_enrollment_view.value_kb_jpeg', { value1: samples.left.sizeKb })}
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('left')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">{tr('common.missing_photo')}</p>
              )}
            </div>

            {/* Right Review */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-center">
              <p className="text-xs font-bold text-slate-800">
                {tr('worker_enrollment_view.3_slight_right_angle')}
              </p>
              {samples.right ? (
                <div className="mt-3 space-y-2">
                  <img
                    src={samples.right.previewUrl}
                    alt={tr('common.right_sample')}
                    className="mx-auto h-36 w-full rounded-xl object-cover shadow-2xs"
                  />
                  <p className="text-[11px] font-mono text-slate-500">
                    {tr('worker_enrollment_view.value_kb_jpeg', { value1: samples.right.sizeKb })}
                  </p>
                  <button
                    type="button"
                    onClick={() => retakeCapture('right')}
                    className="text-xs font-bold text-[#F66B17] hover:underline"
                  >
                    {tr('common.retake')}
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-600">{tr('common.missing_photo')}</p>
              )}
            </div>
          </div>

          {submissionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              ⚠️ {localizedError(submissionError ?? undefined)}
            </div>
          )}

          {submissionSuccess ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-xs">
              <div className="mx-auto mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
                <IconCheck className="h-6 w-6" />
              </div>
              <h4 className="font-bold text-emerald-900 text-base">
                {tr('common.biometric_enrollment_completed')}
              </h4>
              <p className="mt-1 text-xs text-emerald-700 max-w-md mx-auto">
                {tr(
                  'worker_enrollment_view.face_biometric_profile_has_been_encrypted_and_activated_in_the_system_the_worker_c',
                )}
              </p>
              <button
                type="button"
                onClick={handleResetWorkflow}
                className="mt-4 rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 shadow-xs"
              >
                {tr('common.enroll_another_worker')}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => retakeCapture('front')}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {tr('common.back_to_camera')}
              </button>
              <button
                type="button"
                disabled={isSubmitting || !samples.front || !samples.left || !samples.right}
                onClick={handleSubmitEnrollment}
                className="rounded-xl bg-[#F66B17] px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-orange-500/15 hover:bg-[#e05b0d] hover:shadow-lg disabled:opacity-50 transition-all"
              >
                {isSubmitting
                  ? tr('worker_enrollment_view.encrypting_saving_profile')
                  : tr('worker_enrollment_view.confirm_save_face_profile')}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
