import type React from 'react';
import type { ZoneResponse } from '@smartsite/api-client';
import { IconAlertTriangle, IconCheck } from '../icons';
import type { ZonePpeSetupCopyKey } from './zone-ppe-setup-copy';
import { formatPpeLabel } from './zone-ppe-setup-helpers';

export interface ZonePpeListProps {
  showZoneSection: boolean;
  canManageZones: boolean;
  scopedZones: ZoneResponse[];
  serverTotal: number;
  isPending: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  isInitialError: boolean;
  isAuthRevoked: boolean;
  isTransientNextPageError: boolean;
  isZonesSettledEmpty: boolean;
  editingZoneId: string | null;
  editingZoneName: string;
  renameValidationError: string | null;
  renameServerError: string | null;
  renameSuccessFeedback: string | null;
  isRenamingZone: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  renameTriggerRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>;
  t: (key: ZonePpeSetupCopyKey, params?: Record<string, string | number>) => string;
  onRefetch: () => void;
  onFetchNextPage: () => void;
  onStartRename: (zone: ZoneResponse) => void;
  onCancelRename: () => void;
  onEditingZoneNameChange: (value: string) => void;
  onSaveRename: (zone: ZoneResponse) => void;
}

export function ZonePpeList({
  showZoneSection,
  canManageZones,
  scopedZones,
  serverTotal,
  isPending,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  isInitialError,
  isAuthRevoked,
  isTransientNextPageError,
  isZonesSettledEmpty,
  editingZoneId,
  editingZoneName,
  renameValidationError,
  renameServerError,
  renameSuccessFeedback,
  isRenamingZone,
  renameInputRef,
  renameTriggerRefs,
  t,
  onRefetch,
  onFetchNextPage,
  onStartRename,
  onCancelRename,
  onEditingZoneNameChange,
  onSaveRename,
}: ZonePpeListProps) {
  return (
    <>
      {showZoneSection && canManageZones && renameSuccessFeedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2"
        >
          <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{renameSuccessFeedback}</span>
        </div>
      )}

      <div
        className={
          showZoneSection ? 'border-t border-slate-200/80 pt-4 space-y-2.5' : 'space-y-2.5'
        }
      >
        {showZoneSection && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">{t('zoneSetup.list.heading')}</span>
            <span className="text-[11px] text-slate-500">
              {serverTotal > scopedZones.length
                ? t('zoneSetup.list.showingCount', {
                    shown: scopedZones.length,
                    total: serverTotal,
                  })
                : scopedZones.length === 1
                  ? t('zoneSetup.list.countOne', { count: scopedZones.length })
                  : t('zoneSetup.list.countOther', { count: scopedZones.length })}
            </span>
          </div>
        )}

        {isPending && (
          <div role="status" className="text-xs text-slate-500 italic py-1">
            {t('zoneSetup.list.loading')}
          </div>
        )}

        {isInitialError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-800 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{t('zoneSetup.list.initialError')}</span>
            </div>
            <button
              type="button"
              onClick={onRefetch}
              disabled={isFetching}
              className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isFetching ? t('zoneSetup.list.retrying') : t('zoneSetup.list.retryInitial')}
            </button>
          </div>
        )}

        {isAuthRevoked && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-800 flex items-center gap-2"
          >
            <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{t('zoneSetup.list.authRevokedError')}</span>
          </div>
        )}

        {isTransientNextPageError && (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>{t('zoneSetup.list.nextPageError')}</span>
            </div>
            <button
              type="button"
              onClick={onFetchNextPage}
              disabled={isFetchingNextPage}
              className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isFetchingNextPage
                ? t('zoneSetup.list.retrying')
                : t('zoneSetup.list.retryNextPage')}
            </button>
          </div>
        )}

        {showZoneSection && isZonesSettledEmpty && (
          <div role="status" className="text-xs text-slate-500 italic py-1">
            {t(canManageZones ? 'zoneSetup.list.empty' : 'zoneSetup.list.emptyReadOnly')}
          </div>
        )}

        {showZoneSection && !isPending && scopedZones.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
            {scopedZones.map((zone) => {
              const isEditingThisZone = canManageZones && editingZoneId === zone.id;

              if (isEditingThisZone) {
                return (
                  <form
                    key={zone.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      onSaveRename(zone);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCancelRename();
                      }
                    }}
                    className="rounded-xl border border-slate-300 bg-white p-3.5 space-y-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                      <span>
                        {t('zoneSetup.rename.headingPrefix')}{' '}
                        <strong className="text-slate-900">{zone.code}</strong>
                      </span>
                      {zone.configurationLocked && (
                        <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {t('zoneSetup.rename.policyLockedBadge')}
                        </span>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor={`new-zone-name-${zone.id}`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        {t('zoneSetup.rename.newNameLabel')}
                      </label>
                      <input
                        id={`new-zone-name-${zone.id}`}
                        name="newZoneName"
                        type="text"
                        ref={renameInputRef}
                        maxLength={255}
                        value={editingZoneName}
                        onChange={(e) => onEditingZoneNameChange(e.target.value)}
                        disabled={isRenamingZone}
                        aria-invalid={Boolean(renameValidationError || renameServerError)}
                        aria-describedby={
                          renameValidationError
                            ? `rename-error-${zone.id}`
                            : renameServerError
                              ? `rename-server-error-${zone.id}`
                              : undefined
                        }
                        className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
                      />
                      {renameValidationError && (
                        <p
                          id={`rename-error-${zone.id}`}
                          role="alert"
                          className="text-[11px] text-red-600 mt-1 font-medium"
                        >
                          {renameValidationError}
                        </p>
                      )}
                      {renameServerError && (
                        <p
                          id={`rename-server-error-${zone.id}`}
                          role="alert"
                          className="text-[11px] text-red-600 mt-1 font-medium"
                        >
                          {renameServerError}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={onCancelRename}
                        disabled={isRenamingZone}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {t('zoneSetup.rename.cancelBtn')}
                      </button>
                      <button
                        type="submit"
                        disabled={isRenamingZone}
                        className="rounded-xl bg-[#0F172A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 shadow-xs flex items-center gap-1.5"
                      >
                        {isRenamingZone ? (
                          <>
                            <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                            {t('zoneSetup.rename.savingBtn')}
                          </>
                        ) : (
                          t('zoneSetup.rename.saveBtn')
                        )}
                      </button>
                    </div>
                  </form>
                );
              }

              const renameLabel = t('zoneSetup.rename.triggerBtn', { code: zone.code });

              return (
                <div
                  key={zone.id}
                  className="rounded-xl border border-slate-200/70 bg-[#F8FAFC] p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-900">{zone.code}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-700 font-medium truncate">{zone.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {zone.requiredPpe.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600"
                        >
                          {formatPpeLabel(item, t)}
                        </span>
                      ))}
                    </div>
                    {canManageZones && (
                      <button
                        type="button"
                        ref={(el) => {
                          renameTriggerRefs.current[zone.id] = el;
                        }}
                        onClick={() => onStartRename(zone)}
                        disabled={isRenamingZone}
                        aria-label={renameLabel}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer shadow-xs disabled:opacity-40"
                      >
                        {renameLabel}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasNextPage && !isTransientNextPageError && !isInitialError && !isAuthRevoked && (
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={() => {
                if (isFetching) return;
                onFetchNextPage();
              }}
              disabled={isFetching}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-2"
            >
              {isFetchingNextPage && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-700 border-t-transparent animate-spin mr-1.5" />
              )}
              {isFetchingNextPage ? t('zoneSetup.list.loadingMore') : t('zoneSetup.list.loadMore')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
