import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import {
  buildGateConfigurationHref,
  registerCameraGateBoundaryCopy,
} from './camera-gate-boundary-copy';

registerCameraGateBoundaryCopy();

export function CameraGateBoundaryCard({
  camera,
  siteId,
}: {
  camera: CameraResponse;
  siteId?: string;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const resolvedSiteId = siteId || camera.siteId;
  const gateConfigHref = buildGateConfigurationHref(resolvedSiteId, camera.gateId);
  const isEnabled = camera.status === 'ACTIVE';

  return (
    <section
      data-testid="camera-setup-gate-boundary-stage"
      aria-label={t('cameraSetup.gateStageHeading')}
      className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-3"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {t('cameraSetup.gateCameraBadge')}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
              isEnabled ? 'text-emerald-800' : 'text-slate-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${
                isEnabled ? 'bg-emerald-600' : 'bg-slate-400'
              }`}
            />
            {t(isEnabled ? 'cameraSetup.enabled' : 'cameraSetup.disabled')} · v
            {camera.configurationVersion}
          </span>
        </div>
        <h3 className="text-base font-bold tracking-tight text-slate-950 break-words">
          {t('cameraSetup.gateStageHeading')}
        </h3>
        <p className="text-sm leading-relaxed text-slate-600 break-words [overflow-wrap:anywhere]">
          {t('cameraSetup.gateStageBody', {
            name: camera.name,
            code: camera.code,
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          data-testid="gate-camera-open-site-setup"
          className={CAMERA_BUTTON_STYLES.primary}
          to={gateConfigHref}
        >
          {t('cameraSetup.gateOpenConfigAction')}
        </Link>
      </div>

      <details className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <summary className="cursor-pointer select-none font-medium text-slate-700 hover:text-slate-950">
          {t('cameraSetup.gateStageMetadataSummary')}
        </summary>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-slate-500">{t('cameraSetup.field.code')}</dt>
            <dd className="font-mono font-semibold text-slate-800 break-all">{camera.code}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-slate-500">{t('cameraSetup.field.externalId')}</dt>
            <dd className="font-mono font-semibold text-slate-800 break-all">
              {camera.externalId}
            </dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-slate-500">{t('cameraSetup.gateStageGateIdLabel')}</dt>
            <dd className="font-mono font-semibold text-slate-800 break-all">
              {camera.gateId ?? t('cameraSetup.gateStageUnassignedGate')}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
