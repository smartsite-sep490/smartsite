import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import type { useSetupCatalog } from './useSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

export function CameraSetupCatalog({
  capabilities,
  cameras,
  rows,
  cameraError,
  open,
}: {
  capabilities: ZonePpeCapabilities;
  cameras: ReturnType<typeof useSetupCatalog<CameraResponse>>;
  rows: CameraResponse[];
  cameraError: ReactNode;
  open: (kind: 'register' | 'manage' | 'zones', cameraId?: string) => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const button = CAMERA_BUTTON_STYLES.secondary;
  const surface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-5';
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className={surface} aria-label={t('cameraSetup.cameras')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{t('cameraSetup.cameras')}</h2>
          {canManageCameras && (
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              onClick={() => open('register')}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </div>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
          {t(capabilities.canManageRegions ? 'cameraSetup.metadata' : 'cameraSetup.adminHint')}
        </p>
        {capabilities.canManageRegions && (
          <>
            {cameras.isPending && (
              <p role="status" className="mt-5 text-sm text-slate-500">
                {t('cameraSetup.loading')}
              </p>
            )}
            {cameraError}
            <ul className="mt-5 divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-semibold text-slate-900">{row.name}</h3>
                    <p className="mt-1 break-all text-xs text-slate-500">{row.code}</p>
                    <p className="mt-2 text-xs text-slate-600">
                      {t(row.status === 'ACTIVE' ? 'cameraSetup.enabled' : 'cameraSetup.disabled')}
                    </p>
                  </div>
                  <button type="button" className={button} onClick={() => open('manage', row.id)}>
                    {t('cameraSetup.manage', { name: row.name })}
                  </button>
                </li>
              ))}
            </ul>
            {cameras.settledEmpty && (
              <p role="status" className="py-5 text-sm text-slate-500">
                {t('cameraSetup.noCameras')}
              </p>
            )}
            {!cameras.baseError && cameras.isSuccess && (
              <p className="mt-3 text-xs text-slate-500">
                {t('cameraSetup.count', { loaded: rows.length, total: cameras.total })}
              </p>
            )}
            {!cameras.baseError && cameras.hasNextPage && (
              <>
                {rows.length === 0 && (
                  <p role="status" className="mt-3 text-sm">
                    {t('cameraSetup.partial')}
                  </p>
                )}
                <button
                  type="button"
                  className={`${button} mt-4`}
                  disabled={cameras.isFetching}
                  onClick={cameras.loadMore}
                >
                  {t('cameraSetup.camerasMore')}
                </button>
              </>
            )}
          </>
        )}
      </section>
      <aside className="space-y-5">
        <section className={surface} aria-label={t('cameraSetup.areas')}>
          <h2 className="text-lg font-semibold text-slate-900">{t('cameraSetup.areas')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{t('cameraSetup.areasHint')}</p>
          {capabilities.canManageZones || canManageCameras ? (
            <button className={`${button} mt-5`} type="button" onClick={() => open('zones')}>
              {t('cameraSetup.zones')}
            </button>
          ) : (
            <p className="mt-3 text-sm text-slate-500">{t('cameraSetup.managerHint')}</p>
          )}
        </section>
        <details className={surface}>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            {t('cameraSetup.help')}
          </summary>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-500">
            <li>{t('cameraSetup.step1')}</li>
            <li>{t('cameraSetup.step2')}</li>
            <li>{t('cameraSetup.step3')}</li>
          </ol>
        </details>
      </aside>
    </div>
  );
}
