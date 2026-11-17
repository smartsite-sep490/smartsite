import type { SavedPpePolicy } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import {
  parseCameraPpePolicy,
  parseRegionPpePolicy,
  resolvePpePolicyAtLocation,
  type CameraPpePolicy,
  type RegionPpePolicy,
} from '@smartsite/contracts/camera-ppe-policy';
import type { PpeItem } from '@smartsite/contracts/ppe-items';
import type { CameraPpeCopyKey } from './camera-ppe-policy-copy';
import type {
  CameraApplicationStatusContext,
  CameraApplicationStatusResult,
} from './useCameraApplicationStatus';

export type PpePolicyDraft = {
  mode: string;
  requiredPpe?: PpeItem[];
  reason?: string;
};

export function parsePolicyDraft(draft: PpePolicyDraft): RegionPpePolicy | null {
  if (draft.mode === 'EXPLICIT') {
    return parseRegionPpePolicy({ mode: draft.mode, requiredPpe: draft.requiredPpe });
  }
  if (draft.mode === 'DISABLED') {
    return parseRegionPpePolicy({ mode: draft.mode, reason: draft.reason });
  }
  return parseRegionPpePolicy({ mode: draft.mode });
}

export type RegionEffectivePolicyState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unconfigured' }
  | {
      kind: 'camera-unconfigured';
      mode: RegionPpePolicy['mode'];
      reason?: string;
    }
  | {
      kind: 'resolved';
      mode: RegionPpePolicy['mode'];
      requiredPpe: readonly PpeItem[];
      source: 'CAMERA_DEFAULT' | 'REGION';
      disabled: boolean;
      disabledByCameraDefault: boolean;
      reason?: string;
    };

function resolveParsedRegionWithCamera(
  cameraPolicy: CameraPpePolicy,
  parsedRegion: RegionPpePolicy,
): Extract<RegionEffectivePolicyState, { kind: 'resolved' }> {
  const resolved = resolvePpePolicyAtLocation(cameraPolicy, [parsedRegion]);
  const contribution = resolved.contributions[0];
  const source =
    contribution?.source ?? (parsedRegion.mode === 'INHERIT' ? 'CAMERA_DEFAULT' : 'REGION');
  const disabledByRegion = parsedRegion.mode === 'DISABLED';
  const disabledByCameraDefault =
    parsedRegion.mode === 'INHERIT' && cameraPolicy.mode === 'DISABLED';
  return {
    kind: 'resolved',
    mode: parsedRegion.mode,
    requiredPpe: resolved.requiredPpe,
    source,
    disabled: disabledByRegion || disabledByCameraDefault,
    disabledByCameraDefault,
    reason: disabledByRegion
      ? parsedRegion.reason
      : disabledByCameraDefault
        ? cameraPolicy.reason
        : undefined,
  };
}

/**
 * Resolves a region's effective PPE strictly from saved backend v2 policies via
 * the shared contract resolver. Never infers PPE from Zone defaults or absent state.
 */
export function resolveRegionEffectivePolicy({
  cameraPolicy,
  regionSaved,
  isLoading,
  isError,
}: {
  cameraPolicy: CameraPpePolicy | null;
  regionSaved: SavedPpePolicy | undefined;
  isLoading: boolean;
  isError: boolean;
}): RegionEffectivePolicyState {
  if (isLoading) return { kind: 'loading' };
  if (isError) return { kind: 'error' };
  if (!regionSaved || regionSaved.policy === null) return { kind: 'unconfigured' };
  const parsedRegion = parseRegionPpePolicy(regionSaved.policy);
  if (!parsedRegion) return { kind: 'unconfigured' };
  if (!cameraPolicy) {
    return {
      kind: 'camera-unconfigured',
      mode: parsedRegion.mode,
      reason: parsedRegion.mode === 'DISABLED' ? parsedRegion.reason : undefined,
    };
  }
  return resolveParsedRegionWithCamera(cameraPolicy, parsedRegion);
}

export function resolveDraftEffectivePreview(
  cameraPolicy: CameraPpePolicy | null,
  draftPolicy: RegionPpePolicy | null,
): Extract<RegionEffectivePolicyState, { kind: 'resolved' }> | null {
  if (!cameraPolicy || !draftPolicy) return null;
  return resolveParsedRegionWithCamera(cameraPolicy, draftPolicy);
}

export function parseSavedCameraPolicy(
  cameraSaved: SavedPpePolicy | undefined,
): CameraPpePolicy | null {
  return parseCameraPpePolicy(cameraSaved?.policy);
}

export type SavedVsAppliedState =
  | { kind: 'no-worker-status'; savedConfigurationVersion: number | undefined }
  | { kind: 'checking'; savedConfigurationVersion: number | undefined }
  | {
      kind: 'worker-unavailable';
      savedConfigurationVersion: number | undefined;
      isForbidden: boolean;
    }
  | {
      kind: 'applied';
      savedConfigurationVersion: number;
      reportedRevision: number;
      viewValidity: CameraApplicationStatus['viewValidity'];
    }
  | {
      kind: 'not-yet-applied';
      savedConfigurationVersion: number | undefined;
      reportedRevision: number | null;
    }
  | {
      kind: 'unconfirmed';
      savedConfigurationVersion: number | undefined;
      reportedRevision: number | null;
    }
  | {
      kind: 'stale';
      savedConfigurationVersion: number | undefined;
      reportedRevision: number | null;
    }
  | {
      kind: 'rejected';
      savedConfigurationVersion: number | undefined;
      reportedRevision: number | null;
      reasonCode: string | null;
    };

/**
 * Compares saved configuration version against live worker application ACK state.
 * Never reports 'applied' without a fresh 'LOADED' ACK matching the saved revision.
 */
export function resolveSavedVsAppliedState({
  savedConfigurationVersion,
  statusContext,
  statusResult,
}: {
  savedConfigurationVersion: number | undefined;
  statusContext?: CameraApplicationStatusContext;
  statusResult: CameraApplicationStatusResult;
}): SavedVsAppliedState {
  if (!statusContext?.enabled || !statusResult.canQuery) {
    return { kind: 'no-worker-status', savedConfigurationVersion };
  }
  if (statusResult.query.isFetching || statusResult.query.isPending) {
    return { kind: 'checking', savedConfigurationVersion };
  }
  if (statusResult.query.isError || !statusResult.verifiedPayload || !statusResult.effectiveState) {
    return {
      kind: 'worker-unavailable',
      savedConfigurationVersion,
      isForbidden: statusResult.errorStatus === 403 || statusResult.errorStatus === 404,
    };
  }
  const raw = statusResult.verifiedPayload.status;
  const state = statusResult.effectiveState;
  if (
    state === 'LOADED' &&
    raw.reportedRevision !== null &&
    savedConfigurationVersion !== undefined &&
    raw.desiredRevision === savedConfigurationVersion &&
    raw.reportedRevision === savedConfigurationVersion
  ) {
    return {
      kind: 'applied',
      savedConfigurationVersion,
      reportedRevision: raw.reportedRevision,
      viewValidity: raw.viewValidity,
    };
  }
  if (state === 'REJECTED') {
    return {
      kind: 'rejected',
      savedConfigurationVersion,
      reportedRevision: raw.reportedRevision,
      reasonCode: statusResult.effectiveReasonCode ?? raw.reasonCode,
    };
  }
  if (state === 'STALE') {
    return {
      kind: 'stale',
      savedConfigurationVersion,
      reportedRevision: raw.reportedRevision,
    };
  }
  if (state === 'UNCONFIRMED') {
    return {
      kind: 'unconfirmed',
      savedConfigurationVersion,
      reportedRevision: raw.reportedRevision,
    };
  }
  return {
    kind: 'not-yet-applied',
    savedConfigurationVersion,
    reportedRevision: raw.reportedRevision,
  };
}

export function resolvePpeMutationErrorKey(error: unknown): CameraPpeCopyKey {
  const status =
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status === 400 || status === 422) return 'cameraPpe.failed400';
  if (status === 403) return 'cameraPpe.failed403';
  if (status === 404) return 'cameraPpe.failed404';
  if (status === 409) return 'cameraPpe.failed409';
  if (status === 429) return 'cameraPpe.failed429';
  return 'cameraPpe.failed';
}
