import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { PpeDialog } from '../ppe/PpeDialog';
import { getZonePpeScopeKey } from '../ppe/zone-ppe-scope';
import {
  CameraActivationSection,
  CameraConflictBanner,
  CameraDiscardBanner,
  CameraFeedbackNotice,
  CameraManagementMetadataCard,
} from './CameraDialogPrimitives';
import { resolveDialogCloseTrigger } from './camera-dialog-focus';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import { registerCameraManagementCopy } from './camera-management-copy';
import { useCameraManagementDialog } from './useCameraManagementDialog';

registerCameraManagementCopy();

const clientIds = new WeakMap<SmartSiteManagementClient, number>();
let nextClientId = 1;

export interface CameraManagementDialogProps {
  open: boolean;
  onClose: () => void;
  apiUrl: string;
  token: string | null;
  sessionScope: string | null;
  credentialId: number;
  siteId: string | null;
  siteName: string;
  camera: CameraResponse;
  canManageCamera: boolean;
  client?: SmartSiteManagementClient;
  onUpdated?: (camera: CameraResponse) => void;
  onUnauthorized?: () => void;
}

export function CameraManagementDialog(props: CameraManagementDialogProps) {
  const queryClient = useQueryClient();
  const defaultClient = useMemo(() => new SmartSiteManagementClient(props.apiUrl), [props.apiUrl]);
  const client = props.client ?? defaultClient;
  let clientId = clientIds.get(client);
  if (clientId === undefined) {
    clientId = nextClientId++;
    clientIds.set(client, clientId);
  }
  const scopeKey = getZonePpeScopeKey(queryClient, {
    apiUrl: props.apiUrl,
    token: props.token ?? '',
    sessionScope: props.sessionScope ?? '',
    credentialId: props.credentialId,
    siteId: props.siteId ?? '',
  });
  if (
    !props.open ||
    !props.canManageCamera ||
    !props.token ||
    !props.sessionScope ||
    !props.siteId ||
    props.camera.siteId !== props.siteId
  )
    return null;
  return (
    <ScopedCameraManagementDialog
      key={JSON.stringify([scopeKey, clientId, props.camera.id])}
      {...props}
      client={client}
      scopeKey={JSON.stringify([scopeKey, clientId])}
    />
  );
}

function ScopedCameraManagementDialog(
  props: CameraManagementDialogProps & {
    client: SmartSiteManagementClient;
    scopeKey: string;
  },
) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [draftState, setDraftState] = useState<{ dirty: boolean; saving: boolean }>({
    dirty: false,
    saving: false,
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const cancelStatusConfirmRef = useRef<(() => boolean) | null>(null);
  const registerStatusCancel = useCallback((handler: (() => boolean) | null) => {
    cancelStatusConfirmRef.current = handler;
  }, []);

  useLayoutEffect(() => {
    if (!confirmDiscard && lastFocusedRef.current) {
      const elementToFocus = lastFocusedRef.current;
      lastFocusedRef.current = null;
      if (elementToFocus.isConnected) {
        elementToFocus.focus();
      }
    }
  }, [confirmDiscard]);

  const handleAttemptClose = (trigger?: unknown) => {
    if (draftState.saving) return;
    if (cancelStatusConfirmRef.current?.()) return;
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (draftState.dirty) {
      lastFocusedRef.current = resolveDialogCloseTrigger(trigger);
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    props.onClose();
  };

  return (
    <PpeDialog
      open={props.open}
      onClose={handleAttemptClose}
      title={t('ppe.admin.manageCamera')}
      description={t('cameraSetup.manage.dialogDescription')}
      closeDisabled={draftState.saving}
    >
      <div className="min-w-0 space-y-4">
        {confirmDiscard && (
          <CameraDiscardBanner
            disabled={draftState.saving}
            onKeepEditing={() => {
              if (draftState.saving) return;
              setConfirmDiscard(false);
            }}
            onDiscardChanges={() => {
              if (draftState.saving) return;
              setConfirmDiscard(false);
              props.onClose();
            }}
          />
        )}

        <fieldset disabled={confirmDiscard} className="contents m-0 border-0 p-0 min-w-0">
          <ScopedCameraManagementForm
            {...props}
            onDraftStateChange={setDraftState}
            onCancelRequest={handleAttemptClose}
            onRegisterStatusCancel={registerStatusCancel}
          />
        </fieldset>
      </div>
    </PpeDialog>
  );
}

function ScopedCameraManagementForm(
  props: CameraManagementDialogProps & {
    client: SmartSiteManagementClient;
    scopeKey: string;
    onDraftStateChange: (state: { dirty: boolean; saving: boolean }) => void;
    onCancelRequest: (trigger?: HTMLElement | null) => void;
    onRegisterStatusCancel: (handler: (() => boolean) | null) => void;
  },
) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const id = useId();
  const {
    currentCamera,
    draftName,
    nameErrorKey,
    feedback,
    savingName,
    savingStatus,
    isRefreshing,
    isSaving,
    confirmStatusChange,
    setConfirmStatusChange,
    isConflictBlocked,
    blocked,
    statusTriggerRef,
    statusConfirmContainerRef,
    refreshButtonRef,
    cancelButtonRef,
    handleDraftNameChange,
    handleSaveName,
    handleConfirmStatus,
    handleRefreshCamera,
  } = useCameraManagementDialog({
    id,
    token: props.token,
    siteId: props.siteId,
    camera: props.camera,
    canManageCamera: props.canManageCamera,
    client: props.client,
    scopeKey: props.scopeKey,
    onUpdated: props.onUpdated,
    onUnauthorized: props.onUnauthorized,
    onDraftStateChange: props.onDraftStateChange,
    onRegisterStatusCancel: props.onRegisterStatusCancel,
  });

  return (
    <form
      aria-label={t('ppe.admin.manageCamera')}
      noValidate
      onSubmit={handleSaveName}
      className="min-w-0 space-y-4"
    >
      <CameraManagementMetadataCard siteName={props.siteName} camera={currentCamera} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={`${id}-code`} className={CAMERA_FIELD_STYLES.label}>
            {t('cameraSetup.field.code')}
          </label>
          <input
            id={`${id}-code`}
            value={currentCamera.code}
            readOnly
            disabled
            className={CAMERA_FIELD_STYLES.readOnlyInput}
          />
        </div>

        <div className="min-w-0 space-y-1.5">
          <label htmlFor={`${id}-source`} className={CAMERA_FIELD_STYLES.label}>
            {t('cameraSetup.field.externalId')}
          </label>
          <input
            id={`${id}-source`}
            value={currentCamera.externalId}
            readOnly
            disabled
            className={CAMERA_FIELD_STYLES.readOnlyInput}
          />
        </div>
      </div>

      <div className="min-w-0 space-y-1.5">
        <label htmlFor={`${id}-name`} className={CAMERA_FIELD_STYLES.label}>
          {t('cameraSetup.field.name')}
        </label>
        <input
          id={`${id}-name`}
          aria-label={t('cameraSetup.field.name')}
          value={draftName}
          autoComplete="off"
          required
          disabled={isSaving || blocked}
          aria-invalid={Boolean(nameErrorKey)}
          aria-describedby={nameErrorKey ? `${id}-name-error` : undefined}
          onChange={(event) => handleDraftNameChange(event.target.value)}
          className={CAMERA_FIELD_STYLES.input}
        />
        {nameErrorKey && (
          <p id={`${id}-name-error`} className={CAMERA_FIELD_STYLES.error}>
            {t(nameErrorKey)}
          </p>
        )}
      </div>

      {feedback && (
        <CameraFeedbackNotice
          kind={feedback.kind}
          messageKey={feedback.key}
          params={feedback.params}
        />
      )}

      {isConflictBlocked && (
        <CameraConflictBanner
          isRefreshing={isRefreshing}
          onRefresh={handleRefreshCamera}
          refreshButtonRef={refreshButtonRef}
        />
      )}

      <CameraActivationSection
        status={currentCamera.status}
        confirmStatusChange={confirmStatusChange}
        disabled={isSaving || isConflictBlocked || blocked}
        savingStatus={savingStatus}
        onOpenConfirm={() => setConfirmStatusChange(true)}
        onCancelConfirm={() => setConfirmStatusChange(false)}
        onConfirmStatus={handleConfirmStatus}
        triggerButtonRef={statusTriggerRef}
        confirmContainerRef={statusConfirmContainerRef}
      />

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-3.5">
        <button
          ref={cancelButtonRef}
          type="button"
          disabled={isSaving}
          onClick={() => props.onCancelRequest(cancelButtonRef.current)}
          className={CAMERA_BUTTON_STYLES.secondary}
        >
          {t('zoneSetup.action.cancel')}
        </button>
        <button
          type="submit"
          disabled={isSaving || isConflictBlocked || blocked}
          className={CAMERA_BUTTON_STYLES.primary}
        >
          {savingName ? t('cameraSetup.manage.savingName') : t('zoneSetup.rename.saveBtn')}
        </button>
      </div>
    </form>
  );
}
