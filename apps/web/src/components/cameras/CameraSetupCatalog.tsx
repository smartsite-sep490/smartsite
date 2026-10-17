import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import type { useSetupCatalog } from './useSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

export function CameraSetupCatalog({
  capabilities,
  canReadCameras,
  canReadZones = false,
  cameras,
  rows,
  cameraError,
  open,
}: {
  capabilities: ZonePpeCapabilities;
  canReadCameras: boolean;
  canReadZones?: boolean;
  cameras: ReturnType<typeof useSetupCatalog<CameraResponse>>;
  rows: CameraResponse[];
  cameraError: ReactNode;
  open: (kind: 'register' | 'manage' | 'zones', cameraId?: string) => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const canWriteZones = capabilities.canManageZones || canManageCameras;
  const primaryButton = CAMERA_BUTTON_STYLES.primary;
  const button = CAMERA_BUTTON_STYLES.secondary;
  const primarySurface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs';
  const secondarySurface = 'min-w-0 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-5';
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className={primarySurface} aria-label={t('cameraSetup.cameras')}>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {t('cameraSetup.cameras')}
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
              {t(capabilities.canManageRegions ? 'cameraSetup.metadata' : 'cameraSetup.adminHint')}
            </p>
          </div>
          {canManageCameras && (
            <button
              type="button"
              className={`${primaryButton} shrink-0`}
              onClick={() => open('register')}
            >
              {t('cameraSetup.register')}
            </button>
          )}
        </div>
        {canReadCameras && (
          <>
            {cameras.isPending && (
              <p role="status" className="mt-5 text-sm text-slate-500">
                {t('cameraSetup.loading')}
              </p>
            )}
            {cameraError}
            <ul className="mt-5 space-y-3">
              {rows.map((row) => {
                const isEnabled = row.status === 'ACTIVE';
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 transition-colors hover:border-slate-300 hover:bg-slate-50/80"
                  >
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <h3 className="break-words text-base font-semibold leading-snug text-slate-900">
                        {row.name}
                      </h3>
                      <dl className="grid gap-3 text-xs sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="font-medium text-slate-500">
                            {t('cameraSetup.codeLabel')}
                          </dt>
                          <dd className="mt-0.5 break-all font-mono text-xs text-slate-700">
                            {row.code}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="font-medium text-slate-500">
                            {t('cameraSetup.statusLabel')}
                          </dt>
                          <dd className="mt-1">
                            <span
                              className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-medium break-words ${
                                isEnabled
                                  ? 'border-slate-300 bg-white text-slate-800'
                                  : 'border-slate-200 bg-slate-100 text-slate-600'
                              }`}
                            >
                              {t(isEnabled ? 'cameraSetup.enabled' : 'cameraSetup.disabled')}
                            </span>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    {canManageCameras && (
                      <button
                        type="button"
                        className={`${button} shrink-0`}
                        aria-label={t('cameraSetup.manage', { name: row.name })}
                        onClick={() => open('manage', row.id)}
                      >
                        {t('cameraSetup.manageAction')}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {cameras.settledEmpty && (
              <p role="status" className="py-5 text-sm text-slate-500">
                {t('cameraSetup.noCameras')}
              </p>
            )}
            {!cameras.baseError && cameras.isSuccess && (
              <p className="mt-4 text-xs text-slate-500">
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
      <aside className="min-w-0 space-y-4">
        <section className={secondarySurface} aria-label={t('cameraSetup.areas')}>
          <h2 className="text-base font-semibold text-slate-900">{t('cameraSetup.areas')}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{t('cameraSetup.areasHint')}</p>
          {canWriteZones || canReadZones ? (
            <button className={`${button} mt-4`} type="button" onClick={() => open('zones')}>
              {t(canWriteZones ? 'cameraSetup.zones' : 'cameraSetup.viewZones')}
            </button>
          ) : (
            <p className="mt-3 text-sm text-slate-500">{t('cameraSetup.managerHint')}</p>
          )}
        </section>
        <details className={secondarySurface}>
          <summary className="cursor-pointer rounded-lg text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]">
            {t('cameraSetup.help')}
          </summary>
          <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm leading-6 text-slate-600">
            <li>{t('cameraSetup.step1')}</li>
            <li>{t('cameraSetup.step2')}</li>
            <li>{t('cameraSetup.step3')}</li>
          </ol>
        </details>
      </aside>
    </div>
  );
}
