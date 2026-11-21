import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import { CameraSetupStageCards } from './CameraSetupContextPanel';

export type CameraSetupOpenKind = 'register' | 'manage' | 'zones' | 'regions';
export type CameraSetupOpenHandler = (
  kind: CameraSetupOpenKind,
  cameraId?: string,
  trigger?: HTMLButtonElement | null,
) => void;

export function CameraSetupWorkflow({
  canWriteZones,
  canReadZones,
  canManageCameras,
  open,
}: {
  canWriteZones: boolean;
  canReadZones: boolean;
  canManageCameras: boolean;
  open: CameraSetupOpenHandler;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const showZonesAction = canWriteZones || canReadZones;
  return (
    <div className="contents">
      {(canManageCameras || showZonesAction) && (
        <div
          role="group"
          aria-label={t('cameraSetup.workflowTitle')}
          className="flex flex-wrap items-center gap-2 sm:justify-end"
        >
          {showZonesAction && (
            <button
              type="button"
              data-tour-anchor="camera-setup-zone-draw"
              className={CAMERA_BUTTON_STYLES.secondary}
              onClick={(event) => open('zones', undefined, event.currentTarget)}
            >
              {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
            </button>
          )}
          {canManageCameras && (
            <button
              type="button"
              data-tour-anchor="camera-setup-source"
              className={CAMERA_BUTTON_STYLES.primary}
              onClick={(event) => open('register', undefined, event.currentTarget)}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </div>
      )}
      <details className="group col-span-full w-full text-sm text-slate-600">
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.help')}</span>
          <span
            aria-hidden="true"
            className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 text-left text-sm text-slate-700">
          <CameraSetupStageCards />
        </div>
      </details>
    </div>
  );
}
