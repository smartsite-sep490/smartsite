import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError, type ZoneResponse } from '@smartsite/api-client';
import { IconShield, IconAlertTriangle, IconCheck, IconX } from '../icons';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import { getOpaqueTokenNonce, getZonePpeScopeKey } from './zone-ppe-scope';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';

export interface ZonePpeSetupPanelProps {
  apiUrl: string;
  client?: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  siteName: string;
  canManageZones: boolean;
  canManageRegions: boolean;
  canReadZones?: boolean;
  section?: 'all' | 'zones' | 'regions';
  initialCameraId?: string;
  onSelectCamera?: (cameraId: string) => void;
  onClose: () => void;
  embedded?: boolean;
  tourUserId?: string | null;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
}

interface ZonePpeSetupPanelInternalProps extends ZonePpeSetupPanelProps {
  internalNonce: number;
}

type CanonicalPpeItem = 'HARD_HAT' | 'SAFETY_VEST' | 'GLOVES' | 'BOOTS' | 'GOGGLES';

function formatPpeLabel(item: string, t: (key: TranslationKey) => string): string {
  switch (item) {
    case 'HARD_HAT':
      return t('zoneSetup.ppe.HARD_HAT');
    case 'SAFETY_VEST':
      return t('zoneSetup.ppe.SAFETY_VEST');
    case 'GLOVES':
      return t('zoneSetup.ppe.GLOVES');
    case 'BOOTS':
      return t('zoneSetup.ppe.BOOTS');
    case 'GOGGLES':
      return t('zoneSetup.ppe.GOGGLES');
    default:
      return item;
  }
}

// Match the server's Unicode boundary; valid supplementary characters remain allowed.
function hasControlOrSurrogate(value: string): boolean {
  return /[\p{Cc}\p{Cs}]/u.test(value);
}

function isAuthOrScopeError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ApiError) {
    return error.status === 401 || error.status === 403 || error.status === 404;
  }
  if (typeof error === 'object' && 'status' in error) {
    const s = (error as { status: unknown }).status;
    return s === 401 || s === 403 || s === 404;
  }
  return false;
}

function ZonePpeSetupPanelInternal({
  apiUrl,
  client: providedClient,
  token,
  sessionScope,
  credentialId,
  internalNonce,
  siteId,
  siteName,
  canManageZones,
  canManageRegions,
  canReadZones = false,
  section = 'all',
  initialCameraId,
  onSelectCamera,
  onClose,
  embedded = false,
  tourUserId,
  onDraftStateChange,
}: ZonePpeSetupPanelInternalProps) {
  const { t } = useLocale();
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
  const [codeErrorKey, setCodeErrorKey] = useState<TranslationKey | null>(null);
  const [nameErrorKey, setNameErrorKey] = useState<TranslationKey | null>(null);
  const [ppeErrorKey, setPpeErrorKey] = useState<TranslationKey | null>(null);
  const [serverErrorKey, setServerErrorKey] = useState<TranslationKey | null>(null);
  const [createdZoneCode, setCreatedZoneCode] = useState<string | null>(null);

  const zoneCodeInputRef = useRef<HTMLInputElement>(null);
  const zoneNameInputRef = useRef<HTMLInputElement>(null);
  const firstPpeInputRef = useRef<HTMLInputElement>(null);
  const isCreateSubmitting = useRef(false);

  // Rename form state (structured keys/params for live locale retranslation)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZoneName, setEditingZoneName] = useState('');
  const [originalZoneName, setOriginalZoneName] = useState('');
  const [renameValidationErrorKey, setRenameValidationErrorKey] = useState<TranslationKey | null>(
    null,
  );
  const [renameServerErrorKey, setRenameServerErrorKey] = useState<TranslationKey | null>(null);
  const [renamedZoneName, setRenamedZoneName] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const isRenameSubmitting = useRef(false);
  const renameReturnFocusRef = useRef<string | null>(null);

  // Focus rename input when inline editor opens
  useEffect(() => {
    if (canManageZones && editingZoneId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [canManageZones, editingZoneId]);

  // Read-only scoped list of existing zones for this site (cancellable via signal)
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
      if (
        !page ||
        !Array.isArray(page.items) ||
        !Number.isSafeInteger(page.total) ||
        page.total < 0 ||
        page.items.length > 20
      ) {
        throw new ApiError('invalid-response', 'Zone list response is invalid.');
      }
      if (
        Array.isArray(page?.items) &&
        page.items.length === 0 &&
        typeof page.total === 'number' &&
        pageParam < page.total
      ) {
        throw new ApiError('invalid-response', 'Zone list response did not advance.');
      }
      return page;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage || typeof lastPage.total !== 'number' || !Array.isArray(lastPage.items)) {
        return undefined;
      }
      if (lastPage.items.length === 0) {
        return undefined;
      }
      const currentOffset = typeof lastPageParam === 'number' ? lastPageParam : 0;
      const nextOffset = currentOffset + lastPage.items.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    enabled: Boolean(
      (canReadZones || canManageZones || canManageRegions) && token && sessionScope && siteId,
    ),
    gcTime: 0,
    retry: false,
  });

  const rawPages = zonesQuery.data?.pages;
  const { allZones, serverTotal } = useMemo(() => {
    if (!rawPages || rawPages.length === 0) {
      return { allZones: [] as ZoneResponse[], serverTotal: 0 };
    }
    const seenIds = new Set<string>();
    const list: ZoneResponse[] = [];
    let total = 0;
    for (const page of rawPages) {
      if (typeof page?.total === 'number') {
        total = page.total;
      }
      if (Array.isArray(page?.items)) {
        for (const zone of page.items) {
          if (zone && zone.id && !seenIds.has(zone.id) && zone.siteId === siteId) {
            seenIds.add(zone.id);
            list.push(zone);
          }
        }
      }
    }
    return { allZones: list, serverTotal: total };
  }, [rawPages, siteId]);

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

  // Guard: strictly filter out any zones not belonging to the current siteId.
  // When zonesQuery has auth revocation or initial error, do not expose stale zones.
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

  // Revoke local edit/feedback before children render; a denied list must not resurrect a draft.
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

  // Mutation to create a zone scoped to current site
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

      // Wrong-site create response guard: reject response if returned siteId does not match current site scope
      if (data.siteId !== siteId) {
        setServerErrorKey('zoneSetup.create.error.wrongScope');
        setCreatedZoneCode(null);
        return;
      }

      queryClient.invalidateQueries({ queryKey: zonesQueryKey });
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
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerErrorKey('zoneSetup.error.401');
          return;
        }
        if (err.status === 403) {
          setServerErrorKey('zoneSetup.error.403');
          return;
        }
        if (err.status === 409) {
          setServerErrorKey('zoneSetup.create.error.409');
          return;
        }
      }
      setServerErrorKey('zoneSetup.create.error.default');
    },
  });

  // Mutation to rename a zone scoped to current site
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

      // Scope and entity guard: response must match exact siteId and zoneId
      if (data.siteId !== siteId || data.id !== variables.zoneId) {
        setRenameServerErrorKey('zoneSetup.rename.error.wrongScope');
        setRenamedZoneName(null);
        return;
      }

      queryClient.invalidateQueries({ queryKey: zonesQueryKey });
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
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setRenameServerErrorKey('zoneSetup.error.401');
          return;
        }
        if (err.status === 403) {
          setRenameServerErrorKey('zoneSetup.error.403');
          return;
        }
        if (err.status === 409) {
          setRenameServerErrorKey('zoneSetup.rename.error.409');
          return;
        }
      }
      setRenameServerErrorKey('zoneSetup.rename.error.default');
    },
  });

  const [regionDraft, setRegionDraft] = useState({ dirty: false, saving: false });
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

  // The trigger is absent during editing and disabled while saving; wait for its committed return.
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
    // Suppress duplicate pending saves
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

  const codeError = codeErrorKey ? t(codeErrorKey) : null;
  const nameError = nameErrorKey ? t(nameErrorKey) : null;
  const ppeError = ppeErrorKey ? t(ppeErrorKey) : null;
  const serverError = serverErrorKey ? t(serverErrorKey) : null;
  const successFeedback =
    createdZoneCode !== null ? t('zoneSetup.create.success', { code: createdZoneCode }) : null;
  const renameValidationError = renameValidationErrorKey ? t(renameValidationErrorKey) : null;
  const renameServerError = renameServerErrorKey ? t(renameServerErrorKey) : null;
  const renameSuccessFeedback =
    renamedZoneName !== null ? t('zoneSetup.rename.success', { name: renamedZoneName }) : null;

  return (
    <div
      role="region"
      aria-label={t(section === 'regions' ? 'regionSetup.title' : 'zoneSetup.title')}
      className={`space-y-5 min-w-0 w-full max-w-full ${embedded ? '' : 'rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm'}`}
    >
      {!embedded && (
        <div className="flex items-center justify-between border-b border-slate-200/80 pb-4 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-900 flex-shrink-0">
              <IconShield className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">
                {t(section === 'regions' ? 'regionSetup.title' : 'zoneSetup.title')}
              </h3>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {section === 'regions' ? (
                  t('regionSetup.subtitle')
                ) : (
                  <>
                    {t('zoneSetup.subtitlePrefix')}{' '}
                    <span className="font-semibold text-slate-900">{siteName}</span>
                    {t('zoneSetup.subtitleSuffix')}
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('zoneSetup.closeAria')}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer flex-shrink-0"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      {showZoneSection &&
        (canManageZones ? (
          <>
            {/* Server Error Banner (Safe public text only) */}
            {serverError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-800 flex items-center gap-2"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{serverError}</span>
              </div>
            )}

            {/* Success Banner (Truthful feedback regarding camera region connection) */}
            {successFeedback && (
              <div
                role="status"
                className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2"
              >
                <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{successFeedback}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 min-w-0 w-full max-w-full">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 w-full max-w-full">
                <div className="min-w-0 w-full">
                  <label
                    htmlFor="zone-code"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {t('zoneSetup.field.codeLabel')}
                  </label>
                  <input
                    id="zone-code"
                    name="zoneCode"
                    type="text"
                    ref={zoneCodeInputRef}
                    maxLength={64}
                    value={zoneCode}
                    onChange={(e) => {
                      setZoneCode(e.target.value);
                      if (codeErrorKey) setCodeErrorKey(null);
                    }}
                    placeholder={t('zoneSetup.field.codePlaceholder')}
                    disabled={createZoneMutation.isPending}
                    aria-invalid={Boolean(codeError)}
                    aria-describedby={codeError ? 'zone-code-error' : undefined}
                    className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  {codeError && (
                    <p
                      id="zone-code-error"
                      role="alert"
                      className="text-[11px] text-red-600 mt-1 font-medium"
                    >
                      {codeError}
                    </p>
                  )}
                </div>

                <div className="min-w-0 w-full">
                  <label
                    htmlFor="zone-name"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {t('zoneSetup.field.nameLabel')}
                  </label>
                  <input
                    id="zone-name"
                    name="zoneName"
                    type="text"
                    ref={zoneNameInputRef}
                    maxLength={255}
                    value={zoneName}
                    onChange={(e) => {
                      setZoneName(e.target.value);
                      if (nameErrorKey) setNameErrorKey(null);
                    }}
                    placeholder={t('zoneSetup.field.namePlaceholder')}
                    disabled={createZoneMutation.isPending}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? 'zone-name-error' : undefined}
                    className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                  {nameError && (
                    <p
                      id="zone-name-error"
                      role="alert"
                      className="text-[11px] text-red-600 mt-1 font-medium"
                    >
                      {nameError}
                    </p>
                  )}
                </div>
              </div>

              {/* PPE Requirements Selection */}
              <fieldset aria-describedby={ppeError ? 'zone-ppe-error' : undefined}>
                <legend className="block text-xs font-semibold text-slate-700 mb-2">
                  {t('zoneSetup.field.ppeLegend')}
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {/* Core 1: Hard Hat */}
                  <label
                    htmlFor="ppe-item-hard-hat"
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                  >
                    <input
                      id="ppe-item-hard-hat"
                      ref={firstPpeInputRef}
                      aria-invalid={Boolean(ppeError)}
                      aria-describedby={ppeError ? 'zone-ppe-error' : undefined}
                      type="checkbox"
                      checked={selectedPpe.includes('HARD_HAT')}
                      onChange={() => togglePpe('HARD_HAT')}
                      disabled={createZoneMutation.isPending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {t('zoneSetup.ppe.HARD_HAT')}{' '}
                      <span className="text-[10px] text-emerald-700 font-bold">
                        {t('zoneSetup.ppe.coreTag')}
                      </span>
                    </span>
                  </label>

                  {/* Core 2: Safety Vest */}
                  <label
                    htmlFor="ppe-item-safety-vest"
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                  >
                    <input
                      id="ppe-item-safety-vest"
                      type="checkbox"
                      checked={selectedPpe.includes('SAFETY_VEST')}
                      onChange={() => togglePpe('SAFETY_VEST')}
                      disabled={createZoneMutation.isPending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {t('zoneSetup.ppe.SAFETY_VEST')}{' '}
                      <span className="text-[10px] text-emerald-700 font-bold">
                        {t('zoneSetup.ppe.coreTag')}
                      </span>
                    </span>
                  </label>

                  {/* Canonical 3: Gloves (Selectable with Experimental label) */}
                  <label
                    htmlFor="ppe-item-gloves"
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                  >
                    <input
                      id="ppe-item-gloves"
                      type="checkbox"
                      checked={selectedPpe.includes('GLOVES')}
                      onChange={() => togglePpe('GLOVES')}
                      disabled={createZoneMutation.isPending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {t('zoneSetup.ppe.GLOVES')}{' '}
                      <span className="text-[10px] text-sky-700 font-bold">
                        {t('zoneSetup.ppe.experimentalTag')}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.experimentalNote')}
                      </span>
                    </span>
                  </label>

                  {/* Canonical 4: Boots (Selectable with Experimental label) */}
                  <label
                    htmlFor="ppe-item-boots"
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                  >
                    <input
                      id="ppe-item-boots"
                      type="checkbox"
                      checked={selectedPpe.includes('BOOTS')}
                      onChange={() => togglePpe('BOOTS')}
                      disabled={createZoneMutation.isPending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {t('zoneSetup.ppe.BOOTS')}{' '}
                      <span className="text-[10px] text-sky-700 font-bold">
                        {t('zoneSetup.ppe.experimentalTag')}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.experimentalNote')}
                      </span>
                    </span>
                  </label>

                  {/* Canonical 5: Goggles (Selectable with Experimental label) */}
                  <label
                    htmlFor="ppe-item-goggles"
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 p-3 bg-white hover:bg-slate-50 transition-colors cursor-pointer shadow-xs"
                  >
                    <input
                      id="ppe-item-goggles"
                      type="checkbox"
                      checked={selectedPpe.includes('GOGGLES')}
                      onChange={() => togglePpe('GOGGLES')}
                      disabled={createZoneMutation.isPending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span className="text-xs font-medium text-slate-800">
                      {t('zoneSetup.ppe.GOGGLES')}{' '}
                      <span className="text-[10px] text-sky-700 font-bold">
                        {t('zoneSetup.ppe.experimentalTag')}
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.experimentalNote')}
                      </span>
                    </span>
                  </label>

                  {/* Unsupported 1: Harness (Object detection only, NOT canonical requiredPpe) */}
                  <label
                    htmlFor="ppe-item-harness"
                    className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
                  >
                    <input
                      id="ppe-item-harness"
                      type="checkbox"
                      checked={false}
                      disabled={true}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="text-xs text-slate-500">
                      {t('zoneSetup.ppe.HARNESS')}{' '}
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.notAvailableNote')}
                      </span>
                    </span>
                  </label>

                  {/* Unsupported 2: Mask (Object detection only, NOT canonical requiredPpe) */}
                  <label
                    htmlFor="ppe-item-mask"
                    className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
                  >
                    <input
                      id="ppe-item-mask"
                      type="checkbox"
                      checked={false}
                      disabled={true}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="text-xs text-slate-500">
                      {t('zoneSetup.ppe.MASK')}{' '}
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.notAvailableNote')}
                      </span>
                    </span>
                  </label>

                  {/* Unsupported 3: Hook (Object detection only, NOT canonical requiredPpe) */}
                  <label
                    htmlFor="ppe-item-hook"
                    className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-200 p-3 bg-slate-50/70 opacity-60 cursor-not-allowed"
                  >
                    <input
                      id="ppe-item-hook"
                      type="checkbox"
                      checked={false}
                      disabled={true}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="text-xs text-slate-500">
                      {t('zoneSetup.ppe.HOOK')}{' '}
                      <span className="text-[10px] text-slate-500 block">
                        {t('zoneSetup.ppe.notAvailableNote')}
                      </span>
                    </span>
                  </label>
                </div>
                {ppeError && (
                  <p
                    id="zone-ppe-error"
                    role="alert"
                    className="text-[11px] text-red-600 mt-2 font-medium"
                  >
                    {ppeError}
                  </p>
                )}
              </fieldset>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200/80">
                <button
                  type="button"
                  onClick={handleClearCreateForm}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {t('zoneSetup.action.clearForm')}
                </button>
                <button
                  type="submit"
                  disabled={createZoneMutation.isPending}
                  className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
                >
                  {createZoneMutation.isPending ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      {t('zoneSetup.action.saving')}
                    </>
                  ) : (
                    t('zoneSetup.action.saveZonePpe')
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div
            role="note"
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700"
          >
            {t('zoneSetup.readOnly.notice')}
          </div>
        ))}

      {/* Rename Success Feedback Banner */}
      {showZoneSection && canManageZones && renameSuccessFeedback && (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2"
        >
          <IconCheck className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{renameSuccessFeedback}</span>
        </div>
      )}

      {/* Configured Zones on this Site */}
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

        {zonesQuery.isPending && (
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
              onClick={() => void zonesQuery.refetch()}
              disabled={zonesQuery.isFetching}
              className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              {zonesQuery.isFetching
                ? t('zoneSetup.list.retrying')
                : t('zoneSetup.list.retryInitial')}
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
              onClick={() => void zonesQuery.fetchNextPage({ cancelRefetch: false })}
              disabled={zonesQuery.isFetchingNextPage}
              className="rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              {zonesQuery.isFetchingNextPage
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

        {showZoneSection && !zonesQuery.isPending && scopedZones.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
            {scopedZones.map((zone) => {
              const isEditingThisZone = canManageZones && editingZoneId === zone.id;

              if (isEditingThisZone) {
                return (
                  <form
                    key={zone.id}
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSaveRename(zone);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        handleCancelRename();
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
                        onChange={(e) => {
                          setEditingZoneName(e.target.value);
                          if (renameValidationErrorKey) setRenameValidationErrorKey(null);
                          if (renameServerErrorKey) setRenameServerErrorKey(null);
                        }}
                        disabled={renameZoneMutation.isPending}
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
                        onClick={handleCancelRename}
                        disabled={renameZoneMutation.isPending}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {t('zoneSetup.rename.cancelBtn')}
                      </button>
                      <button
                        type="submit"
                        disabled={renameZoneMutation.isPending}
                        className="rounded-xl bg-[#0F172A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 shadow-xs flex items-center gap-1.5"
                      >
                        {renameZoneMutation.isPending ? (
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
                        onClick={() => handleStartRename(zone)}
                        disabled={renameZoneMutation.isPending}
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

        {/* Pagination Controls */}
        {zonesQuery.hasNextPage &&
          !isTransientNextPageError &&
          !isInitialError &&
          !isAuthRevoked && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  if (zonesQuery.isFetching) return;
                  void zonesQuery.fetchNextPage({ cancelRefetch: false });
                }}
                disabled={zonesQuery.isFetching}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-2"
              >
                {zonesQuery.isFetchingNextPage && (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-700 border-t-transparent animate-spin mr-1.5" />
                )}
                {zonesQuery.isFetchingNextPage
                  ? t('zoneSetup.list.loadingMore')
                  : t('zoneSetup.list.loadMore')}
              </button>
            </div>
          )}
      </div>

      {/* Link Zone to Camera Region (MF05) */}
      {showRegionSection && (
        <div className={showZoneSection ? 'border-t border-slate-200/80 pt-4' : ''}>
          {scopedZones.length > 0 ? (
            <ZonePpeCameraRegionPanel
              embedded={section === 'regions'}
              onSelectCamera={onSelectCamera}
              onDraftStateChange={setRegionDraft}
              apiUrl={apiUrl}
              client={client}
              token={token}
              sessionScope={sessionScope}
              credentialId={credentialId}
              siteId={siteId}
              initialCameraId={initialCameraId}
              zones={scopedZones}
              tourUserId={tourUserId}
            />
          ) : isZonesSettledEmpty ? (
            <div
              role="status"
              className="rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] p-4 text-center"
            >
              <span className="text-xs text-slate-500">
                {t(
                  section === 'regions'
                    ? 'zoneSetup.regionLink.emptyTaskHint'
                    : canManageZones
                      ? 'zoneSetup.regionLink.emptyHint'
                      : 'zoneSetup.regionLink.emptyReadOnlyHint',
                )}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Keyed wrapper around ZonePpeSetupPanelInternal.
 * Guarantees that credential or site scope changes cleanly reset drafts, active mutations,
 * and pending rename feedback without stale effect-resets.
 */
export function ZonePpeSetupPanel(props: ZonePpeSetupPanelProps) {
  const queryClient = useQueryClient();
  const internalNonce = useMemo(
    () => getOpaqueTokenNonce(queryClient, props.token),
    [queryClient, props.token],
  );
  if (!props.canReadZones && !props.canManageZones && !props.canManageRegions) {
    return null;
  }
  if (props.section === 'regions' && !props.canManageRegions) {
    return null;
  }
  const scopeKey = getZonePpeScopeKey(queryClient, props);
  return <ZonePpeSetupPanelInternal key={scopeKey} {...props} internalNonce={internalNonce} />;
}
