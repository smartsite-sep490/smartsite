import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  type SavedPpePolicy,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { parseCameraObservationZones } from '@smartsite/contracts/camera-observation-zones';
import { parseCameraPpePolicy } from '@smartsite/contracts/camera-ppe-policy';
import type { CameraResponse } from '@smartsite/contracts/management';
import { PPE_ITEMS, type PpeItem } from '@smartsite/contracts/ppe-items';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import {
  CameraDefaultImpactCard,
  CameraDefaultSummaryCard,
  EffectivePpePreviewBox,
  RegionEffectivePolicyList,
  SavedVsAppliedBanner,
  type RegionPolicyItemView,
  type ZoneIdentity,
} from './CameraPpeOverview';
import {
  useCameraApplicationStatus,
  type CameraApplicationStatusContext,
} from './useCameraApplicationStatus';
import {
  PPE_ITEM_LABEL_KEY,
  isCoreBaselinePpeItem,
  registerCameraPpePolicyCopy,
  type CameraPpeCopyKey,
} from './camera-ppe-policy-copy';
import {
  parsePolicyDraft,
  parseSavedCameraPolicy,
  resolveDraftEffectivePreview,
  resolvePpeMutationErrorKey,
  resolveRegionEffectivePolicy,
  resolveSavedVsAppliedState,
  type PpePolicyDraft,
} from './camera-ppe-policy-model';

registerCameraPpePolicyCopy();

type Client = Pick<
  SmartSiteManagementClient,
  | 'readSavedPpePolicy'
  | 'listRegions'
  | 'initializePpePolicy'
  | 'updateCameraPpePolicy'
  | 'updateRegionPpePolicy'
  | 'activateRegionWithPpePolicy'
> &
  Partial<Pick<SmartSiteManagementClient, 'listZones' | 'getCameraObservationZones'>>;

export interface CameraPpeContext {
  client: Client;
  token: string;
  siteId: string;
  setupKey: readonly unknown[];
  onUnauthorized: () => void;
}

const empty: PpePolicyDraft = { mode: '' };

function readHttpStatus(error: unknown): number | undefined {
  if (error instanceof ApiError && typeof error.status === 'number') return error.status;
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

function isUnauthorizedError(error: unknown): boolean {
  return readHttpStatus(error) === 401;
}

function readHardDenialStatus(error: unknown): 401 | 403 | 404 | null {
  const status = readHttpStatus(error);
  if (status === 401 || status === 403 || status === 404) return status;
  return null;
}

export function PolicyFields({
  value,
  onChange,
  allowInherit,
  label,
  readOnly = false,
  scopeKey,
}: {
  value: PpePolicyDraft;
  onChange: (draft: PpePolicyDraft) => void;
  allowInherit: boolean;
  label: string;
  readOnly?: boolean;
  scopeKey?: string;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const fieldId = useId();
  const readinessGuidanceId = `${fieldId}-readiness-guidance`;
  const explicitErrorId = `${fieldId}-explicit-error`;
  const disabledErrorId = `${fieldId}-disabled-error`;
  const [remembered, setRemembered] = useState<{
    scopeKey: string | undefined;
    requiredPpe: readonly PpeItem[];
    reason: string;
  }>(() => ({
    scopeKey,
    requiredPpe: value.requiredPpe ?? [],
    reason: value.reason ?? '',
  }));
  const activeRememberedPpe =
    remembered.scopeKey === scopeKey ? remembered.requiredPpe : (value.requiredPpe ?? []);
  const activeRememberedReason =
    remembered.scopeKey === scopeKey ? remembered.reason : (value.reason ?? '');

  const isExplicitEmpty =
    !readOnly && value.mode === 'EXPLICIT' && (value.requiredPpe?.length ?? 0) === 0;
  const rawReason = value.reason ?? '';
  const trimmedReason = rawReason.trim();
  const hasInvalidReasonFormat = trimmedReason.length > 500 || /[\p{Cc}\p{Cs}]/u.test(rawReason);
  const disabledValidationKey: CameraPpeCopyKey | null =
    !readOnly && value.mode === 'DISABLED'
      ? trimmedReason.length === 0
        ? 'cameraPpe.validationDisabledReasonRequired'
        : hasInvalidReasonFormat
          ? 'cameraPpe.validationDisabledReasonInvalid'
          : null
      : null;

  const activeFieldsetErrorId = isExplicitEmpty
    ? explicitErrorId
    : disabledValidationKey
      ? disabledErrorId
      : undefined;
  const explicitGroupDescribedBy = [readinessGuidanceId, isExplicitEmpty ? explicitErrorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <fieldset
      aria-describedby={activeFieldsetErrorId}
      className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 min-w-0"
    >
      <legend className="px-1 text-sm font-semibold text-slate-900">{label}</legend>
      <label className="grid gap-1 text-sm font-medium text-slate-800">
        <span>{t('cameraPpe.mode')}</span>
        <select
          className={CAMERA_FIELD_STYLES.input}
          value={value.mode}
          onChange={(event) => {
            const nextMode = event.target.value;
            const currentPpe =
              value.mode === 'EXPLICIT' && value.requiredPpe?.length
                ? value.requiredPpe
                : activeRememberedPpe;
            const currentReason =
              value.mode === 'DISABLED' && value.reason ? value.reason : activeRememberedReason;
            setRemembered({ scopeKey, requiredPpe: currentPpe, reason: currentReason });
            if (nextMode === 'EXPLICIT') {
              onChange({
                mode: 'EXPLICIT',
                ...(currentPpe.length > 0 ? { requiredPpe: [...currentPpe] } : {}),
              });
              return;
            }
            if (nextMode === 'DISABLED') {
              onChange({
                mode: 'DISABLED',
                ...(currentReason ? { reason: currentReason } : {}),
              });
              return;
            }
            onChange({ mode: nextMode });
          }}
        >
          <option value="">{t('cameraPpe.choose')}</option>
          <option value="EXPLICIT">{t('cameraPpe.EXPLICIT')}</option>
          <option value="DISABLED">{t('cameraPpe.DISABLED')}</option>
          {allowInherit && <option value="INHERIT">{t('cameraPpe.INHERIT')}</option>}
        </select>
      </label>
      {value.mode === 'EXPLICIT' && (
        <div className="grid gap-2 min-w-0">
          <div
            role="group"
            aria-label={t('cameraPpe.requiredItemsGroup')}
            aria-describedby={explicitGroupDescribedBy}
            className="flex flex-wrap gap-2 min-w-0"
          >
            {PPE_ITEMS.map((item) => {
              const isCore = isCoreBaselinePpeItem(item);
              const itemBadgeId = `${fieldId}-badge-${item.toLowerCase()}`;
              const itemDescribedBy = [
                itemBadgeId,
                readinessGuidanceId,
                isExplicitEmpty ? explicitErrorId : null,
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={item}
                  data-readiness-tier={isCore ? 'core' : 'experimental'}
                  className="inline-flex min-h-9 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 min-w-0"
                >
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={value.requiredPpe?.includes(item) ?? false}
                      aria-invalid={isExplicitEmpty ? 'true' : undefined}
                      aria-describedby={itemDescribedBy}
                      onChange={(event) =>
                        onChange({
                          mode: 'EXPLICIT',
                          requiredPpe: event.target.checked
                            ? [...(value.requiredPpe ?? []), item]
                            : (value.requiredPpe ?? []).filter((entry) => entry !== item),
                        })
                      }
                    />
                    <span>{t(PPE_ITEM_LABEL_KEY[item])}</span>
                  </label>
                  <span
                    id={itemBadgeId}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                      isCore ? 'text-emerald-800' : 'text-slate-600'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${
                        isCore ? 'bg-emerald-600' : 'bg-teal-600'
                      }`}
                    />
                    {t(
                      isCore
                        ? 'cameraPpe.readinessCoreBadge'
                        : 'cameraPpe.readinessExperimentalBadge',
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <p
            id={readinessGuidanceId}
            data-testid="ppe-readiness-guidance"
            className="text-sm leading-relaxed text-slate-600 break-words"
          >
            {t('cameraPpe.readinessGuidanceNote')}
          </p>
          {isExplicitEmpty && (
            <p
              id={explicitErrorId}
              data-testid="ppe-policy-explicit-validation"
              className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm font-medium text-amber-900 break-words"
            >
              {t('cameraPpe.validationExplicitEmpty')}
            </p>
          )}
        </div>
      )}
      {value.mode === 'DISABLED' && (
        <div className="grid gap-1.5 min-w-0">
          <label className="grid gap-1 text-sm font-medium text-slate-800">
            <span>{t('cameraPpe.reason')}</span>
            <input
              className={CAMERA_FIELD_STYLES.input}
              value={value.reason ?? ''}
              maxLength={500}
              aria-invalid={disabledValidationKey ? 'true' : undefined}
              aria-describedby={disabledValidationKey ? disabledErrorId : undefined}
              onChange={(event) => onChange({ mode: 'DISABLED', reason: event.target.value })}
            />
          </label>
          {disabledValidationKey && (
            <p
              id={disabledErrorId}
              data-testid="ppe-policy-disabled-validation"
              className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm font-medium text-amber-900 break-words"
            >
              {t(disabledValidationKey)}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function CameraPpePolicyPanel({
  context,
  cameraId,
  canWrite,
  camera,
  statusContext,
  expandSignal = 0,
  defaultOpen = false,
  embeddedInTab = false,
  onOpenChange,
  onOpenReference,
  onOpenApply,
}: {
  context: CameraPpeContext;
  cameraId: string;
  canWrite: boolean;
  camera?: CameraResponse;
  statusContext?: CameraApplicationStatusContext;
  expandSignal?: number;
  defaultOpen?: boolean;
  embeddedInTab?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  onOpenReference?: (trigger: HTMLButtonElement) => void;
  onOpenApply?: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [manualOpen, setManualOpen] = useState(defaultOpen);
  const [dismissedSignal, setDismissedSignal] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const open = manualOpen || (expandSignal > 0 && expandSignal !== dismissedSignal);

  useEffect(() => {
    if (expandSignal > 0 && expandSignal !== dismissedSignal) {
      sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandSignal, dismissedSignal]);

  const toggleOpen = () => {
    if (open) {
      setManualOpen(false);
      setDismissedSignal(expandSignal);
      onOpenChange?.(false);
    } else {
      setManualOpen(true);
      onOpenChange?.(true);
    }
  };

  return (
    <section
      ref={sectionRef}
      data-testid="camera-ppe-policy-panel"
      data-tour-anchor="camera-setup-ppe-policy"
      className={
        embeddedInTab
          ? 'rounded-xl border border-slate-200 bg-white p-4 min-w-0'
          : 'rounded-xl border border-slate-200 bg-white p-4 sm:p-5 min-w-0'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <button
            type="button"
            aria-expanded={open}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg text-left text-base font-bold tracking-tight text-slate-950 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
            onClick={toggleOpen}
          >
            <span>{t('cameraPpe.title')}</span>
            <span aria-hidden="true" className="text-xs font-medium text-slate-500">
              {open ? '▾' : '▸'}
            </span>
          </button>
          {(!embeddedInTab || !open) && (
            <p className="text-sm text-slate-600 leading-relaxed">{t('cameraPpe.subtitle')}</p>
          )}
        </div>
      </div>
      {open && (
        <PolicyEditor
          context={context}
          cameraId={cameraId}
          canWrite={canWrite}
          camera={camera}
          statusContext={statusContext}
          embeddedInTab={embeddedInTab}
          onOpenReference={onOpenReference}
          onOpenApply={onOpenApply}
        />
      )}
    </section>
  );
}

function PolicyEditor({
  context,
  cameraId,
  canWrite,
  camera: cameraRecord,
  statusContext,
  embeddedInTab = false,
  onOpenReference,
  onOpenApply,
}: {
  context: CameraPpeContext;
  cameraId: string;
  canWrite: boolean;
  camera?: CameraResponse;
  statusContext?: CameraApplicationStatusContext;
  embeddedInTab?: boolean;
  onOpenReference?: (trigger: HTMLButtonElement) => void;
  onOpenApply?: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const cache = useQueryClient();
  const { client, token, siteId } = context;
  const key = useMemo(
    () => [...context.setupKey, 'ppe-policy', cameraId],
    [context.setupKey, cameraId],
  );
  const args = [token, siteId, cameraId] as const;
  const [regionId, setRegionId] = useState('');
  const [draft, setDraft] = useState<PpePolicyDraft>();
  const [bindings, setBindings] = useState<Record<string, PpePolicyDraft>>({});
  const [receipt, setReceipt] = useState<number>();
  const [latchedDenial, setLatchedDenial] = useState<{
    scope: string;
    status: 401 | 403 | 404;
  } | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const submittingRef = useRef(false);
  const currentZoneScope = `${siteId.trim().toLowerCase()}::${cameraId.trim().toLowerCase()}::${token}`;
  const activeZoneScopeRef = useRef(currentZoneScope);
  const isScopeDenied = latchedDenial?.scope === currentZoneScope;

  const camera = useQuery({
    queryKey: [...key, 'camera'],
    queryFn: ({ signal }) => client.readSavedPpePolicy(...args, null, { signal }),
    enabled: !isScopeDenied,
    retry: false,
  });

  const regions = useQuery({
    queryKey: [...key, 'regions'],
    enabled: !isScopeDenied,
    queryFn: async ({ signal }) => {
      const first = await client.listRegions(...args, { limit: 100 }, { signal });
      const rows = [...first.items];
      while (rows.length < first.total) {
        const next = await client.listRegions(
          ...args,
          { offset: rows.length, limit: 100 },
          { signal },
        );
        if (!next.items.length || next.total !== first.total) {
          throw new Error('Region inventory changed');
        }
        rows.push(...next.items);
      }
      if (
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => row.cameraId !== cameraId)
      ) {
        throw new Error('Invalid Region inventory');
      }
      return rows;
    },
    retry: false,
  });

  const listZonesFn = client.listZones;
  const obsZonesFn = client.getCameraObservationZones;
  useLayoutEffect(() => {
    activeZoneScopeRef.current = currentZoneScope;
    submittingRef.current = false;
    return () => {
      activeZoneScopeRef.current = '';
      submittingRef.current = false;
    };
  }, [currentZoneScope]);

  const zones = useQuery({
    queryKey: [...key, 'zones', siteId.trim().toLowerCase(), cameraId.trim().toLowerCase()],
    enabled:
      !isScopeDenied && (typeof obsZonesFn === 'function' || typeof listZonesFn === 'function'),
    queryFn: async ({ signal }) => {
      const map = new Map<string, ZoneIdentity>();
      const requestScope = currentZoneScope;
      const expectedSite = siteId.trim().toLowerCase();
      const expectedCamera = cameraId.trim().toLowerCase();
      const isCurrentScope = () => !signal.aborted && activeZoneScopeRef.current === requestScope;

      // Configuration writers are Site Managers; their Zone metadata API is listZones.
      // The monitoring projection intentionally requires Officer/Admin access.
      if (
        typeof obsZonesFn === 'function' &&
        (!canWrite || typeof listZonesFn !== 'function') &&
        isCurrentScope()
      ) {
        try {
          const firstRaw = await obsZonesFn.call(
            client,
            token,
            siteId,
            cameraId,
            { offset: 0, limit: 20 },
            { signal },
          );
          if (isCurrentScope()) {
            const first = parseCameraObservationZones(firstRaw);
            if (
              first.siteId.trim().toLowerCase() === expectedSite &&
              first.cameraId.trim().toLowerCase() === expectedCamera
            ) {
              const items = [...first.items];
              while (items.length < first.total && items.length < 64 && isCurrentScope()) {
                const nextRaw = await obsZonesFn.call(
                  client,
                  token,
                  siteId,
                  cameraId,
                  { offset: items.length, limit: 20 },
                  { signal },
                );
                if (!isCurrentScope()) break;
                const next = parseCameraObservationZones(nextRaw);
                if (
                  next.siteId.trim().toLowerCase() !== expectedSite ||
                  next.cameraId.trim().toLowerCase() !== expectedCamera ||
                  !next.items.length ||
                  next.total !== first.total
                ) {
                  break;
                }
                items.push(...next.items);
              }
              if (isCurrentScope()) {
                for (const item of items) {
                  map.set(item.id.trim().toLowerCase(), {
                    id: item.id,
                    code: item.code,
                    name: item.name,
                  });
                }
              }
            }
          }
        } catch (error) {
          if (isUnauthorizedError(error)) throw error;
        }
      }

      if (typeof listZonesFn === 'function' && isCurrentScope()) {
        try {
          const first = await listZonesFn.call(
            client,
            token,
            siteId,
            { offset: 0, limit: 100 },
            { signal },
          );
          const items = [...first.items];
          while (items.length < first.total && isCurrentScope()) {
            const next = await listZonesFn.call(
              client,
              token,
              siteId,
              { offset: items.length, limit: 100 },
              { signal },
            );
            if (!next.items.length || next.total !== first.total) break;
            items.push(...next.items);
          }
          if (isCurrentScope()) {
            for (const entry of items) {
              // Verify exact siteId scope and store identity only; never reuse legacy Zone requiredPpe.
              if (
                typeof entry?.id === 'string' &&
                typeof entry?.code === 'string' &&
                entry.code.trim().length > 0 &&
                typeof entry?.name === 'string' &&
                entry.name.trim().length > 0 &&
                typeof entry?.siteId === 'string' &&
                entry.siteId.trim().toLowerCase() === expectedSite
              ) {
                const normId = entry.id.trim().toLowerCase();
                if (!map.has(normId)) {
                  map.set(normId, { id: entry.id, code: entry.code, name: entry.name });
                }
              }
            }
          }
        } catch (error) {
          if (isUnauthorizedError(error)) throw error;
        }
      }

      return isCurrentScope() ? map : new Map<string, ZoneIdentity>();
    },
    retry: false,
  });

  const regionRows = useMemo(
    () => (isScopeDenied ? [] : (regions.data ?? [])),
    [isScopeDenied, regions.data],
  );
  const regionPolicyQueries = useQueries({
    queries: regionRows.map((row) => ({
      queryKey: [...key, 'region', row.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.readSavedPpePolicy(...args, row.id, { signal }),
      enabled: Boolean(!isScopeDenied && regions.data),
      retry: false,
    })),
  });

  const regionQueryById = useMemo(() => {
    const map = new Map<string, (typeof regionPolicyQueries)[number]>();
    regionRows.forEach((row, index) => {
      const entry = regionPolicyQueries[index];
      if (entry) map.set(row.id, entry);
    });
    return map;
  }, [regionRows, regionPolicyQueries]);

  const selectedRegionQuery = regionId ? regionQueryById.get(regionId) : undefined;
  const selected = regionRows.find((row) => row.id === regionId);
  const saved: SavedPpePolicy | undefined = regionId ? selectedRegionQuery?.data : camera.data;
  const initial = camera.data?.policy === null;
  const active = regionRows.filter((row) => row.isActive);

  const savedConfigurationVersion =
    camera.data?.configurationVersion ?? cameraRecord?.configurationVersion;
  const activeStatusContext =
    statusContext && savedConfigurationVersion !== undefined ? statusContext : undefined;
  const applicationStatus = useCameraApplicationStatus(
    {
      id: cameraId,
      siteId,
      configurationVersion: savedConfigurationVersion ?? 0,
    },
    activeStatusContext,
  );
  const savedVsApplied = resolveSavedVsAppliedState({
    savedConfigurationVersion,
    statusContext: activeStatusContext,
    statusResult: applicationStatus,
  });

  const value: PpePolicyDraft =
    draft ??
    (saved?.policy
      ? ({
          ...saved.policy,
          ...('requiredPpe' in saved.policy ? { requiredPpe: [...saved.policy.requiredPpe] } : {}),
        } as PpePolicyDraft)
      : empty);
  const policy = parsePolicyDraft(value);
  const choices = active.map((row) => ({
    regionId: row.id,
    policy: parsePolicyDraft(bindings[row.id] ?? empty),
  }));

  const submit = ({
    commandId,
    expectedConfigurationVersion,
  }: {
    commandId: string;
    expectedConfigurationVersion: number;
  }) => {
    if (!saved || !policy) throw new Error('Invalid policy');
    const input = { commandId, expectedConfigurationVersion, policy };
    if (regionId) {
      return selected?.isActive
        ? client.updateRegionPpePolicy(...args, regionId, input)
        : client.activateRegionWithPpePolicy(...args, regionId, input);
    }
    if (policy.mode === 'INHERIT') throw new Error('Invalid camera policy');
    const cameraInput = { ...input, policy };
    return initial
      ? client.initializePpePolicy(...args, {
          ...cameraInput,
          regionPolicies: choices.flatMap((choice) =>
            choice.policy ? [{ regionId: choice.regionId, policy: choice.policy }] : [],
          ),
        })
      : client.updateCameraPpePolicy(...args, cameraInput);
  };

  const submittedModeRef = useRef<{ initial: boolean; regionId: string; scope: string }>({
    initial: false,
    regionId: '',
    scope: currentZoneScope,
  });
  const mutation = useMutation({
    mutationFn: async (send: () => ReturnType<typeof submit>) => {
      try {
        return await send();
      } finally {
        submittingRef.current = false;
      }
    },
    onSuccess: async (result) => {
      const lastSubmit = submittedModeRef.current;
      if (activeZoneScopeRef.current !== lastSubmit.scope) return;
      setReceipt(result.configurationVersion);
      setDraft(undefined);
      if (lastSubmit.initial) {
        setBindings({});
      } else if (lastSubmit.regionId) {
        setBindings((prev) => {
          if (!Object.hasOwn(prev, lastSubmit.regionId)) return prev;
          const next = { ...prev };
          delete next[lastSubmit.regionId];
          return next;
        });
      }
      setAttempt(undefined);
      // setupKey already includes the nested policy queries. Refetching key
      // afterward restarts their loading state after the first refresh settles.
      await cache.invalidateQueries({ queryKey: context.setupKey });
      if (
        statusContext?.setupKey &&
        JSON.stringify(statusContext.setupKey) !== JSON.stringify(context.setupKey)
      ) {
        await cache.invalidateQueries({ queryKey: statusContext.setupKey });
      }
    },
    onError: (error) => {
      if (activeZoneScopeRef.current !== submittedModeRef.current.scope) return;
      if (isUnauthorizedError(error)) context.onUnauthorized();
      const hardStatus = readHardDenialStatus(error);
      if (hardStatus !== null) {
        setAttempt(undefined);
        setReceipt(undefined);
        setLatchedDenial({ scope: currentZoneScope, status: hardStatus });
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setAttempt(undefined);
        void cache.invalidateQueries({ queryKey: context.setupKey });
        if (
          statusContext?.setupKey &&
          JSON.stringify(statusContext.setupKey) !== JSON.stringify(context.setupKey)
        ) {
          void cache.invalidateQueries({ queryKey: statusContext.setupKey });
        }
      }
    },
  });

  const [attempt, setAttempt] = useState<() => ReturnType<typeof submit>>();
  const changeDraft = (next: PpePolicyDraft) => {
    setDraft(next);
    if (regionId) {
      setBindings((prev) => (Object.hasOwn(prev, regionId) ? { ...prev, [regionId]: next } : prev));
    }
    setAttempt(undefined);
    setReceipt(undefined);
    mutation.reset();
  };
  const selectTarget = (nextRegionId: string) => {
    const nextBindings =
      regionId && draft !== undefined ? { ...bindings, [regionId]: draft } : bindings;
    if (nextBindings !== bindings) {
      setBindings(nextBindings);
    }
    setRegionId(nextRegionId);
    setDraft(nextRegionId ? nextBindings[nextRegionId] : undefined);
    setAttempt(undefined);
    setReceipt(undefined);
    mutation.reset();
  };

  const freshHardDenialStatus =
    readHardDenialStatus(camera.error) ?? readHardDenialStatus(regions.error);
  if (freshHardDenialStatus !== null && !isScopeDenied) {
    setLatchedDenial({ scope: currentZoneScope, status: freshHardDenialStatus });
  }
  const activeDenialStatus = isScopeDenied ? latchedDenial.status : freshHardDenialStatus;

  const unauthorizedError =
    [camera.error, regions.error, zones.error, ...regionPolicyQueries.map((q) => q.error)].find(
      isUnauthorizedError,
    ) ?? null;
  useEffect(() => {
    if (unauthorizedError || activeDenialStatus === 401) context.onUnauthorized();
  }, [activeDenialStatus, unauthorizedError, context]);

  useEffect(() => {
    if (activeDenialStatus === null) return;
    void cache.cancelQueries({ queryKey: key });
    cache.removeQueries({ queryKey: key });
  }, [activeDenialStatus, cache, key]);

  const failed =
    activeDenialStatus === null &&
    (camera.isError || regions.isError || Boolean(regionId && selectedRegionQuery?.isError));
  const ready = Boolean(activeDenialStatus === null && saved && regions.data);

  const cameraPolicyParsed = parseSavedCameraPolicy(camera.data);
  const zonesById = zones.data;
  const zoneCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of regionRows) {
      const normZoneId = row.zoneId.trim().toLowerCase();
      counts.set(normZoneId, (counts.get(normZoneId) ?? 0) + 1);
    }
    return counts;
  }, [regionRows]);
  const regionIndexById = useMemo(
    () => new Map(regionRows.map((row, idx) => [row.id, idx + 1])),
    [regionRows],
  );
  const formatScopedRegionLabel = (row: (typeof regionRows)[number], indexOneBased: number) => {
    const normZoneId = row.zoneId.trim().toLowerCase();
    const zone = zonesById?.get(normZoneId);
    const regionBadge = t('cameraPpe.regionNumberBadge', { index: indexOneBased });
    const versionMeta = t('cameraPpe.regionVersionMeta', { version: row.version });
    if (zone) {
      return (zoneCounts.get(normZoneId) ?? 1) > 1
        ? `${zone.name} · ${regionBadge} (${versionMeta})`
        : `${zone.name} (${regionBadge} · ${versionMeta})`;
    }
    return `${t('cameraPpe.regionUnresolvedLabel', { index: indexOneBased })} (${versionMeta})`;
  };
  const regionOverviewItems: RegionPolicyItemView[] = regionRows.map((row, idx) => {
    const q = regionQueryById.get(row.id);
    const normZoneId = row.zoneId.trim().toLowerCase();
    const effective = resolveRegionEffectivePolicy({
      cameraPolicy: cameraPolicyParsed,
      regionSaved: q?.data,
      isLoading: Boolean(!q || q.isPending || q.isFetching),
      isError: Boolean(q?.isError),
    });
    return {
      region: row,
      regionIndex: idx + 1,
      sameZoneCount: zoneCounts.get(normZoneId) ?? 1,
      zone: zonesById?.get(normZoneId),
      saved: q?.data,
      effective,
      isSelected: regionId === row.id,
    };
  });

  const initialCameraDraftPolicy = initial ? parseCameraPpePolicy(policy) : cameraPolicyParsed;
  const editingCameraDraftPolicy =
    !initial && !regionId
      ? (parseCameraPpePolicy(policy) ?? cameraPolicyParsed)
      : cameraPolicyParsed;
  const editingRegionPreview =
    !initial && regionId && value.mode
      ? resolveDraftEffectivePreview(cameraPolicyParsed, policy)
      : null;
  const denialCopyKey: CameraPpeCopyKey =
    activeDenialStatus === 403
      ? 'cameraPpe.failed403'
      : activeDenialStatus === 404
        ? 'cameraPpe.failed404'
        : 'cameraPpe.error';

  return (
    <div
      className={
        embeddedInTab ? 'mt-2.5 grid gap-3 text-sm min-w-0' : 'mt-4 grid gap-4 text-sm min-w-0'
      }
    >
      {activeDenialStatus !== null ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-900 flex flex-wrap items-center justify-between gap-2"
        >
          <span>{t(denialCopyKey)}</span>
          {activeDenialStatus !== 401 && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.compactSecondary}
              onClick={() => {
                mutation.reset();
                setLatchedDenial(null);
              }}
            >
              {t('cameraPpe.retry')}
            </button>
          )}
        </div>
      ) : failed ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-900 flex flex-wrap items-center gap-2"
        >
          <span>{t('cameraPpe.error')}</span>
          <button
            type="button"
            className={CAMERA_BUTTON_STYLES.compactSecondary}
            onClick={() => void cache.invalidateQueries({ queryKey: key })}
          >
            {t('cameraPpe.retry')}
          </button>
        </div>
      ) : !ready ? (
        <p role="status" className="text-sm text-slate-600">
          {t('cameraPpe.loading')}
        </p>
      ) : (
        <>
          <SavedVsAppliedBanner
            compact={embeddedInTab}
            state={savedVsApplied}
            onRefreshStatus={
              applicationStatus.canQuery
                ? () => {
                    void applicationStatus.query.refetch();
                  }
                : undefined
            }
            isRefreshingStatus={applicationStatus.query.isFetching}
            onOpenApply={onOpenApply}
          />
          {((initial && applicationStatus.verifiedPayload?.status.viewValidity === 'UNAVAILABLE') ||
            applicationStatus.verifiedPayload?.status.viewValidity === 'NEEDS_REVALIDATION') && (
            <div
              role="status"
              data-testid="camera-ppe-reference-guidance"
              className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 space-y-2"
            >
              <p>
                {t(
                  initial &&
                    applicationStatus.verifiedPayload?.status.viewValidity === 'UNAVAILABLE'
                    ? 'cameraPpe.referenceRequired'
                    : 'cameraPpe.referenceRevalidationRequired',
                )}
              </p>
              {canWrite && onOpenReference && (
                <button
                  type="button"
                  className={CAMERA_BUTTON_STYLES.compactSecondary}
                  onClick={(event) => onOpenReference(event.currentTarget)}
                >
                  {t('cameraPpe.openReference')}
                </button>
              )}
            </div>
          )}

          <div
            data-testid="camera-ppe-capability-note"
            className={
              embeddedInTab
                ? 'rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs leading-relaxed text-slate-600 space-y-0.5'
                : 'rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-sm leading-relaxed text-slate-600 space-y-1'
            }
          >
            <p>{t('cameraPpe.capabilityTruthNote')}</p>
            <p className="text-xs text-slate-600">{t('cameraPpe.modelCapabilityDistinction')}</p>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,1fr)] items-start">
            <div className="space-y-4 min-w-0">
              {camera.data && (
                <CameraDefaultSummaryCard
                  cameraSaved={camera.data}
                  cameraPolicy={cameraPolicyParsed}
                  canEdit={canWrite}
                  isEditingCamera={regionId === ''}
                  onSelectCameraDefault={() => {
                    selectTarget('');
                    selectRef.current?.focus();
                  }}
                />
              )}

              <RegionEffectivePolicyList
                items={regionOverviewItems}
                savedVsApplied={savedVsApplied}
                canEdit={canWrite}
                onSelectRegion={(targetRegionId) => {
                  selectTarget(targetRegionId);
                  selectRef.current?.focus();
                }}
                onRetryRegion={(targetRegionId) => {
                  void regionQueryById.get(targetRegionId)?.refetch();
                }}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 space-y-3.5 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-950">
                    {t('cameraPpe.editorHeading')}
                  </h4>
                  {canWrite && (draft !== undefined || Object.keys(bindings).length > 0) && (
                    <span
                      data-testid="camera-ppe-unsaved-draft"
                      className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
                    >
                      {t('cameraPpe.unsavedDraftBadge')}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-slate-600 tabular-nums">
                  {saved?.savedRevision
                    ? t('cameraPpe.current', { revision: saved.savedRevision })
                    : t('cameraPpe.absent')}
                </p>
              </div>

              {!canWrite && (
                <p className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  {t('cameraPpe.readOnlyNotice')}
                </p>
              )}

              {!initial && canWrite && Object.keys(bindings).length > 0 && (
                <p
                  role="status"
                  data-testid="camera-ppe-preserved-region-drafts"
                  className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm font-medium text-amber-950"
                >
                  {t('cameraPpe.preservedRegionDrafts', { count: Object.keys(bindings).length })}
                </p>
              )}

              {!initial && (
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  <span>{t('cameraPpe.target')}</span>
                  <select
                    ref={selectRef}
                    className={CAMERA_FIELD_STYLES.input}
                    value={regionId}
                    disabled={mutation.isPending}
                    onChange={(event) => selectTarget(event.target.value)}
                  >
                    <option value="">{t('cameraPpe.camera')}</option>
                    {regionRows.map((row, idx) => (
                      <option key={row.id} value={row.id}>
                        {formatScopedRegionLabel(row, idx + 1)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selected &&
                (() => {
                  const selectedZone = zonesById?.get(selected.zoneId.trim().toLowerCase());
                  return (
                    <details
                      data-testid="camera-ppe-editor-tech"
                      className="text-xs text-slate-500"
                    >
                      <summary className="inline-flex min-h-8 cursor-pointer items-center select-none font-medium text-slate-600 hover:text-slate-900">
                        {t('cameraPpe.technicalIdsSummary')}
                      </summary>
                      <div className="mt-1 space-y-0.5 font-mono text-xs text-slate-600 break-all">
                        {selectedZone && (
                          <p>{t('cameraPpe.technicalZoneCode', { code: selectedZone.code })}</p>
                        )}
                        <p>{t('cameraPpe.technicalRegionId', { id: selected.id })}</p>
                        <p>{t('cameraPpe.technicalZoneId', { id: selected.zoneId })}</p>
                      </div>
                    </details>
                  );
                })()}

              <fieldset disabled={!canWrite || mutation.isPending} className="grid gap-3 min-w-0">
                <PolicyFields
                  key={`${cameraId}:${regionId || 'camera'}:${saved?.configurationVersion ?? 0}:${saved?.savedRevision ?? 'none'}`}
                  scopeKey={`${cameraId}:${regionId || 'camera'}:${saved?.configurationVersion ?? 0}:${saved?.savedRevision ?? 'none'}`}
                  label={
                    selected
                      ? formatScopedRegionLabel(selected, regionIndexById.get(selected.id) ?? 1)
                      : regionId
                        ? t('cameraPpe.region')
                        : t('cameraPpe.camera')
                  }
                  value={value}
                  onChange={changeDraft}
                  allowInherit={Boolean(regionId)}
                  readOnly={!canWrite}
                />
                {!initial && !regionId && regionOverviewItems.length > 0 && (
                  <CameraDefaultImpactCard
                    items={regionOverviewItems}
                    draftCameraPolicy={editingCameraDraftPolicy}
                  />
                )}
                {!initial && regionId && value.mode && (
                  <EffectivePpePreviewBox effective={editingRegionPreview} />
                )}
                {initial &&
                  canWrite &&
                  active.map((row) => {
                    const draftEntry = bindings[row.id] ?? empty;
                    const parsedEntry = parsePolicyDraft(draftEntry);
                    const preview = draftEntry.mode
                      ? resolveDraftEffectivePreview(initialCameraDraftPolicy, parsedEntry)
                      : null;
                    return (
                      <div key={row.id} className="grid gap-2">
                        <PolicyFields
                          label={formatScopedRegionLabel(row, regionIndexById.get(row.id) ?? 1)}
                          allowInherit
                          value={draftEntry}
                          onChange={(next) => {
                            setBindings({ ...bindings, [row.id]: next });
                            setAttempt(undefined);
                          }}
                        />
                        {draftEntry.mode && <EffectivePpePreviewBox effective={preview} />}
                      </div>
                    );
                  })}
                {canWrite && (
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      className={`${CAMERA_BUTTON_STYLES.primary} justify-self-start`}
                      disabled={
                        !policy ||
                        (initial && choices.some((choice) => !choice.policy)) ||
                        (Boolean(regionId) && !selected)
                      }
                      onClick={() => {
                        if (!saved || submittingRef.current || mutation.isPending) return;
                        submittingRef.current = true;
                        submittedModeRef.current = { initial, regionId, scope: currentZoneScope };
                        const payload = {
                          commandId: crypto.randomUUID(),
                          expectedConfigurationVersion: saved.configurationVersion,
                        };
                        const send = attempt ?? (() => submit(payload));
                        setAttempt(() => send);
                        mutation.mutate(send);
                      }}
                    >
                      {t(
                        initial
                          ? 'cameraPpe.initialize'
                          : regionId && !selected?.isActive
                            ? 'cameraPpe.activation'
                            : 'cameraPpe.save',
                      )}
                    </button>
                    {(draft !== undefined || Object.keys(bindings).length > 0) && (
                      <button
                        type="button"
                        className={CAMERA_BUTTON_STYLES.secondary}
                        onClick={() => {
                          setDraft(undefined);
                          setBindings({});
                          setAttempt(undefined);
                          mutation.reset();
                        }}
                      >
                        {t('cameraPpe.resetDraft')}
                      </button>
                    )}
                  </div>
                )}
              </fieldset>
            </div>
          </div>
        </>
      )}
      {receipt !== undefined && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm font-medium text-emerald-900"
        >
          {t('cameraPpe.saved', { revision: receipt })}
        </p>
      )}
      {mutation.isError && activeDenialStatus === null && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-900 space-y-2"
        >
          <p>{t(resolvePpeMutationErrorKey(mutation.error))}</p>
          {mutation.error instanceof ApiError && mutation.error.status === 409 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="camera-ppe-409-reload-policy"
                className={CAMERA_BUTTON_STYLES.compactSecondary}
                onClick={() => {
                  mutation.reset();
                  void cache.invalidateQueries({ queryKey: context.setupKey });
                }}
              >
                {t('cameraPpe.retry')}
              </button>
              {canWrite &&
                onOpenReference &&
                (applicationStatus.verifiedPayload?.status.viewValidity === 'UNAVAILABLE' ||
                  applicationStatus.verifiedPayload?.status.viewValidity ===
                    'NEEDS_REVALIDATION') && (
                  <button
                    type="button"
                    data-testid="camera-ppe-409-open-reference"
                    className={CAMERA_BUTTON_STYLES.compactSecondary}
                    onClick={(event) => onOpenReference(event.currentTarget)}
                  >
                    {t('cameraPpe.openReference')}
                  </button>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
