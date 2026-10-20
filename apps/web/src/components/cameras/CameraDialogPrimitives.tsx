import { useId, useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { PpeTranslationKey } from '../../i18n/ppe-catalog';
import { useLocale } from '../../i18n/ppe-locale';

import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';

export interface CameraDiscardBannerProps {
  disabled?: boolean;
  onKeepEditing: () => void;
  onDiscardChanges: () => void;
}

export function CameraDiscardBanner({
  disabled = false,
  onKeepEditing,
  onDiscardChanges,
}: CameraDiscardBannerProps) {
  const { t } = useLocale();
  const promptId = useId();
  const keepEditingRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!disabled) {
      keepEditingRef.current?.focus();
    }
  }, [disabled]);

  return (
    <div className="min-w-0 space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5">
      <p id={promptId} className="text-sm font-medium leading-relaxed text-amber-950 break-words">
        {t('cameraSetup.discardPrompt')}
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          ref={keepEditingRef}
          type="button"
          aria-describedby={promptId}
          disabled={disabled}
          onClick={onKeepEditing}
          className={CAMERA_BUTTON_STYLES.secondary}
        >
          {t('zoneSetup.dialog.keepEditing')}
        </button>
        <button
          type="button"
          aria-describedby={promptId}
          disabled={disabled}
          onClick={onDiscardChanges}
          className={CAMERA_BUTTON_STYLES.primary}
        >
          {t('zoneSetup.dialog.discardChanges')}
        </button>
      </div>
    </div>
  );
}

export interface CameraFeedbackNoticeProps {
  kind: 'error' | 'success';
  messageKey: PpeTranslationKey;
  params?: Record<string, string | number>;
}

export function CameraFeedbackNotice({ kind, messageKey, params }: CameraFeedbackNoticeProps) {
  const { t } = useLocale();
  return (
    <p
      role={kind === 'error' ? 'alert' : 'status'}
      className={`min-w-0 rounded-xl border px-3.5 py-2.5 text-xs font-medium leading-relaxed break-words ${
        kind === 'error'
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}
    >
      {t(messageKey, params)}
    </p>
  );
}

export interface CameraManagementMetadataCardProps {
  siteName: string;
  camera: CameraResponse;
}

export function CameraManagementMetadataCard({
  siteName,
  camera,
}: CameraManagementMetadataCardProps) {
  const { t } = useLocale();
  const isActive = camera.status === 'ACTIVE';
  return (
    <div className="min-w-0 space-y-2 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-xs text-slate-700 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2.5 min-w-0">
        <span className="min-w-0 flex-1 text-sm font-semibold text-[#111111] break-words">
          {siteName}
        </span>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
            isActive
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-slate-300 bg-slate-100 text-slate-700'
          }`}
        >
          {t(isActive ? 'cameraSetup.manage.statusActive' : 'cameraSetup.manage.statusInactive')} ·
          v{camera.configurationVersion}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[#6B6B6B] break-words">
        {t('cameraSetup.manage.metadataNote')}
      </p>
    </div>
  );
}

export interface CameraConflictBannerProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  refreshButtonRef?: Ref<HTMLButtonElement>;
}

export function CameraConflictBanner({
  isRefreshing,
  onRefresh,
  refreshButtonRef,
}: CameraConflictBannerProps) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5 text-xs text-amber-950">
      <span className="min-w-0 flex-1 leading-relaxed break-words">
        {t('cameraSetup.manage.conflictNotice')}
      </span>
      <button
        ref={refreshButtonRef}
        type="button"
        disabled={isRefreshing}
        onClick={onRefresh}
        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-amber-950 shadow-xs transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {isRefreshing ? t('cameraSetup.manage.refreshing') : t('cameraSetup.manage.refreshCamera')}
      </button>
    </div>
  );
}

export interface CameraActivationSectionProps {
  status: 'ACTIVE' | 'INACTIVE';
  confirmStatusChange: boolean;
  disabled: boolean;
  savingStatus: boolean;
  onOpenConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmStatus: () => void;
  triggerButtonRef?: RefObject<HTMLButtonElement | null>;
  confirmContainerRef?: RefObject<HTMLDivElement | null>;
}

export function CameraActivationSection({
  status,
  confirmStatusChange,
  disabled,
  savingStatus,
  onOpenConfirm,
  onCancelConfirm,
  onConfirmStatus,
  triggerButtonRef,
  confirmContainerRef,
}: CameraActivationSectionProps) {
  const { t } = useLocale();
  const confirmationPromptId = useId();
  const isActive = status === 'ACTIVE';
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const internalConfirmContainerRef = useRef<HTMLDivElement>(null);
  const resolvedTriggerRef = triggerButtonRef ?? internalTriggerRef;
  const resolvedConfirmContainerRef = confirmContainerRef ?? internalConfirmContainerRef;
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreTriggerFocusRef = useRef(false);

  useLayoutEffect(() => {
    if (confirmStatusChange) {
      cancelConfirmRef.current?.focus();
    } else if (shouldRestoreTriggerFocusRef.current) {
      shouldRestoreTriggerFocusRef.current = false;
      if (!document.activeElement || document.activeElement === document.body) {
        resolvedTriggerRef.current?.focus();
      }
    }
  }, [confirmStatusChange, resolvedTriggerRef]);

  return (
    <div className="min-w-0 space-y-3 border-t border-slate-200 pt-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#111111] break-words">
            {t('cameraSetup.manage.activationHeading')}
          </h4>
          <p className="text-xs leading-relaxed text-[#6B6B6B] break-words">
            {isActive
              ? t('cameraSetup.manage.deactivationNote')
              : t('cameraSetup.manage.activationNote')}
          </p>
        </div>

        {!confirmStatusChange ? (
          <button
            ref={resolvedTriggerRef}
            type="button"
            disabled={disabled}
            onClick={onOpenConfirm}
            className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-3.5 py-2 text-xs font-semibold shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${
              isActive
                ? 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 focus-visible:outline-rose-800'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 focus-visible:outline-emerald-800'
            }`}
          >
            {isActive ? t('cameraSetup.manage.deactivateBtn') : t('cameraSetup.manage.activateBtn')}
          </button>
        ) : null}
      </div>

      {confirmStatusChange && (
        <div
          ref={resolvedConfirmContainerRef}
          className="min-w-0 space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5"
        >
          <p
            id={confirmationPromptId}
            className="text-xs font-medium leading-relaxed text-amber-950 break-words"
          >
            {isActive
              ? t('cameraSetup.manage.confirmDeactivatePrompt')
              : t('cameraSetup.manage.confirmActivatePrompt')}
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              ref={cancelConfirmRef}
              type="button"
              aria-describedby={confirmationPromptId}
              disabled={disabled}
              onClick={() => {
                shouldRestoreTriggerFocusRef.current = true;
                onCancelConfirm();
              }}
              className={CAMERA_BUTTON_STYLES.compactSecondary}
            >
              {t('zoneSetup.action.cancel')}
            </button>
            <button
              type="button"
              aria-describedby={confirmationPromptId}
              disabled={disabled}
              onClick={onConfirmStatus}
              className={`inline-flex items-center justify-center rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${
                isActive
                  ? 'bg-rose-700 hover:bg-rose-800 focus-visible:outline-rose-800'
                  : 'bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-800'
              }`}
            >
              {savingStatus
                ? t('cameraSetup.manage.updatingStatus')
                : isActive
                  ? t('cameraSetup.manage.confirmDeactivateBtn')
                  : t('cameraSetup.manage.confirmActivateBtn')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
