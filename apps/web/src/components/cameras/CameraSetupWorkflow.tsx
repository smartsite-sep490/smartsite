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
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canManageCameras && (
          <button
            type="button"
            className={CAMERA_BUTTON_STYLES.primary}
            onClick={() => open('register')}
          >
            {t('cameraSetup.register')}
          </button>
        )}
        {(canWriteZones || canReadZones) && (
          <button
            type="button"
            className={CAMERA_BUTTON_STYLES.secondary}
            onClick={() => open('zones')}
          >
            {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
          </button>
        )}
      </div>
      <details className="text-sm text-slate-600">
        <summary className="w-fit cursor-pointer rounded-md py-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-700">
          {t('cameraSetup.help')}
        </summary>
        <ol
          aria-label={t('cameraSetup.workflowTitle')}
          className="mt-2 max-w-2xl list-decimal space-y-1 pl-5 leading-6"
        >
          <li>{t('cameraSetup.step1')}</li>
          <li>{t('cameraSetup.step2')}</li>
          <li>{t('cameraSetup.step3')}</li>
        </ol>
      </details>
    </div>
  );
}
