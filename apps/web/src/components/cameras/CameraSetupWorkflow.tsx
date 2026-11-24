import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
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
    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      <details className="group relative hidden sm:block text-xs text-slate-600">
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.help')}</span>
          <span
            aria-hidden="true"
            className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-1.5 sm:absolute sm:right-0 sm:z-20 sm:w-[34rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 shadow-lg">
          <CameraSetupStageCards />
        </div>
      </details>
      {(canManageCameras || showZonesAction) && (
        <div
          role="group"
          aria-label={t('cameraSetup.workflowTitle')}
          className="flex flex-wrap items-center gap-1.5 sm:justify-end"
        >
          {showZonesAction && (
            <button
              type="button"
              data-tour-anchor="camera-setup-zone-draw"
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer"
              onClick={(event) => open('zones', undefined, event.currentTarget)}
            >
              {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
            </button>
          )}
          {canManageCameras && (
            <button
              type="button"
              data-tour-anchor="camera-setup-source"
              className="inline-flex min-h-8 items-center justify-center rounded-lg bg-[#0F172A] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] cursor-pointer"
              onClick={(event) => open('register', undefined, event.currentTarget)}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
