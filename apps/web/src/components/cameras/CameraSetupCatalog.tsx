import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ZonePpeCapabilities } from '../ppe/zone-ppe-scope';
import type { useSetupCatalog } from './useSetupCatalog';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import { CameraSetupWorkflow, type CameraSetupOpenKind } from './CameraSetupWorkflow';

export function CameraSetupCatalog({
  capabilities,
  canReadCameras,
  canReadZones = false,
  cameras,
  rows,
  requestedCameraId = null,
  cameraError,
  open,
}: {
  capabilities: ZonePpeCapabilities;
  canReadCameras: boolean;
  canReadZones?: boolean;
  cameras: ReturnType<typeof useSetupCatalog<CameraResponse>>;
  rows: CameraResponse[];
  requestedCameraId?: string | null;
  cameraError: ReactNode;
  open: (kind: CameraSetupOpenKind, cameraId?: string) => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const canManageCameras = capabilities.canManageRegions && !cameras.baseError;
  const canWriteZones = capabilities.canManageZones || canManageCameras;
  const hasLoadedCameraPages = Boolean(cameras.data?.pages.length) && !cameras.baseError;
  const showLinkedCameraNotice = Boolean(
    requestedCameraId &&
    !rows.some((row) => row.id === requestedCameraId) &&
    hasLoadedCameraPages &&
    !cameras.isFetching,
  );
  const button = CAMERA_BUTTON_STYLES.secondary;
  const primarySurface = 'min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs';
  return (
    <div>
      <section className={primarySurface} aria-label={t('cameraSetup.cameras')}>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {t('cameraSetup.cameras')}
            </h2>
            <p className="max-w-xl text-xs leading-5 text-slate-500">
              {t(capabilities.canManageRegions ? 'cameraSetup.metadata' : 'cameraSetup.adminHint')}
            </p>
          </div>
          <CameraSetupWorkflow
            canWriteZones={canWriteZones}
            canReadZones={canReadZones}
            canManageCameras={canManageCameras}
            open={open}
          />
        </div>
        {canReadCameras && (
          <>
            {cameras.isPending && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 text-sm text-slate-500"
              >
                {t('cameraSetup.loading')}
              </p>
            )}
            {cameraError}
            <ul className="mt-4 space-y-2.5">
              {rows.map((row) => {
                const isEnabled = row.status === 'ACTIVE';
                return (
                  <li
                    key={row.id}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200/90 bg-slate-50/30 px-4 py-3.5 transition-colors hover:border-slate-300 hover:bg-slate-50/80 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h3 className="break-words text-base font-semibold tracking-tight text-slate-900">
                        {row.name}
                      </h3>
                      <dl className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                        <div className="min-w-0 inline-flex flex-wrap items-center gap-1.5">
                          <dt className="text-slate-400">{t('cameraSetup.codeLabel')}</dt>
                          <dd className="min-w-0 break-all rounded-md border border-slate-200/80 bg-white px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-slate-700">
                            {row.code}
                          </dd>
                        </div>
                        <div className="inline-flex items-center gap-1.5">
                          <dt className="sr-only">{t('cameraSetup.statusLabel')}</dt>
                          <dd>
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
                      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:self-center">
                        {isEnabled && (
                          <button
                            type="button"
                            className={CAMERA_BUTTON_STYLES.primary}
                            onClick={() => open('regions', row.id)}
                          >
                            {t('cameraSetup.regionsAction')}
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${button} shrink-0`}
                          aria-label={t('cameraSetup.manage', { name: row.name })}
                          onClick={() => open('manage', row.id)}
                        >
                          {t('cameraSetup.manageAction')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {cameras.settledEmpty && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-500"
              >
                {t('cameraSetup.noCameras')}
              </p>
            )}
            {showLinkedCameraNotice && (
              <p
                role="status"
                className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600"
              >
                {t(
                  cameras.hasNextPage
                    ? 'cameraSetup.linkedCameraMore'
                    : 'cameraSetup.linkedCameraUnavailable',
                )}
              </p>
            )}
            {!cameras.baseError && cameras.hasNextPage && rows.length === 0 && (
              <p role="status" className="mt-3 text-sm text-slate-600">
                {t('cameraSetup.partial')}
              </p>
            )}
            {(hasLoadedCameraPages || (!cameras.baseError && cameras.hasNextPage)) && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                {hasLoadedCameraPages ? (
                  <p className="text-xs font-medium tabular-nums text-slate-500">
                    {t('cameraSetup.count', { loaded: rows.length, total: cameras.total })}
                  </p>
                ) : (
                  <span />
                )}
                {!cameras.baseError && cameras.hasNextPage && (
                  <button
                    type="button"
                    className={button}
                    disabled={cameras.isFetching}
                    onClick={cameras.loadMore}
                  >
                    {t('cameraSetup.camerasMore')}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
