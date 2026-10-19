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
  const showZonesAction = canWriteZones || canReadZones;
  return (
    <div className="contents">
      {(canManageCameras || showZonesAction) && (
        <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
          {showZonesAction && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.secondary}
              onClick={() => open('zones')}
            >
              {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
            </button>
          )}
          {canManageCameras && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.primary}
              onClick={() => open('register')}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </div>
      )}
      <details className="group col-span-full w-full text-xs text-slate-500">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.help')}</span>
          <span
            aria-hidden="true"
            className="text-[10px] text-slate-400 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <ol
          aria-label={t('cameraSetup.workflowTitle')}
          className="mt-2 grid gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5 text-left text-xs leading-5 text-slate-600 sm:grid-cols-3"
        >
          <li className="rounded-lg border border-slate-200/60 bg-white px-2.5 py-2">
            <span className="mr-1.5 font-mono text-[11px] font-semibold tabular-nums text-slate-400">
              01
            </span>
            {t('cameraSetup.step1')}
          </li>
          <li className="rounded-lg border border-slate-200/60 bg-white px-2.5 py-2">
            <span className="mr-1.5 font-mono text-[11px] font-semibold tabular-nums text-slate-400">
              02
            </span>
            {t('cameraSetup.step2')}
          </li>
          <li className="rounded-lg border border-slate-200/60 bg-white px-2.5 py-2">
            <span className="mr-1.5 font-mono text-[11px] font-semibold tabular-nums text-slate-400">
              03
            </span>
            {t('cameraSetup.step3')}
          </li>
        </ol>
      </details>
    </div>
  );
}
