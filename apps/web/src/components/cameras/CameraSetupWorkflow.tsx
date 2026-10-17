import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

export type CameraSetupOpenKind = 'register' | 'manage' | 'zones' | 'regions';

export function CameraSetupWorkflow({
  canWriteZones,
  canReadZones,
  canManageCameras,
  open,
}: {
  canWriteZones: boolean;
  canReadZones: boolean;
  canManageCameras: boolean;
  open: (kind: CameraSetupOpenKind, cameraId?: string) => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const primaryButton = CAMERA_BUTTON_STYLES.primary;
  const secondaryButton = CAMERA_BUTTON_STYLES.secondary;
  const hasZoneAction = canWriteZones || canReadZones;
  const cardSurface =
    'flex min-w-0 flex-col justify-between gap-4 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4';
  const badgeClass =
    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-700';

  return (
    <section
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
      aria-label={t('cameraSetup.workflowTitle')}
    >
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          {t('cameraSetup.workflowTitle')}
        </h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
          {t('cameraSetup.areasHint')}
        </p>
        {!hasZoneAction && (
          <p className="mt-2 text-sm text-slate-500">{t('cameraSetup.managerHint')}</p>
        )}
      </div>
      <ol aria-label={t('cameraSetup.workflowTitle')} className="mt-5 grid gap-4 lg:grid-cols-3">
        <li className={cardSurface}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className={badgeClass}>
              1
            </span>
            <p className="min-w-0 text-sm leading-6 text-slate-700">{t('cameraSetup.step1')}</p>
          </div>
          {hasZoneAction && (
            <button
              type="button"
              className={`${secondaryButton} self-start`}
              onClick={() => open('zones')}
            >
              {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
            </button>
          )}
        </li>
        <li className={cardSurface}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className={badgeClass}>
              2
            </span>
            <p className="min-w-0 text-sm leading-6 text-slate-700">{t('cameraSetup.step2')}</p>
          </div>
          {canManageCameras && (
            <button
              type="button"
              className={`${primaryButton} self-start`}
              onClick={() => open('register')}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </li>
        <li className={cardSurface}>
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className={badgeClass}>
              3
            </span>
            <p className="min-w-0 text-sm leading-6 text-slate-700">{t('cameraSetup.step3')}</p>
          </div>
          {canManageCameras && (
            <button
              type="button"
              className={`${secondaryButton} self-start`}
              onClick={() => open('regions')}
            >
              {t('cameraSetup.regionsAction')}
            </button>
          )}
        </li>
      </ol>
    </section>
  );
}
