import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CameraManagementCopyKey } from './camera-management-copy';
import {
  parseRefreshCameraResponse,
  parseRenameCameraResponse,
  parseSetStatusCameraResponse,
  publicManagementErrorKey,
  validateCameraNameKey,
} from './camera-management-response';

export interface UseCameraManagementDialogOptions {
  id: string;
  token: string | null;
  siteId: string | null;
  camera: CameraResponse;
  canManageCamera: boolean;
  client: SmartSiteManagementClient;
  scopeKey: string;
  onUpdated?: (camera: CameraResponse) => void;
  onUnauthorized?: () => void;
  onDraftStateChange: (state: { dirty: boolean; saving: boolean }) => void;
  onRegisterStatusCancel: (handler: (() => boolean) | null) => void;
}

export function useCameraManagementDialog(props: UseCameraManagementDialogOptions) {
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
  const [nameErrorKey, setNameErrorKey] = useState<CameraManagementCopyKey | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: 'error' | 'success';
    key: CameraManagementCopyKey;
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
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  const statusConfirmContainerRef = useRef<HTMLDivElement>(null);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const pendingStatusFocusTargetRef = useRef<'none' | 'trigger' | 'conflict' | 'cancel'>('none');
  const pendingCancelStatusFocusRef = useRef(false);

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const isDirty = draftName !== currentCamera.name;
  const isSaving = savingName || savingStatus || isRefreshing;
  const onDraftStateChange = props.onDraftStateChange;
  const onRegisterStatusCancel = props.onRegisterStatusCancel;

  useLayoutEffect(() => {
    onRegisterStatusCancel(() => {
      if (!confirmStatusChange || isSaving) return false;
      pendingCancelStatusFocusRef.current = true;
      setConfirmStatusChange(false);
      return true;
    });
    return () => {
      onRegisterStatusCancel(null);
    };
  }, [onRegisterStatusCancel, confirmStatusChange, isSaving]);

  useLayoutEffect(() => {
    if (!confirmStatusChange && pendingCancelStatusFocusRef.current) {
      pendingCancelStatusFocusRef.current = false;
      statusTriggerRef.current?.focus();
    }
  }, [confirmStatusChange]);

  useLayoutEffect(() => {
    onDraftStateChange({ dirty: isDirty, saving: isSaving });
  }, [isDirty, isSaving, onDraftStateChange]);

  useLayoutEffect(() => {
    if (confirmStatusChange || isSaving || pendingStatusFocusTargetRef.current === 'none') {
      return;
    }
    const target = pendingStatusFocusTargetRef.current;
    pendingStatusFocusTargetRef.current = 'none';
    if (document.activeElement && document.activeElement !== document.body) {
      return;
    }
    if (target === 'trigger') {
      statusTriggerRef.current?.focus();
    } else if (target === 'conflict') {
      refreshButtonRef.current?.focus();
    } else if (target === 'cancel') {
      cancelButtonRef.current?.focus();
    }
  }, [confirmStatusChange, isSaving, isConflictBlocked, blocked]);

  const handleDraftNameChange = (value: string) => {
    setDraftName(value);
    setNameErrorKey(null);
    setFeedback(null);
  };

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
      !props.canManageCamera ||
      !props.token ||
      !props.siteId
    ) {
      return;
    }
    const errorKey = validateCameraNameKey(draftName);
    setNameErrorKey(errorKey);
    if (errorKey) {
      document.getElementById(`${props.id}-name`)?.focus();
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
      !props.canManageCamera ||
      !props.token ||
      !props.siteId
    ) {
      return;
    }
    const ownedConfirmFocus = Boolean(
      statusConfirmContainerRef.current &&
      document.activeElement instanceof Node &&
      statusConfirmContainerRef.current.contains(document.activeElement),
    );
    pendingStatusFocusTargetRef.current = 'none';
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
      if (ownedConfirmFocus) {
        pendingStatusFocusTargetRef.current = 'trigger';
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
        if (ownedConfirmFocus) {
          pendingStatusFocusTargetRef.current = 'cancel';
        }
        setBlocked(true);
      } else {
        if (ownedConfirmFocus) {
          pendingStatusFocusTargetRef.current = 'conflict';
        }
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

  return {
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
  };
}
