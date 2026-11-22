import type { RegionResponse, ZoneResponse } from '@smartsite/contracts/management';
import type { CameraApplicationStatusResult } from '../cameras/useCameraApplicationStatus';
import type { ZoneMonitorKey } from './zone-monitor-catalog';

export type ZonePolicyKind = 'PROHIBITED' | 'AUTHORIZATION_REQUIRED' | 'NONE' | 'UNAVAILABLE';

export interface ZoneRegionPresentation {
  readonly region: RegionResponse;
  readonly zone: ZoneResponse | undefined;
  readonly zoneName: string | null;
  readonly policyKind: ZonePolicyKind;
  readonly policyLabelKey: ZoneMonitorKey;
  readonly ordinalInZone: number;
}

export type ZoneMonitorWorkerState =
  'LOADED' | 'PENDING' | 'UNCONFIRMED' | 'STALE' | 'REJECTED' | 'CHECKING' | 'UNAVAILABLE';

export interface ZoneWorkerOperationalStatus {
  readonly state: ZoneMonitorWorkerState;
  readonly labelKey: ZoneMonitorKey;
  readonly reportedRevision: number | null;
  readonly tone: 'emerald' | 'amber' | 'rose' | 'slate';
}

const POLICY_LABEL_KEYS: Record<ZonePolicyKind, ZoneMonitorKey> = {
  PROHIBITED: 'zoneMonitor.region.policyProhibited',
  AUTHORIZATION_REQUIRED: 'zoneMonitor.region.policyAuthorizationRequired',
  NONE: 'zoneMonitor.region.policyNone',
  UNAVAILABLE: 'zoneMonitor.region.policyUnavailable',
};

/**
 * Classifies zone access policy strictly from authoritative `zone.restrictionPolicy`.
 * Never lets legacy `zone.type` override `restrictionPolicy: 'NONE'`, never implies active
 * camera PPE enforcement from `zone.requiredPpe`, and never infers policy/names from IDs.
 */
export function classifyZonePolicy(zone: ZoneResponse | undefined): ZonePolicyKind {
  if (!zone) return 'UNAVAILABLE';
  if (zone.restrictionPolicy === 'PROHIBITED_FOR_ALL') return 'PROHIBITED';
  if (zone.restrictionPolicy === 'AUTHORIZATION_REQUIRED') return 'AUTHORIZATION_REQUIRED';
  if (zone.restrictionPolicy === 'NONE') return 'NONE';
  return 'UNAVAILABLE';
}

export function buildZoneLookupMap(
  zones: readonly ZoneResponse[] | undefined,
): Map<string, ZoneResponse> {
  const map = new Map<string, ZoneResponse>();
  if (!zones) return map;
  for (const zone of zones) {
    map.set(zone.id.toLowerCase(), zone);
  }
  return map;
}

export function buildRegionPresentationList(
  regions: readonly RegionResponse[],
  zonesById: ReadonlyMap<string, ZoneResponse>,
): ZoneRegionPresentation[] {
  const countsByZoneKey = new Map<string, number>();
  let unresolvedOrdinal = 0;

  return regions.map((region) => {
    const normalizedZoneId = region.zoneId.toLowerCase();
    const zone = zonesById.get(normalizedZoneId);
    const trimmedName = zone?.name?.trim() ?? '';
    const zoneName = trimmedName.length > 0 ? trimmedName : null;
    const policyKind = classifyZonePolicy(zone);

    let ordinalInZone: number;
    if (zone) {
      ordinalInZone = (countsByZoneKey.get(normalizedZoneId) ?? 0) + 1;
      countsByZoneKey.set(normalizedZoneId, ordinalInZone);
    } else {
      unresolvedOrdinal += 1;
      ordinalInZone = unresolvedOrdinal;
    }

    return {
      region,
      zone,
      zoneName,
      policyKind,
      policyLabelKey: POLICY_LABEL_KEYS[policyKind],
      ordinalInZone,
    };
  });
}

export function resolveZoneWorkerOperationalStatus(
  appStatus: Pick<
    CameraApplicationStatusResult,
    'canQuery' | 'effectiveState' | 'verifiedPayload' | 'query'
  >,
  aiPaused: boolean,
): ZoneWorkerOperationalStatus {
  if (!appStatus.canQuery) {
    return {
      state: 'UNAVAILABLE',
      labelKey: 'zoneMonitor.status.workerUnavailable',
      reportedRevision: null,
      tone: 'slate',
    };
  }

  if (appStatus.verifiedPayload && appStatus.effectiveState) {
    const reportedRevision = appStatus.verifiedPayload.status.reportedRevision;
    switch (appStatus.effectiveState) {
      case 'LOADED':
        // Never present green "applied/live" when AI work is explicitly paused.
        if (aiPaused) {
          return {
            state: 'UNCONFIRMED',
            labelKey: 'zoneMonitor.status.workerUnconfirmed',
            reportedRevision,
            tone: 'amber',
          };
        }
        return {
          state: 'LOADED',
          labelKey: 'zoneMonitor.status.workerLoaded',
          reportedRevision,
          tone: 'emerald',
        };
      case 'PENDING':
        return {
          state: 'PENDING',
          labelKey: 'zoneMonitor.status.workerPending',
          reportedRevision,
          tone: 'amber',
        };
      case 'UNCONFIRMED':
        return {
          state: 'UNCONFIRMED',
          labelKey: 'zoneMonitor.status.workerUnconfirmed',
          reportedRevision,
          tone: 'amber',
        };
      case 'STALE':
        return {
          state: 'STALE',
          labelKey: 'zoneMonitor.status.workerStale',
          reportedRevision,
          tone: 'rose',
        };
      case 'REJECTED':
        return {
          state: 'REJECTED',
          labelKey: 'zoneMonitor.status.workerRejected',
          reportedRevision,
          tone: 'rose',
        };
    }
  }

  if (appStatus.query.isFetching || appStatus.query.isPending) {
    return {
      state: 'CHECKING',
      labelKey: 'zoneMonitor.status.workerChecking',
      reportedRevision: null,
      tone: 'slate',
    };
  }

  return {
    state: 'UNAVAILABLE',
    labelKey: 'zoneMonitor.status.workerUnavailable',
    reportedRevision: null,
    tone: 'slate',
  };
}
