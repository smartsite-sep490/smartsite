import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PpeTranslationKey } from '../../i18n/ppe-catalog';
import { useLocale } from '../../i18n/ppe-locale';
import { PpeDialog } from '../ppe/PpeDialog';
import { getZonePpeScopeKey } from '../ppe/zone-ppe-scope';
import {
  CameraActivationSection,
  CameraConflictBanner,
  CameraDiscardBanner,
  CameraFeedbackNotice,
  CameraManagementMetadataCard,
} from './CameraDialogPrimitives';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';

const clientIds = new WeakMap<SmartSiteManagementClient, number>();
let nextClientId = 1;
function validCreatedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

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
  isAdmin: boolean;
  client?: SmartSiteManagementClient;
  onUpdated?: (camera: CameraResponse) => void;
  onUnauthorized?: () => void;
}

function parseRenameCameraResponse(
  value: unknown,
  expected: {
    id: string;
    siteId: string;
    code: string;
    externalId: string;
    currentVersion: number;
  },
  requestedName: string,
): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    row.name !== requestedName ||
    (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) < expected.currentVersion ||
    (row.configurationVersion ?? 0) < 1 ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

function parseSetStatusCameraResponse(
  value: unknown,
  expected: {
    id: string;
    siteId: string;
    code: string;
    externalId: string;
    currentVersion: number;
    targetStatus: 'ACTIVE' | 'INACTIVE';
  },
): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    row.status !== expected.targetStatus ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) <= expected.currentVersion ||
    (row.configurationVersion ?? 0) < 1 ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

function parseRefreshCameraResponse(value: unknown, expected: CameraResponse): CameraResponse {
  if (!value || typeof value !== 'object') {
    throw new ApiError('invalid-response', 'Invalid camera response from backend.');
  }
  const row = value as Partial<CameraResponse>;
  if (
    row.id !== expected.id ||
    row.siteId !== expected.siteId ||
    row.code !== expected.code ||
    row.externalId !== expected.externalId ||
    typeof row.name !== 'string' ||
    !row.name.trim() ||
    (row.status !== 'ACTIVE' && row.status !== 'INACTIVE') ||
    !Number.isSafeInteger(row.configurationVersion) ||
    (row.configurationVersion ?? 0) < expected.configurationVersion ||
    !validCreatedAt(row.createdAt)
  ) {
    throw new ApiError('invalid-response', 'Backend returned mismatched camera metadata.');
  }
  return {
    id: row.id,
    siteId: row.siteId,
    code: row.code,
    name: row.name,
    externalId: row.externalId,
    status: row.status,
    configurationVersion: row.configurationVersion!,
    createdAt: row.createdAt,
  };
}

function validateCameraNameKey(name: string): PpeTranslationKey | null {
  const trimmed = name.trim();
  if (!trimmed || Array.from(trimmed).length > 255 || /[\p{Cc}\p{Cs}]/u.test(trimmed)) {
    return 'cameraSetup.register.validation.name';
  }
  return null;
}

function publicManagementErrorKey(error: unknown): PpeTranslationKey {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'cameraSetup.manage.error.401';
    if (error.status === 403) return 'cameraSetup.manage.error.403';
    if (error.status === 404) return 'cameraSetup.manage.error.404';
    if (error.status === 400) return 'cameraSetup.manage.error.400';
    if (error.status === 409) return 'cameraSetup.manage.error.409';
    if (error.status === 429) return 'cameraSetup.manage.error.429';
  }
  return 'cameraSetup.manage.error.default';
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
    !props.isAdmin ||
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
  const { t } = useLocale();
  const [draftState, setDraftState] = useState<{ dirty: boolean; saving: boolean }>({
    dirty: false,
    saving: false,
  });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!confirmDiscard && lastFocusedRef.current) {
      const elementToFocus = lastFocusedRef.current;
      lastFocusedRef.current = null;
      if (elementToFocus.isConnected) {
        elementToFocus.focus();
      }
    }
  }, [confirmDiscard]);

  const handleAttemptClose = () => {
    if (draftState.saving || confirmDiscard) return;
    if (draftState.dirty) {
      if (document.activeElement instanceof HTMLElement) {
        lastFocusedRef.current = document.activeElement;
      }
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
    onCancelRequest: () => void;
  },
) {
  const { t } = useLocale();
  const id = useId();
  const queryClient = useQueryClient();
  const metadataKey = ['camera-management', props.scopeKey, props.camera.id] as const;
  const metadata = useQuery({
    queryKey: metadataKey,
    enabled: false,
    initialData: props.camera,
    gcTime: 0,
    queryFn: async () =>
      parseRefreshCameraResponse(
        await props.client.getCamera(props.token!, props.siteId!, props.camera.id),
        queryClient.getQueryData<CameraResponse>(metadataKey) ?? props.camera,
      ),
  });
  const currentCamera = metadata.data;
  const setCurrentCamera = (row: CameraResponse) => queryClient.setQueryData(metadataKey, row);
  const [draftName, setDraftName] = useState(props.camera.name);
  const [nameErrorKey, setNameErrorKey] = useState<PpeTranslationKey | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: 'error' | 'success';
    key: PpeTranslationKey;
    params?: Record<string, string | number>;
  } | null>(null);
  const rename = useMutation({
    mutationKey: [...metadataKey, 'rename'],
    retry: false,
    gcTime: 0,
    mutationFn: (name: string) =>
      props.client.renameCamera(props.token!, props.siteId!, props.camera.id, name),
  });
  const changeStatus = useMutation({
    mutationKey: [...metadataKey, 'status'],
    retry: false,
    gcTime: 0,
    mutationFn: (input: Parameters<SmartSiteManagementClient['setCameraStatus']>[3]) =>
      props.client.setCameraStatus(props.token!, props.siteId!, props.camera.id, input),
  });
  const savingName = rename.isPending;
  const savingStatus = changeStatus.isPending;
  const isRefreshing = metadata.isFetching;
  const [confirmStatusChange, setConfirmStatusChange] = useState(false);
  const [isConflictBlocked, setIsConflictBlocked] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const activeRef = useRef(false);
  const statusInProgressRef = useRef(false);
  const nameInProgressRef = useRef(false);
  const refreshInProgressRef = useRef(false);

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const isDirty = draftName !== currentCamera.name;
  const isSaving = savingName || savingStatus || isRefreshing;
  const onDraftStateChange = props.onDraftStateChange;

  useLayoutEffect(() => {
    onDraftStateChange({ dirty: isDirty, saving: isSaving });
  }, [isDirty, isSaving, onDraftStateChange]);

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (
      nameInProgressRef.current ||
      statusInProgressRef.current ||
      refreshInProgressRef.current ||
      !activeRef.current ||
      isSaving ||
      isConflictBlocked ||
      blocked ||
      !props.isAdmin ||
      !props.token ||
      !props.siteId
    ) {
      return;
    }
    const errorKey = validateCameraNameKey(draftName);
    setNameErrorKey(errorKey);
    if (errorKey) {
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    nameInProgressRef.current = true;
    setFeedback(null);
    try {
      const trimmed = draftName.trim();
      const updated = await rename.mutateAsync(trimmed);
      if (!activeRef.current) return;
      const validated = parseRenameCameraResponse(
        updated,
        {
          id: currentCamera.id,
          siteId: currentCamera.siteId,
          code: currentCamera.code,
          externalId: currentCamera.externalId,
          currentVersion: currentCamera.configurationVersion,
        },
        trimmed,
      );
      setCurrentCamera(validated);
      setDraftName(validated.name);
      setFeedback({ kind: 'success', key: 'cameraSetup.manage.feedback.renamed' });
      props.onUpdated?.(validated);
    } catch (err) {
      if (!activeRef.current) return;
      if (err instanceof ApiError && [401, 403, 404].includes(err.status ?? 0)) {
        setBlocked(true);
      } else if (!(err instanceof ApiError) || ![400, 429].includes(err.status ?? 0)) {
        setIsConflictBlocked(true);
      }
      setFeedback({ kind: 'error', key: publicManagementErrorKey(err) });
      if (err instanceof ApiError && err.status === 401) {
        props.onUnauthorized?.();
      }
    } finally {
      nameInProgressRef.current = false;
    }
  };

  const handleConfirmStatus = async () => {
    if (
      statusInProgressRef.current ||
      nameInProgressRef.current ||
      refreshInProgressRef.current ||
      !activeRef.current ||
      isSaving ||
      isConflictBlocked ||
      blocked ||
      !props.isAdmin ||
      !props.token ||
      !props.siteId
    ) {
      return;
    }
    statusInProgressRef.current = true;
    const targetStatus = currentCamera.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setFeedback(null);
    try {
      const updated = await changeStatus.mutateAsync({
        status: targetStatus,
        expectedConfigurationVersion: currentCamera.configurationVersion,
      });
      if (!activeRef.current) return;
      const validated = parseSetStatusCameraResponse(updated, {
        id: currentCamera.id,
        siteId: currentCamera.siteId,
        code: currentCamera.code,
        externalId: currentCamera.externalId,
        currentVersion: currentCamera.configurationVersion,
        targetStatus,
      });
      setCurrentCamera(validated);
      // Preserve unsaved name draft on status change
      if (draftName === currentCamera.name) {
        setDraftName(validated.name);
      }
      setConfirmStatusChange(false);
      setFeedback({
        kind: 'success',
        key:
          targetStatus === 'ACTIVE'
            ? 'cameraSetup.manage.feedback.activated'
            : 'cameraSetup.manage.feedback.deactivated',
        params: { version: validated.configurationVersion },
      });
      props.onUpdated?.(validated);
    } catch (err) {
      if (!activeRef.current) return;
      setConfirmStatusChange(false);
      if (err instanceof ApiError && [401, 403, 404].includes(err.status ?? 0)) {
        setBlocked(true);
      } else {
        setIsConflictBlocked(true);
      }
      setFeedback({ kind: 'error', key: publicManagementErrorKey(err) });
      if (err instanceof ApiError && err.status === 401) {
        props.onUnauthorized?.();
      }
    } finally {
      statusInProgressRef.current = false;
    }
  };

  const handleRefreshCamera = async () => {
    if (
      refreshInProgressRef.current ||
      nameInProgressRef.current ||
      statusInProgressRef.current ||
      blocked ||
      !activeRef.current ||
      isSaving ||
      !props.token ||
      !props.siteId
    ) {
      return;
    }
    refreshInProgressRef.current = true;
    setFeedback(null);
    try {
      const result = await metadata.refetch({ cancelRefetch: false });
      if (!activeRef.current) return;
      if (result.error) throw result.error;
      const validated = parseRefreshCameraResponse(result.data, currentCamera);
      setCurrentCamera(validated);
      // Preserve unsaved name draft on refresh
      if (draftName === currentCamera.name) {
        setDraftName(validated.name);
      }
      setIsConflictBlocked(false);
      setFeedback({ kind: 'success', key: 'cameraSetup.manage.feedback.refreshed' });
      props.onUpdated?.(validated);
    } catch (err) {
      if (!activeRef.current) return;
      if (err instanceof ApiError && [401, 403, 404].includes(err.status ?? 0)) {
        setBlocked(true);
      }
      setFeedback({ kind: 'error', key: publicManagementErrorKey(err) });
      if (err instanceof ApiError && err.status === 401) {
        props.onUnauthorized?.();
      }
    } finally {
      refreshInProgressRef.current = false;
    }
  };

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
          onChange={(event) => {
            setDraftName(event.target.value);
            setNameErrorKey(null);
            setFeedback(null);
          }}
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
        <CameraConflictBanner isRefreshing={isRefreshing} onRefresh={handleRefreshCamera} />
      )}

      <CameraActivationSection
        status={currentCamera.status}
        confirmStatusChange={confirmStatusChange}
        disabled={isSaving || isConflictBlocked || blocked}
        savingStatus={savingStatus}
        onOpenConfirm={() => setConfirmStatusChange(true)}
        onCancelConfirm={() => setConfirmStatusChange(false)}
        onConfirmStatus={handleConfirmStatus}
      />

      <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-3.5">
        <button
          type="button"
          disabled={isSaving}
          onClick={props.onCancelRequest}
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
