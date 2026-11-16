import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { registerZonePpeSetupCopy, type ZonePpeSetupCopyKey } from './zone-ppe-setup-copy';
import {
  dedupeScopedZones,
  getNextZonePageOffset,
  hasControlOrSurrogate,
  isAuthOrScopeError,
  mapCreateServerErrorKey,
  mapRenameServerErrorKey,
  validateZonePage,
} from './zone-ppe-setup-helpers';
import type { CanonicalPpeItem, ZonePpeSetupPanelInternalProps } from './zone-ppe-setup-types';

export function useZonePpeSetupPanel({
  apiUrl,
  client: providedClient,
  token,
  sessionScope,
  credentialId,
  internalNonce,
  siteId,
  canManageZones,
  canManageRegions,
  canReadZones = false,
  section = 'all',
  onDraftStateChange,
}: ZonePpeSetupPanelInternalProps) {
  registerZonePpeSetupCopy();
  const { t: rawT } = useTranslation(SAFETY_NAMESPACE);
  const t = useCallback(
    (key: ZonePpeSetupCopyKey, params?: Record<string, string | number>): string =>
      params ? rawT(key, { replace: params }) : rawT(key),
    [rawT],
  );

  const queryClient = useQueryClient();
  const fallbackClient = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const client = providedClient ?? fallbackClient;
  const isMountedRef = useRef(true);
  const showZoneSection = section !== 'regions';
  const showRegionSection = section !== 'zones' && canManageRegions;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Create form state (structured keys/params for live locale retranslation)
  const [zoneCode, setZoneCode] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [selectedPpe, setSelectedPpe] = useState<CanonicalPpeItem[]>(['HARD_HAT', 'SAFETY_VEST']);
  const [savedPpe, setSavedPpe] = useState<CanonicalPpeItem[]>(['HARD_HAT', 'SAFETY_VEST']);
  const [codeErrorKey, setCodeErrorKey] = useState<ZonePpeSetupCopyKey | null>(null);
  const [nameErrorKey, setNameErrorKey] = useState<ZonePpeSetupCopyKey | null>(null);
  const [ppeErrorKey, setPpeErrorKey] = useState<ZonePpeSetupCopyKey | null>(null);
  const [serverErrorKey, setServerErrorKey] = useState<ZonePpeSetupCopyKey | null>(null);
  const [createdZoneCode, setCreatedZoneCode] = useState<string | null>(null);

  const zoneCodeInputRef = useRef<HTMLInputElement>(null);
  const zoneNameInputRef = useRef<HTMLInputElement>(null);
  const firstPpeInputRef = useRef<HTMLInputElement>(null);
  const isCreateSubmitting = useRef(false);

  // Rename form state (structured keys/params for live locale retranslation)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZoneName, setEditingZoneName] = useState('');
  const [originalZoneName, setOriginalZoneName] = useState('');
  const [renameValidationErrorKey, setRenameValidationErrorKey] =
    useState<ZonePpeSetupCopyKey | null>(null);
  const [renameServerErrorKey, setRenameServerErrorKey] = useState<ZonePpeSetupCopyKey | null>(
    null,
  );
  const [renamedZoneName, setRenamedZoneName] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const isRenameSubmitting = useRef(false);
  const renameReturnFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (canManageZones && editingZoneId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [canManageZones, editingZoneId]);

  const zonesQueryKey = useMemo(
    () => ['ppe-monitoring', apiUrl, sessionScope, credentialId, siteId, 'zones'],
    [apiUrl, sessionScope, credentialId, siteId],
  );

  const zonesQuery = useInfiniteQuery({
    queryKey: [...zonesQueryKey, 'pages', internalNonce],
    queryFn: async ({ pageParam = 0, signal }) => {
      const page = await client.listZones(
        token,
        siteId,
        { offset: pageParam, limit: 20 },
        { signal },
      );
      return validateZonePage(page, pageParam);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      getNextZonePageOffset(lastPage, allPages, lastPageParam),
    enabled: Boolean(
      (canReadZones || canManageZones || canManageRegions) && token && sessionScope && siteId,
    ),
    gcTime: 0,
    retry: false,
  });

  const rawPages = zonesQuery.data?.pages;
  const { allZones, serverTotal } = useMemo(
    () => dedupeScopedZones(rawPages, siteId),
    [rawPages, siteId],
  );

  const isAuthRevoked = useMemo(() => {
    if (!zonesQuery.isError) return false;
    return isAuthOrScopeError(zonesQuery.error);
  }, [zonesQuery.isError, zonesQuery.error]);

  const isTransientNextPageError = useMemo(() => {
    if (!zonesQuery.isError) return false;
    if (isAuthOrScopeError(zonesQuery.error)) return false;
    return zonesQuery.isFetchNextPageError && Boolean(rawPages?.length);
  }, [zonesQuery.isError, zonesQuery.isFetchNextPageError, zonesQuery.error, rawPages]);

  const isInitialError = useMemo(() => {
    if (!zonesQuery.isError) return false;
    if (isAuthOrScopeError(zonesQuery.error)) return false;
    return !isTransientNextPageError;
  }, [zonesQuery.isError, zonesQuery.error, isTransientNextPageError]);

  const scopedZones = useMemo(() => {
    if (isAuthRevoked || isInitialError) return [];
    return allZones;
  }, [isAuthRevoked, isInitialError, allZones]);

  const isZonesSettledEmpty =
    zonesQuery.isSuccess &&
    !zonesQuery.isFetching &&
    !zonesQuery.isError &&
    !zonesQuery.hasNextPage &&
    scopedZones.length === 0;

  if (
    (isAuthRevoked || !canManageZones) &&
    (editingZoneId ||
      editingZoneName ||
      renameValidationErrorKey ||
      renameServerErrorKey ||
      renamedZoneName !== null)
  ) {
    setEditingZoneId(null);
    setEditingZoneName('');
    setRenameValidationErrorKey(null);
    setRenameServerErrorKey(null);
    setRenamedZoneName(null);
  }

  const createZoneMutation = useMutation({
    mutationFn: async (payload: {
      code: string;
      name: string;
      type: 'HAZARDOUS';
      restrictionPolicy: 'NONE';
      requiredPpe: string[];
    }) => {
      if (!canManageZones) {
        throw new ApiError('http', 'Forbidden', 403);
      }
      return client.createZone(token, siteId, payload);
    },
    onSuccess: (data) => {
      isCreateSubmitting.current = false;
      if (!isMountedRef.current || !canManageZones) return;

      if (data.siteId !== siteId) {
        setServerErrorKey('zoneSetup.create.error.wrongScope');
        setCreatedZoneCode(null);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
      setCreatedZoneCode(data.code);
      setServerErrorKey(null);
      setCodeErrorKey(null);
      setNameErrorKey(null);
      setPpeErrorKey(null);
      setZoneCode('');
      setZoneName('');
      setSavedPpe(selectedPpe);
    },
    onError: (err: unknown) => {
      isCreateSubmitting.current = false;
      if (!isMountedRef.current || !canManageZones) return;
      setCreatedZoneCode(null);
      setServerErrorKey(mapCreateServerErrorKey(err));
    },
  });

  const renameZoneMutation = useMutation({
    mutationFn: async ({ zoneId, name }: { zoneId: string; name: string }) => {
      if (!canManageZones) {
        throw new ApiError('http', 'Forbidden', 403);
      }
      return client.renameZone(token, siteId, zoneId, name);
    },
    onSuccess: (data, variables) => {
      isRenameSubmitting.current = false;
      if (!isMountedRef.current || !canManageZones) return;

      if (data.siteId !== siteId || data.id !== variables.zoneId) {
        setRenameServerErrorKey('zoneSetup.rename.error.wrongScope');
        setRenamedZoneName(null);
        return;
      }

      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
      setRenamedZoneName(data.name);
      setRenameServerErrorKey(null);
      setRenameValidationErrorKey(null);
      renameReturnFocusRef.current = variables.zoneId;
      setEditingZoneId(null);
      setEditingZoneName('');
    },
    onError: (err: unknown) => {
      isRenameSubmitting.current = false;
      if (!isMountedRef.current || !canManageZones) return;
      setRenamedZoneName(null);
      setRenameServerErrorKey(mapRenameServerErrorKey(err));
    },
  });

  const [regionDraft, setRegionDraft] = useState({ dirty: false, saving: false });
  if (
    (!showRegionSection || scopedZones.length === 0) &&
    (regionDraft.dirty || regionDraft.saving)
  ) {
    setRegionDraft({ dirty: false, saving: false });
  }

  const zoneDirty =
    canManageZones &&
    (zoneCode !== '' ||
      zoneName !== '' ||
      selectedPpe.length !== savedPpe.length ||
      selectedPpe.some((item) => !savedPpe.includes(item)) ||
      (editingZoneId !== null && editingZoneName !== originalZoneName));
  const dirty = zoneDirty || (canManageRegions && regionDraft.dirty);
  const saving =
    (canManageZones && (createZoneMutation.isPending || renameZoneMutation.isPending)) ||
    (canManageRegions && regionDraft.saving);

  useEffect(() => {
    onDraftStateChange?.({ dirty, saving });
  }, [dirty, saving, onDraftStateChange]);

  useEffect(() => {
    if (
      !canManageZones ||
      editingZoneId ||
      renameZoneMutation.isPending ||
      !renameReturnFocusRef.current
    ) {
      return;
    }
    renameTriggerRefs.current[renameReturnFocusRef.current]?.focus();
    renameReturnFocusRef.current = null;
  }, [canManageZones, editingZoneId, renameZoneMutation.isPending]);

  const togglePpe = (item: CanonicalPpeItem) => {
    if (!canManageZones) return;
    setSelectedPpe((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
    );
    if (ppeErrorKey) setPpeErrorKey(null);
  };

  const handleClearCreateForm = () => {
    if (
      !canManageZones ||
      isAuthRevoked ||
      saving ||
      isCreateSubmitting.current ||
      isRenameSubmitting.current
    ) {
      return;
    }
    setZoneCode('');
    setZoneName('');
    setSelectedPpe([...savedPpe]);
    setCodeErrorKey(null);
    setNameErrorKey(null);
    setPpeErrorKey(null);
    setServerErrorKey(null);
    setCreatedZoneCode(null);
    zoneCodeInputRef.current?.focus();
  };

  const handleStartRename = (zone: ZoneResponse) => {
    if (!canManageZones || renameZoneMutation.isPending) return;
    setEditingZoneId(zone.id);
    setEditingZoneName(zone.name);
    setOriginalZoneName(zone.name);
    setRenameValidationErrorKey(null);
    setRenameServerErrorKey(null);
    setRenamedZoneName(null);
  };

  const handleCancelRename = () => {
    if (renameZoneMutation.isPending || isRenameSubmitting.current) return;
    renameReturnFocusRef.current = editingZoneId;
    setEditingZoneId(null);
    setEditingZoneName('');
    setRenameValidationErrorKey(null);
    setRenameServerErrorKey(null);
  };

  const handleSaveRename = (zone: ZoneResponse) => {
    if (!canManageZones || renameZoneMutation.isPending || isRenameSubmitting.current) return;

    if (hasControlOrSurrogate(editingZoneName)) {
      setRenameValidationErrorKey('zoneSetup.rename.validation.controlChars');
      renameInputRef.current?.focus();
      return;
    }

    const trimmed = editingZoneName.trim();
    if (!trimmed) {
      setRenameValidationErrorKey('zoneSetup.rename.validation.required');
      renameInputRef.current?.focus();
      return;
    }

    if (trimmed.length > 255) {
      setRenameValidationErrorKey('zoneSetup.rename.validation.maxLength');
      renameInputRef.current?.focus();
      return;
    }

    setRenameValidationErrorKey(null);
    setRenameServerErrorKey(null);
    isRenameSubmitting.current = true;

    renameZoneMutation.mutate({
      zoneId: zone.id,
      name: trimmed,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageZones || createZoneMutation.isPending || isCreateSubmitting.current) return;

    setCodeErrorKey(null);
    setNameErrorKey(null);
    setPpeErrorKey(null);
    setServerErrorKey(null);

    const trimmedCode = zoneCode.trim();
    const trimmedName = zoneName.trim();

    if (!trimmedCode) {
      setCodeErrorKey('zoneSetup.validation.codeRequired');
      zoneCodeInputRef.current?.focus();
      return;
    }
    if (hasControlOrSurrogate(zoneCode)) {
      setCodeErrorKey('zoneSetup.validation.codeControlChars');
      zoneCodeInputRef.current?.focus();
      return;
    }
    if (trimmedCode.length > 64) {
      setCodeErrorKey('zoneSetup.validation.codeMaxLength');
      zoneCodeInputRef.current?.focus();
      return;
    }

    if (!trimmedName) {
      setNameErrorKey('zoneSetup.validation.nameRequired');
      zoneNameInputRef.current?.focus();
      return;
    }
    if (hasControlOrSurrogate(zoneName)) {
      setNameErrorKey('zoneSetup.validation.nameControlChars');
      zoneNameInputRef.current?.focus();
      return;
    }
    if (trimmedName.length > 255) {
      setNameErrorKey('zoneSetup.validation.nameMaxLength');
      zoneNameInputRef.current?.focus();
      return;
    }

    if (selectedPpe.length === 0) {
      setPpeErrorKey('zoneSetup.validation.ppeRequired');
      firstPpeInputRef.current?.focus();
      return;
    }

    isCreateSubmitting.current = true;
    createZoneMutation.mutate({
      code: trimmedCode,
      name: trimmedName,
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: selectedPpe,
    });
  };

  const handleZoneCodeChange = (value: string) => {
    setZoneCode(value);
    if (codeErrorKey) setCodeErrorKey(null);
  };

  const handleZoneNameChange = (value: string) => {
    setZoneName(value);
    if (nameErrorKey) setNameErrorKey(null);
  };

  const handleEditingZoneNameChange = (value: string) => {
    setEditingZoneName(value);
    if (renameValidationErrorKey) setRenameValidationErrorKey(null);
    if (renameServerErrorKey) setRenameServerErrorKey(null);
  };

  return {
    t,
    client,
    showZoneSection,
    showRegionSection,
    zonesQuery,
    scopedZones,
    serverTotal,
    isAuthRevoked,
    isTransientNextPageError,
    isInitialError,
    isZonesSettledEmpty,
    zoneCode,
    zoneName,
    selectedPpe,
    codeError: codeErrorKey ? t(codeErrorKey) : null,
    nameError: nameErrorKey ? t(nameErrorKey) : null,
    ppeError: ppeErrorKey ? t(ppeErrorKey) : null,
    serverError: serverErrorKey ? t(serverErrorKey) : null,
    successFeedback:
      createdZoneCode !== null ? t('zoneSetup.create.success', { code: createdZoneCode }) : null,
    isCreatingZone: createZoneMutation.isPending,
    saving,
    zoneCodeInputRef,
    zoneNameInputRef,
    firstPpeInputRef,
    editingZoneId,
    editingZoneName,
    renameValidationError: renameValidationErrorKey ? t(renameValidationErrorKey) : null,
    renameServerError: renameServerErrorKey ? t(renameServerErrorKey) : null,
    renameSuccessFeedback:
      renamedZoneName !== null ? t('zoneSetup.rename.success', { name: renamedZoneName }) : null,
    isRenamingZone: renameZoneMutation.isPending,
    renameInputRef,
    renameTriggerRefs,
    setRegionDraft,
    handleZoneCodeChange,
    handleZoneNameChange,
    togglePpe,
    handleClearCreateForm,
    handleStartRename,
    handleCancelRename,
    handleEditingZoneNameChange,
    handleSaveRename,
    handleSubmit,
  };
}
