import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { PPE_ITEMS } from '@smartsite/contracts/ppe-items';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES, CAMERA_FIELD_STYLES } from './camera-dialog-styles';
import {
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
import { PPE_ITEM_LABEL_KEY, registerCameraPpePolicyCopy } from './camera-ppe-policy-copy';
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

function isUnauthorizedError(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.status === 401) ||
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401)
  );
}

export function PolicyFields({
  value,
  onChange,
  allowInherit,
  label,
}: {
  value: PpePolicyDraft;
  onChange: (draft: PpePolicyDraft) => void;
  allowInherit: boolean;
  label: string;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3.5 min-w-0">
      <legend className="px-1 text-xs font-semibold text-slate-900">{label}</legend>
      <label className="grid gap-1 text-xs font-medium text-slate-700">
        <span>{t('cameraPpe.mode')}</span>
        <select
          className={CAMERA_FIELD_STYLES.input}
          value={value.mode}
          onChange={(event) => onChange({ mode: event.target.value })}
        >
          <option value="">{t('cameraPpe.choose')}</option>
          <option value="EXPLICIT">{t('cameraPpe.EXPLICIT')}</option>
          <option value="DISABLED">{t('cameraPpe.DISABLED')}</option>
          {allowInherit && <option value="INHERIT">{t('cameraPpe.INHERIT')}</option>}
        </select>
      </label>
      {value.mode === 'EXPLICIT' && (
        <div className="flex flex-wrap gap-2">
          {PPE_ITEMS.map((item) => (
            <div
              key={item}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
            >
              <label className="flex items-center gap-2 text-xs font-mono text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.requiredPpe?.includes(item) ?? false}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      requiredPpe: event.target.checked
                        ? [...(value.requiredPpe ?? []), item]
                        : (value.requiredPpe ?? []).filter((entry) => entry !== item),
                    })
                  }
                />
                <span>{item}</span>
              </label>
              <span className="text-xs text-slate-500">· {t(PPE_ITEM_LABEL_KEY[item])}</span>
            </div>
          ))}
        </div>
      )}
      {value.mode === 'DISABLED' && (
        <label className="grid gap-1 text-xs font-medium text-slate-700">
          <span>{t('cameraPpe.reason')}</span>
          <input
            className={CAMERA_FIELD_STYLES.input}
            value={value.reason ?? ''}
            maxLength={500}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
          />
        </label>
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
}: {
  context: CameraPpeContext;
  cameraId: string;
  canWrite: boolean;
  camera?: CameraResponse;
  statusContext?: CameraApplicationStatusContext;
  expandSignal?: number;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const [manualOpen, setManualOpen] = useState(false);
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
    } else {
      setManualOpen(true);
    }
  };

  return (
    <section
      ref={sectionRef}
      data-testid="camera-ppe-policy-panel"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="inline-flex items-center gap-2 rounded-lg text-left text-sm font-semibold text-slate-900 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 cursor-pointer"
          onClick={toggleOpen}
        >
          {t('cameraPpe.title')}
        </button>
        <span aria-hidden="true" className="text-xs text-slate-500">
          {open ? '▾' : '▸'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600 leading-relaxed">{t('cameraPpe.subtitle')}</p>
      {open && (
        <PolicyEditor
          context={context}
          cameraId={cameraId}
          canWrite={canWrite}
          camera={camera}
          statusContext={statusContext}
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
}: {
  context: CameraPpeContext;
  cameraId: string;
  canWrite: boolean;
  camera?: CameraResponse;
  statusContext?: CameraApplicationStatusContext;
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
  const selectRef = useRef<HTMLSelectElement>(null);

  const camera = useQuery({
    queryKey: [...key, 'camera'],
    queryFn: ({ signal }) => client.readSavedPpePolicy(...args, null, { signal }),
    retry: false,
  });

  const regions = useQuery({
    queryKey: [...key, 'regions'],
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
  const currentZoneScope = `${siteId.trim().toLowerCase()}::${cameraId.trim().toLowerCase()}::${token}`;
  const activeZoneScopeRef = useRef(currentZoneScope);
  useLayoutEffect(() => {
    activeZoneScopeRef.current = currentZoneScope;
  }, [currentZoneScope]);

  const zones = useQuery({
    queryKey: [...key, 'zones', siteId.trim().toLowerCase(), cameraId.trim().toLowerCase()],
    enabled: typeof obsZonesFn === 'function' || typeof listZonesFn === 'function',
    queryFn: async ({ signal }) => {
      const map = new Map<string, ZoneIdentity>();
      const requestScope = currentZoneScope;
      const expectedSite = siteId.trim().toLowerCase();
      const expectedCamera = cameraId.trim().toLowerCase();
      const isCurrentScope = () => !signal.aborted && activeZoneScopeRef.current === requestScope;

      if (typeof obsZonesFn === 'function' && isCurrentScope()) {
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

  const regionRows = useMemo(() => regions.data ?? [], [regions.data]);
  const regionPolicyQueries = useQueries({
    queries: regionRows.map((row) => ({
      queryKey: [...key, 'region', row.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.readSavedPpePolicy(...args, row.id, { signal }),
      enabled: Boolean(regions.data),
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

  const submittedModeRef = useRef<{ initial: boolean; regionId: string }>({
    initial: false,
    regionId: '',
  });
  const mutation = useMutation({
    mutationFn: (send: () => ReturnType<typeof submit>) => send(),
    onSuccess: async (result) => {
      setReceipt(result.configurationVersion);
      setDraft(undefined);
      const lastSubmit = submittedModeRef.current;
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
      await cache.invalidateQueries({ queryKey: context.setupKey });
      await cache.invalidateQueries({ queryKey: key });
      if (statusContext?.setupKey) {
        await cache.invalidateQueries({ queryKey: statusContext.setupKey });
      }
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) context.onUnauthorized();
      if (error instanceof ApiError && error.status === 409) {
        setAttempt(undefined);
        void cache.invalidateQueries({ queryKey: context.setupKey });
        void cache.invalidateQueries({ queryKey: key });
        if (statusContext?.setupKey) {
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

  const unauthorizedError =
    [camera.error, regions.error, zones.error, ...regionPolicyQueries.map((q) => q.error)].find(
      isUnauthorizedError,
    ) ?? null;
  useEffect(() => {
    if (unauthorizedError) context.onUnauthorized();
  }, [unauthorizedError, context]);

  const failed =
    camera.isError || regions.isError || Boolean(regionId && selectedRegionQuery?.isError);
  const ready = Boolean(
    saved &&
    regions.data &&
    !camera.isFetching &&
    !regions.isFetching &&
    (!regionId || !selectedRegionQuery?.isFetching),
  );

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
    const zone = zonesById?.get(row.zoneId.trim().toLowerCase());
    if (zone) {
      return `${t('cameraPpe.regionNumberBadge', { index: indexOneBased })} · ${zone.code} · ${zone.name}`;
    }
    return `${t('cameraPpe.regionUnresolvedLabel', { index: indexOneBased })} (${t('cameraPpe.regionVersionMeta', { version: row.version })})`;
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
  const editingRegionPreview =
    !initial && regionId && value.mode
      ? resolveDraftEffectivePreview(cameraPolicyParsed, policy)
      : null;

  return (
    <div className="mt-4 grid gap-4 text-sm min-w-0">
      {failed ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900 flex flex-wrap items-center gap-2"
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
        <p role="status" className="text-xs text-slate-600">
          {t('cameraPpe.loading')}
        </p>
      ) : (
        <>
          <SavedVsAppliedBanner state={savedVsApplied} />

          <p
            data-testid="camera-ppe-capability-note"
            className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2 text-xs leading-relaxed text-slate-600"
          >
            {t('cameraPpe.capabilityTruthNote')}
          </p>

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

          <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-semibold text-slate-900">
                  {t('cameraPpe.editorHeading')}
                </h4>
                {canWrite && (draft !== undefined || Object.keys(bindings).length > 0) && (
                  <span
                    data-testid="camera-ppe-unsaved-draft"
                    className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
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
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {t('cameraPpe.readOnlyNotice')}
              </p>
            )}

            {!initial && canWrite && Object.keys(bindings).length > 0 && (
              <p
                role="status"
                data-testid="camera-ppe-preserved-region-drafts"
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950"
              >
                {t('cameraPpe.preservedRegionDrafts', { count: Object.keys(bindings).length })}
              </p>
            )}

            {!initial && (
              <label className="grid gap-1 text-xs font-medium text-slate-700">
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
            {selected && (
              <details data-testid="camera-ppe-editor-tech" className="text-[11px] text-slate-500">
                <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-900">
                  {t('cameraPpe.technicalIdsSummary')}
                </summary>
                <div className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600 break-all">
                  <p>{t('cameraPpe.technicalRegionId', { id: selected.id })}</p>
                  <p>{t('cameraPpe.technicalZoneId', { id: selected.zoneId })}</p>
                </div>
              </details>
            )}

            <fieldset disabled={!canWrite || mutation.isPending} className="grid gap-3 min-w-0">
              <PolicyFields
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
              />
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`${CAMERA_BUTTON_STYLES.primary} justify-self-start`}
                    disabled={
                      !policy ||
                      (initial && choices.some((choice) => !choice.policy)) ||
                      (Boolean(regionId) && !selected)
                    }
                    onClick={() => {
                      if (!saved) return;
                      submittedModeRef.current = { initial, regionId };
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
                      className={CAMERA_BUTTON_STYLES.compactSecondary}
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
        </>
      )}
      {receipt !== undefined && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900"
        >
          {t('cameraPpe.saved', { revision: receipt })}
        </p>
      )}
      {mutation.isError && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-900"
        >
          {t(resolvePpeMutationErrorKey(mutation.error))}
        </p>
      )}
    </div>
  );
}
