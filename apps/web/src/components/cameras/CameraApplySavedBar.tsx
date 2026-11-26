import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cameraSourceClient, type CameraSourceClient } from '@smartsite/api-client';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import './camera-source-copy';
import {
  useCameraApplicationStatus,
  type CameraApplicationStatusContext,
} from './useCameraApplicationStatus';
import {
  useCameraSourceResumeController,
  type CameraSourceResumeController,
} from './useCameraSourceResumeController';

export interface CameraApplySavedBarProps {
  apiUrl: string;
  token: string;
  siteId: string;
  camera: { id: string; siteId: string; name: string; configurationVersion: number };
  setupKey: readonly unknown[];
  canWrite: boolean;
  statusContext?: CameraApplicationStatusContext;
  onUnauthorized: () => void;
  client?: CameraSourceClient;
  controller?: CameraSourceResumeController;
  alwaysShowWhenSupported?: boolean;
}

export function CameraApplySavedBar(props: CameraApplySavedBarProps) {
  const internalController = useCameraSourceResumeController({
    apiUrl: props.apiUrl,
    token: props.token,
    siteId: props.siteId,
    camera: props.camera,
    setupKey: props.setupKey,
    canWrite: props.canWrite,
    enabled: !props.controller && props.canWrite,
    onUnauthorized: props.onUnauthorized,
    client: props.client ?? cameraSourceClient,
  });
  const controller = props.controller ?? internalController;

  return <CameraApplySavedBarView {...props} controller={controller} />;
}

function CameraApplySavedBarView({
  camera,
  canWrite,
  statusContext,
  client = cameraSourceClient,
  controller,
  alwaysShowWhenSupported = false,
}: CameraApplySavedBarProps & { controller: CameraSourceResumeController }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const hostSelectId = useId();
  const appStatus = useCameraApplicationStatus(camera, statusContext);
  const isWorkerLoadedCurrent = appStatus.effectiveState === 'LOADED';

  const {
    hosts,
    hostAccessDenied,
    availableHosts,
    hostId,
    host,
    caps,
    selectHostId,
    resuming,
    revoked,
    sourceBusy,
    refreshingCaps,
    triggerResume,
  } = controller;

  if (!canWrite || revoked || hostAccessDenied || !client.resume) {
    return null;
  }

  const supportsResumeOnSelected = Boolean(
    host?.available && caps?.configurationResumeSupported === true,
  );
  const hasMultipleAvailableHosts = availableHosts.length > 1;
  const anyAvailableHostSupportsResume = availableHosts.some(
    (entry) => entry.capabilities?.configurationResumeSupported === true,
  );

  if (!supportsResumeOnSelected && !(hasMultipleAvailableHosts && anyAvailableHostSupportsResume)) {
    return null;
  }

  if (
    !alwaysShowWhenSupported &&
    isWorkerLoadedCurrent &&
    !resuming.isPending &&
    !resuming.isSuccess &&
    !resuming.isError
  ) {
    return null;
  }

  const blocked = sourceBusy || refreshingCaps || hosts.isError || resuming.isPending || revoked;

  return (
    <div
      id="camera-sticky-apply-bar"
      data-testid="camera-sticky-apply-bar"
      className="min-w-0 rounded-lg border border-slate-200 border-l-[3px] border-l-teal-700 bg-slate-50/90 px-2.5 py-1.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-slate-950">
            {t('cameraSource.savedConfiguration')}
          </span>
          <span className="font-mono font-semibold tabular-nums text-slate-600">
            v{camera.configurationVersion}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasMultipleAvailableHosts && (
            <details
              data-testid="camera-apply-host-details"
              className="group relative min-w-0 text-xs text-slate-700"
            >
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
                <span>{t('cameraSource.connectionDetailsToggle')}</span>
                {!hostId && (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.25 text-[11px] font-semibold text-amber-900">
                    {t('cameraSource.connectionDetailsNeeded')}
                  </span>
                )}
              </summary>
              <div className="mt-1.5 min-w-[14rem] rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm lg:absolute lg:right-0 lg:z-20">
                <label
                  htmlFor={hostSelectId}
                  className="mb-1 block text-xs font-semibold text-slate-800"
                >
                  {t('cameraSource.host')}
                </label>
                <select
                  id={hostSelectId}
                  aria-label={t('cameraSource.host')}
                  value={hostId}
                  disabled={blocked}
                  onChange={(event) => selectHostId(event.target.value)}
                  className={`${CAMERA_FIELD_STYLES.input} min-h-8 py-1 text-xs`}
                >
                  <option value="">{t('cameraSource.chooseHost')}</option>
                  {availableHosts.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
            </details>
          )}
          <button
            type="button"
            data-testid="camera-sticky-apply-btn"
            className="inline-flex min-h-8 items-center justify-center rounded-lg border border-teal-700/30 bg-white px-3 py-1 text-xs font-semibold text-teal-900 transition-colors hover:border-teal-700/60 hover:bg-teal-50/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            disabled={!supportsResumeOnSelected || blocked || resuming.isSuccess}
            onClick={triggerResume}
          >
            {t(
              resuming.isPending
                ? 'cameraSource.resuming'
                : resuming.isError
                  ? 'cameraSource.retryResume'
                  : 'cameraSource.resume',
            )}
          </button>
        </div>
      </div>
      {resuming.isSuccess && (
        <p role="status" className="mt-1 text-xs font-medium text-teal-900">
          {t('cameraSource.resumeStarted')}
        </p>
      )}
      {resuming.isError && (
        <p role="alert" className="mt-1 text-xs font-medium text-rose-900">
          {t('cameraSource.resumeError')}
        </p>
      )}
    </div>
  );
}
