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

const WORKFLOW_STEPS = [
  ['01', 'cameraSetup.step1'],
  ['02', 'cameraSetup.step2'],
  ['03', 'cameraSetup.step3'],
] as const;

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
      <details className="group col-span-full w-full text-xs text-slate-500">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 font-medium text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.help')}</span>
          <span
            aria-hidden="true"
            className="text-[10px] text-slate-400 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-2 space-y-2.5 rounded-xl border border-slate-200/90 bg-slate-50/70 p-3 text-left text-xs text-slate-600">
          <ol
            aria-label={t('cameraSetup.workflowTitle')}
            className="grid gap-2 leading-5 sm:grid-cols-3"
          >
            {WORKFLOW_STEPS.map(([stepNumber, stepKey]) => (
              <li
                key={stepNumber}
                className="min-w-0 flex items-start gap-2 break-words rounded-lg border border-slate-200/80 bg-white px-2.5 py-2"
              >
                <span className="mt-0.5 inline-flex shrink-0 items-center rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-slate-600">
                  {stepNumber}
                </span>
                <span className="min-w-0">{t(stepKey)}</span>
              </li>
            ))}
          </ol>
          <CameraSetupStageCards />
        </div>
      </details>
    </div>
  );
}
