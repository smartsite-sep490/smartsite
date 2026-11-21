import { useTranslation } from 'react-i18next';
import type { SavedPpePolicy } from '@smartsite/api-client';
import type { CameraPpePolicy } from '@smartsite/contracts/camera-ppe-policy';
import type { RegionResponse } from '@smartsite/contracts/management';
import type { PpeItem } from '@smartsite/contracts/ppe-items';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { KNOWN_APPLICATION_STATUS_REASON_KEYS } from './camera-application-status-copy';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import { PPE_ITEM_LABEL_KEY, type CameraPpeCopyKey } from './camera-ppe-policy-copy';
import type { RegionEffectivePolicyState, SavedVsAppliedState } from './camera-ppe-policy-model';

export interface ZoneIdentity {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface RegionPolicyItemView {
  readonly region: RegionResponse;
  readonly regionIndex: number;
  readonly sameZoneCount: number;
  readonly zone: ZoneIdentity | undefined;
  readonly saved: SavedPpePolicy | undefined;
  readonly effective: RegionEffectivePolicyState;
  readonly isSelected: boolean;
}

function PpeItemBadges({ items }: { items: readonly PpeItem[] }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li
          key={item}
          className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-800"
        >
          {t(PPE_ITEM_LABEL_KEY[item])}
        </li>
      ))}
    </ul>
  );
}

const MODE_BADGE_CLASSES = {
  INHERIT: 'border-sky-200 bg-sky-50 text-sky-900',
  EXPLICIT: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  DISABLED: 'border-rose-200 bg-rose-50 text-rose-900',
  UNCONFIGURED: 'border-amber-200 bg-amber-50 text-amber-900',
} as const;

function modeBadgeCopyKey(
  mode: 'INHERIT' | 'EXPLICIT' | 'DISABLED' | 'UNCONFIGURED',
): CameraPpeCopyKey {
  switch (mode) {
    case 'INHERIT':
      return 'cameraPpe.modeBadge.INHERIT';
    case 'EXPLICIT':
      return 'cameraPpe.modeBadge.EXPLICIT';
    case 'DISABLED':
      return 'cameraPpe.modeBadge.DISABLED';
    case 'UNCONFIGURED':
      return 'cameraPpe.modeBadge.UNCONFIGURED';
  }
}

export function EffectivePpeDetails({
  effective,
  onRetry,
}: {
  effective: RegionEffectivePolicyState;
  onRetry?: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

  if (effective.kind === 'loading') {
    return <p className="text-xs text-slate-500">{t('cameraPpe.effectiveLoading')}</p>;
  }
  if (effective.kind === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-rose-800">
        <span>{t('cameraPpe.effectiveError')}</span>
        {onRetry && (
          <button type="button" className={CAMERA_BUTTON_STYLES.compactSecondary} onClick={onRetry}>
            {t('cameraPpe.retry')}
          </button>
        )}
      </div>
    );
  }
  if (effective.kind === 'unconfigured') {
    return <p className="text-xs text-amber-900">{t('cameraPpe.effectiveUnknownUninitialized')}</p>;
  }
  if (effective.kind === 'camera-unconfigured') {
    return <p className="text-xs text-amber-900">{t('cameraPpe.effectiveUnknownCameraDefault')}</p>;
  }
  if (effective.disabled) {
    return (
      <div className="space-y-1 text-xs text-slate-700">
        <p className="font-medium text-rose-800">
          {t(
            effective.disabledByCameraDefault
              ? 'cameraPpe.effectiveDisabledByCamera'
              : 'cameraPpe.effectiveDisabled',
          )}
        </p>
        {effective.reason && (
          <p className="text-slate-600 break-words [overflow-wrap:anywhere]">
            {t('cameraPpe.effectiveReason', { reason: effective.reason })}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-700">
          {t('cameraPpe.effectivePpeLabel')}:
        </span>
        <span className="text-xs text-slate-500">
          {t(
            effective.source === 'CAMERA_DEFAULT'
              ? 'cameraPpe.effectiveFromCamera'
              : 'cameraPpe.effectiveFromRegion',
          )}
        </span>
      </div>
      <PpeItemBadges items={effective.requiredPpe} />
    </div>
  );
}

export function SavedVsAppliedBanner({ state }: { state: SavedVsAppliedState }) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const savedLabel =
    state.savedConfigurationVersion !== undefined
      ? t('cameraPpe.syncSavedVersion', { version: state.savedConfigurationVersion })
      : t('cameraPpe.syncSavedUnknown');

  const reportedValue =
    'reportedRevision' in state && state.reportedRevision !== null
      ? `v${state.reportedRevision}`
      : t('cameraPpe.syncNoneReported');

  let workerTone = 'border-slate-200 bg-white text-slate-700';
  let workerText: string;

  switch (state.kind) {
    case 'applied':
      workerTone = 'border-emerald-200 bg-emerald-50 text-emerald-900';
      workerText = t('cameraPpe.syncApplied', { reported: state.reportedRevision });
      break;
    case 'not-yet-applied':
      workerTone = 'border-amber-200 bg-amber-50 text-amber-900';
      workerText = t('cameraPpe.syncNotYetApplied', { reported: reportedValue });
      break;
    case 'unconfirmed':
      workerTone = 'border-amber-200 bg-amber-50 text-amber-900';
      workerText = t('cameraPpe.syncUnconfirmed');
      break;
    case 'stale':
      workerTone = 'border-rose-200 bg-rose-50 text-rose-900';
      workerText = t('cameraPpe.syncStale', { reported: reportedValue });
      break;
    case 'rejected': {
      workerTone = 'border-rose-200 bg-rose-50 text-rose-900';
      const reasonKey = state.reasonCode
        ? KNOWN_APPLICATION_STATUS_REASON_KEYS[state.reasonCode]
        : undefined;
      workerText = t('cameraPpe.syncRejected', {
        reason: t(reasonKey ?? 'cameraSetup.appStatus.reason.OTHER'),
      });
      break;
    }
    case 'checking':
      workerText = t('cameraPpe.syncChecking');
      break;
    case 'worker-unavailable':
      workerText = t('cameraPpe.syncUnavailable');
      break;
    case 'no-worker-status':
      workerText = t('cameraPpe.syncNoContext');
      break;
  }

  return (
    <div
      data-testid="camera-ppe-sync-status"
      data-sync-state={state.kind}
      className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5 space-y-1.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800">{t('cameraPpe.syncHeading')}</span>
        <span className="text-xs font-mono text-slate-700 tabular-nums">{savedLabel}</span>
      </div>
      <p
        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium break-words [overflow-wrap:anywhere] ${workerTone}`}
      >
        {workerText}
      </p>
    </div>
  );
}

export function CameraDefaultSummaryCard({
  cameraSaved,
  cameraPolicy,
  canEdit,
  isEditingCamera,
  onSelectCameraDefault,
}: {
  cameraSaved: SavedPpePolicy;
  cameraPolicy: CameraPpePolicy | null;
  canEdit: boolean;
  isEditingCamera: boolean;
  onSelectCameraDefault: () => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

  return (
    <div
      data-testid="camera-ppe-default-summary"
      className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">
            {t('cameraPpe.cameraSummaryHeading')}
          </h4>
          {cameraPolicy ? (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${MODE_BADGE_CLASSES[cameraPolicy.mode]}`}
            >
              {t(modeBadgeCopyKey(cameraPolicy.mode))}
            </span>
          ) : (
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${MODE_BADGE_CLASSES.UNCONFIGURED}`}
            >
              {t('cameraPpe.modeBadge.UNCONFIGURED')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {cameraSaved.savedRevision !== null
              ? t('cameraPpe.savedConfigMeta', {
                  configVersion: cameraSaved.configurationVersion,
                  revision: cameraSaved.savedRevision,
                })
              : t('cameraPpe.savedConfigOnlyMeta', {
                  configVersion: cameraSaved.configurationVersion,
                })}
          </span>
          {canEdit && !isEditingCamera && cameraPolicy !== null && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.compactSecondary}
              onClick={onSelectCameraDefault}
            >
              {t('cameraPpe.editCameraDefault')}
            </button>
          )}
        </div>
      </div>

      {!cameraPolicy ? (
        <p className="text-xs text-amber-900">{t('cameraPpe.cameraUninitializedNote')}</p>
      ) : cameraPolicy.mode === 'DISABLED' ? (
        <div className="text-xs text-slate-700 space-y-0.5">
          <p className="font-medium text-rose-800">{t('cameraPpe.effectiveDisabled')}</p>
          {cameraPolicy.reason && (
            <p className="text-slate-600 break-words [overflow-wrap:anywhere]">
              {t('cameraPpe.effectiveReason', { reason: cameraPolicy.reason })}
            </p>
          )}
        </div>
      ) : (
        <PpeItemBadges items={cameraPolicy.requiredPpe} />
      )}
    </div>
  );
}

function formatRegionAppliedLabel(
  saved: SavedPpePolicy | undefined,
  savedVsApplied: SavedVsAppliedState,
  isActive: boolean,
): { key: CameraPpeCopyKey; version?: number; tone: string } {
  if (!saved || saved.policy === null || saved.savedRevision === null) {
    return {
      key: 'cameraPpe.regionSyncUnconfigured',
      tone: 'text-slate-500',
    };
  }
  if (!isActive) {
    return {
      key: 'cameraPpe.regionSyncInactive',
      version: saved.configurationVersion,
      tone: 'text-slate-600',
    };
  }
  if (
    savedVsApplied.kind === 'applied' &&
    savedVsApplied.reportedRevision === saved.configurationVersion
  ) {
    return {
      key: 'cameraPpe.regionSyncApplied',
      version: saved.configurationVersion,
      tone: 'text-emerald-800 font-medium',
    };
  }
  if (
    savedVsApplied.kind === 'no-worker-status' ||
    savedVsApplied.kind === 'worker-unavailable' ||
    savedVsApplied.kind === 'checking'
  ) {
    return {
      key: 'cameraPpe.regionSyncUnavailable',
      version: saved.configurationVersion,
      tone: 'text-slate-600',
    };
  }
  return {
    key: 'cameraPpe.regionSyncNotApplied',
    version: saved.configurationVersion,
    tone: 'text-amber-900 font-medium',
  };
}

function buildZoneNameCounts(items: readonly RegionPolicyItemView[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of items) {
    if (!entry.zone) continue;
    const key = entry.zone.name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function RegionEffectivePolicyList({
  items,
  savedVsApplied,
  canEdit,
  onSelectRegion,
  onRetryRegion,
}: {
  items: readonly RegionPolicyItemView[];
  savedVsApplied: SavedVsAppliedState;
  canEdit: boolean;
  onSelectRegion: (regionId: string) => void;
  onRetryRegion: (regionId: string) => void;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const zoneNameCounts = buildZoneNameCounts(items);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-900 tabular-nums">
        {t('cameraPpe.regionsHeading', { count: items.length })}
      </h4>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3.5 py-3 text-xs text-slate-600">
          {t('cameraPpe.regionsEmpty')}
        </p>
      ) : (
        <ul
          className="space-y-2.5"
          aria-label={t('cameraPpe.regionsHeading', { count: items.length })}
        >
          {items.map(
            ({ region, regionIndex, sameZoneCount, zone, saved, effective, isSelected }) => {
              const regionBadge = t('cameraPpe.regionNumberBadge', { index: regionIndex });
              const needsRegionDisambiguator =
                sameZoneCount > 1 ||
                (zone ? (zoneNameCounts.get(zone.name.trim().toLowerCase()) ?? 0) > 1 : false);
              const targetLabel = zone
                ? needsRegionDisambiguator
                  ? `${zone.name} (${regionBadge})`
                  : zone.name
                : t('cameraPpe.regionUnresolvedLabel', { index: regionIndex });
              const modeKey =
                effective.kind === 'resolved' || effective.kind === 'camera-unconfigured'
                  ? effective.mode
                  : 'UNCONFIGURED';
              const regionSync = formatRegionAppliedLabel(saved, savedVsApplied, region.isActive);

              return (
                <li
                  key={region.id}
                  data-testid={`camera-ppe-region-card-${region.id}`}
                  data-policy-mode={modeKey}
                  className={`rounded-xl border px-3.5 py-3 space-y-2 transition-colors ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50/80 ring-1 ring-slate-900/10'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          title={targetLabel}
                          className="text-sm font-semibold text-slate-900 break-words [overflow-wrap:anywhere]"
                        >
                          {targetLabel}
                        </span>
                        {!zone && (
                          <span className="rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                            {t('cameraPpe.zoneMetadataUnavailable')}
                          </span>
                        )}
                        <span
                          className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${MODE_BADGE_CLASSES[modeKey]}`}
                        >
                          {t(modeBadgeCopyKey(modeKey))}
                        </span>
                        <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs tabular-nums text-slate-600">
                          {zone && !needsRegionDisambiguator ? `${regionBadge} · ` : ''}
                          {t('cameraPpe.regionVersionMeta', { version: region.version })} ·{' '}
                          {t(
                            region.isActive ? 'cameraPpe.regionActive' : 'cameraPpe.regionInactive',
                          )}
                        </span>
                      </div>
                      <details
                        data-testid={`camera-ppe-region-tech-${region.id}`}
                        className="text-xs text-slate-500"
                      >
                        <summary className="inline-flex min-h-7 cursor-pointer select-none items-center font-medium text-slate-600 hover:text-slate-900">
                          {t('cameraPpe.technicalIdsSummary')}
                        </summary>
                        <div className="mt-1 space-y-0.5 font-mono text-xs text-slate-600 break-all">
                          {zone && <p>{t('cameraPpe.technicalZoneCode', { code: zone.code })}</p>}
                          <p>{t('cameraPpe.technicalRegionId', { id: region.id })}</p>
                          <p>{t('cameraPpe.technicalZoneId', { id: region.zoneId })}</p>
                        </div>
                      </details>
                    </div>

                    {canEdit && (
                      <button
                        type="button"
                        aria-label={t('cameraPpe.editRegionAria', { target: targetLabel })}
                        className={CAMERA_BUTTON_STYLES.compactSecondary}
                        onClick={() => onSelectRegion(region.id)}
                      >
                        {t('cameraPpe.editRegion')}
                      </button>
                    )}
                  </div>

                  <EffectivePpeDetails
                    effective={effective}
                    onRetry={() => onRetryRegion(region.id)}
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-xs">
                    {effective.kind !== 'loading' && effective.kind !== 'error' && (
                      <span className="font-mono text-slate-500 tabular-nums">
                        {saved?.savedRevision != null
                          ? t('cameraPpe.savedConfigMeta', {
                              configVersion: saved.configurationVersion,
                              revision: saved.savedRevision,
                            })
                          : saved
                            ? t('cameraPpe.savedConfigOnlyMeta', {
                                configVersion: saved.configurationVersion,
                              })
                            : t('cameraPpe.absent')}
                      </span>
                    )}
                    <span className={`${regionSync.tone} tabular-nums`}>
                      {regionSync.version !== undefined
                        ? t(regionSync.key, { version: regionSync.version })
                        : t(regionSync.key)}
                    </span>
                  </div>
                </li>
              );
            },
          )}
        </ul>
      )}
    </div>
  );
}

export function EffectivePpePreviewBox({
  effective,
}: {
  effective: Extract<RegionEffectivePolicyState, { kind: 'resolved' }> | null;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  return (
    <div
      data-testid="camera-ppe-draft-preview"
      className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 space-y-1"
    >
      <p className="text-xs font-semibold text-slate-700">{t('cameraPpe.previewHeading')}</p>
      {effective ? (
        <EffectivePpeDetails effective={effective} />
      ) : (
        <p className="text-xs text-slate-600">{t('cameraPpe.previewRequiresCameraInit')}</p>
      )}
    </div>
  );
}

export function CameraDefaultImpactCard({
  items,
  draftCameraPolicy,
}: {
  items: readonly RegionPolicyItemView[];
  draftCameraPolicy: CameraPpePolicy | null;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const zoneNameCounts = buildZoneNameCounts(items);
  const activeItems = items.filter((entry) => entry.region.isActive);
  const formatName = ({ regionIndex, sameZoneCount, zone }: RegionPolicyItemView): string => {
    if (!zone) {
      return t('cameraPpe.regionUnresolvedLabel', { index: regionIndex });
    }
    const needsRegionDisambiguator =
      sameZoneCount > 1 || (zoneNameCounts.get(zone.name.trim().toLowerCase()) ?? 0) > 1;
    return needsRegionDisambiguator
      ? `${zone.name} (${t('cameraPpe.regionNumberBadge', { index: regionIndex })})`
      : zone.name;
  };

  const inheritingNames = activeItems
    .filter(
      (entry) =>
        (entry.effective.kind === 'resolved' || entry.effective.kind === 'camera-unconfigured') &&
        entry.effective.mode === 'INHERIT',
    )
    .map(formatName);
  const unaffectedNames = activeItems
    .filter(
      (entry) =>
        (entry.effective.kind === 'resolved' || entry.effective.kind === 'camera-unconfigured') &&
        entry.effective.mode !== 'INHERIT',
    )
    .map(formatName);

  return (
    <div
      data-testid="camera-ppe-affected-regions-preview"
      className="rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 space-y-1.5 text-xs text-slate-700"
    >
      <p className="text-xs font-semibold text-slate-800">{t('cameraPpe.impactHeading')}</p>
      <p className="break-words [overflow-wrap:anywhere]">
        {inheritingNames.length > 0
          ? t('cameraPpe.impactInheriting', {
              count: inheritingNames.length,
              names: inheritingNames.join(', '),
            })
          : t('cameraPpe.impactNoneInheriting')}
      </p>
      {unaffectedNames.length > 0 && (
        <p className="text-slate-600 break-words [overflow-wrap:anywhere]">
          {t('cameraPpe.impactUnaffected', {
            count: unaffectedNames.length,
            names: unaffectedNames.join(', '),
          })}
        </p>
      )}
      {draftCameraPolicy && (
        <div className="space-y-1 border-t border-slate-200/70 pt-1.5">
          <p className="text-xs font-medium text-slate-600">
            {t('cameraPpe.impactPreviewEffective')}
          </p>
          {draftCameraPolicy.mode === 'DISABLED' ? (
            <div className="space-y-0.5">
              <p className="font-medium text-rose-800">{t('cameraPpe.effectiveDisabled')}</p>
              {draftCameraPolicy.reason && (
                <p className="text-slate-600 break-words [overflow-wrap:anywhere]">
                  {t('cameraPpe.effectiveReason', { reason: draftCameraPolicy.reason })}
                </p>
              )}
            </div>
          ) : (
            <PpeItemBadges items={draftCameraPolicy.requiredPpe} />
          )}
        </div>
      )}
    </div>
  );
}
