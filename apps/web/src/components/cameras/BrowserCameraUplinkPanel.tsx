import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import type { BrowserCameraUplinkController } from './useBrowserCameraUplink';

export interface BrowserCameraUplinkPanelProps {
  cameraName: string;
  canWrite: boolean;
  cameraInactive: boolean;
  disabled?: boolean;
  controller: BrowserCameraUplinkController;
  onOpenRegions?: () => void;
}

export function BrowserCameraUplinkPanel({
  cameraName,
  canWrite,
  cameraInactive,
  disabled = false,
  controller,
  onOpenRegions,
}: BrowserCameraUplinkPanelProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const id = useId();
  const {
    videoRef,
    phase,
    issue,
    devices,
    selectedDeviceId,
    selectDeviceId,
    framesUploaded,
    framesDropped,
    start,
    stop,
  } = controller;

  const isUploading = phase === 'uploading';
  const isBusy = phase === 'starting' || phase === 'stopping';
  const canStart = Boolean(canWrite && !cameraInactive && !disabled && !isBusy && !isUploading);

  const issueKey =
    issue === 'UNSUPPORTED'
      ? 'cameraSource.browserErrUnsupported'
      : issue === 'PERMISSION_DENIED'
        ? 'cameraSource.browserErrPermissionDenied'
        : issue === 'NOT_FOUND'
          ? 'cameraSource.browserErrNotFound'
          : issue === 'DEVICE_BUSY'
            ? 'cameraSource.browserErrDeviceBusy'
            : issue === 'TRACK_ENDED'
              ? 'cameraSource.browserErrTrackEnded'
              : issue === 'LEASE_EXPIRED'
                ? 'cameraSource.browserErrLeaseExpired'
                : issue === 'FRAME_TOO_LARGE'
                  ? 'cameraSource.browserErrFrameTooLarge'
                  : issue === 'RATE_LIMITED'
                    ? 'cameraSource.browserErrRateLimited'
                    : issue === 'UPLOAD_FAILED'
                      ? 'cameraSource.browserErrUploadFailed'
                      : null;

  return (
    <div
      data-testid="camera-source-browser-uplink"
      className="max-w-3xl space-y-3 border-t border-slate-200/80 pt-3"
    >
      <p data-testid="browser-uplink-scope" className="text-xs leading-relaxed text-slate-600">
        {t('cameraSource.browserUplinkScope')}
      </p>

      {cameraInactive && (
        <p
          role="status"
          data-testid="browser-uplink-inactive-notice"
          className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs sm:text-sm leading-snug text-amber-950"
        >
          {t('cameraSource.browserInactiveNotice')}
        </p>
      )}

      {devices.length > 0 && (
        <div className="space-y-1">
          <label htmlFor={`${id}-browser-device`} className={CAMERA_FIELD_STYLES.label}>
            {t('cameraSource.browserLocalCameraLabel')}
          </label>
          <select
            id={`${id}-browser-device`}
            data-testid="browser-uplink-device-select"
            className={CAMERA_FIELD_STYLES.input}
            value={selectedDeviceId}
            disabled={disabled || isBusy || !canWrite || cameraInactive}
            onChange={(e) => selectDeviceId(e.target.value)}
          >
            <option value="">{t('cameraSource.browserDefaultCameraOption')}</option>
            {devices.map((item, idx) => (
              <option key={item.deviceId || idx} value={item.deviceId}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!isUploading ? (
          <button
            type="button"
            data-testid="browser-uplink-start-btn"
            className={CAMERA_BUTTON_STYLES.primary}
            disabled={!canStart}
            onClick={() => void start()}
          >
            {t(
              phase === 'starting'
                ? 'cameraSource.browserStarting'
                : 'cameraSource.browserStartAction',
            )}
          </button>
        ) : (
          <button
            type="button"
            data-testid="browser-uplink-stop-btn"
            className={CAMERA_BUTTON_STYLES.secondary}
            disabled={isBusy}
            onClick={() => void stop('USER_STOPPED', false)}
          >
            {t('cameraSource.browserStopAction')}
          </button>
        )}
        {isUploading && onOpenRegions && (
          <button
            type="button"
            data-testid="browser-uplink-regions-btn"
            className={CAMERA_BUTTON_STYLES.primary}
            onClick={onOpenRegions}
          >
            {t('cameraSource.nextConfigureRegions')}
          </button>
        )}
      </div>

      {phase === 'lease-held' && (
        <div
          role="alert"
          data-testid="browser-uplink-lease-held"
          className="rounded-xl border border-amber-200 border-l-[3px] border-l-amber-600 bg-amber-50/75 px-3.5 py-2.5 text-sm text-amber-950"
        >
          <p className="font-semibold text-slate-950">
            {t('cameraSource.browserLeaseHeldHeading')}
          </p>
          <p className="mt-0.5 text-xs sm:text-sm leading-relaxed text-slate-700">
            {t('cameraSource.browserLeaseHeldBody')}
          </p>
        </div>
      )}

      {issueKey && phase !== 'lease-held' && (
        <p
          role="alert"
          data-testid="browser-uplink-error"
          className="rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed text-rose-900"
        >
          {t(issueKey)}
        </p>
      )}

      <figure
        data-testid="browser-uplink-preview-box"
        className={
          isUploading || phase === 'starting'
            ? 'space-y-2.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 p-3.5'
            : 'sr-only'
        }
      >
        <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-950">
            {t('cameraSource.browserPreviewCaption', { camera: cameraName })}
          </span>
          {isUploading && (
            <span
              data-testid="browser-uplink-telemetry"
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-semibold text-teal-900 tabular-nums"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-600" />
              {t('cameraSource.browserTelemetry', {
                sent: framesUploaded,
                dropped: framesDropped,
              })}
            </span>
          )}
        </figcaption>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label={t('cameraSource.browserPreviewCaption', { camera: cameraName })}
          className="max-h-72 w-full rounded-lg bg-slate-950 object-contain"
        />
        {isUploading && (
          <p
            role="status"
            data-testid="browser-uplink-honest-note"
            className="text-xs leading-relaxed text-slate-600"
          >
            {t('cameraSource.browserHonestNote')}
          </p>
        )}
      </figure>

      {phase === 'stopped' && (
        <p
          role="status"
          data-testid="browser-uplink-stopped-notice"
          className="text-xs leading-relaxed text-slate-600"
        >
          {t('cameraSource.browserStoppedNotice')}
        </p>
      )}
    </div>
  );
}
