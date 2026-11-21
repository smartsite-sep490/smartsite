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
          {host && <span className="text-slate-600">{host.label}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {hasMultipleAvailableHosts && (
            <label htmlFor={hostSelectId} className="sr-only">
              {t('cameraSource.host')}
            </label>
          )}
          {hasMultipleAvailableHosts && (
            <select
              id={hostSelectId}
              aria-label={t('cameraSource.host')}
              value={hostId}
              disabled={blocked}
              onChange={(event) => selectHostId(event.target.value)}
              className={`${CAMERA_FIELD_STYLES.input} !w-auto min-h-8 py-1 text-xs`}
            >
              <option value="">{t('cameraSource.chooseHost')}</option>
              {availableHosts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            data-testid="camera-sticky-apply-btn"
            className="inline-flex min-h-8 items-center justify-center rounded-lg bg-[#0F172A] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
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
