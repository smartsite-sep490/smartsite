import { describe, expect, it, vi } from 'vitest';
import type { SavedPpePolicy } from '@smartsite/api-client';
import type { CameraApplicationStatus } from '@smartsite/contracts/camera-application-status';
import type { CameraPpePolicy } from '@smartsite/contracts/camera-ppe-policy';
import type { CameraApplicationStatusResult } from './useCameraApplicationStatus';
import {
  resolveDraftEffectivePreview,
  resolveRegionEffectivePolicy,
  resolveSavedVsAppliedState,
} from './camera-ppe-policy-model';

const CAMERA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REGION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const EXPLICIT_CAMERA: CameraPpePolicy = {
  mode: 'EXPLICIT',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
};

const DISABLED_CAMERA: CameraPpePolicy = {
  mode: 'DISABLED',
  reason: 'Camera offline for maintenance',
};

function makeSavedRegion(
  policy: SavedPpePolicy['policy'],
  overrides: Partial<SavedPpePolicy> = {},
): SavedPpePolicy {
  return {
    cameraId: CAMERA_ID,
    regionId: REGION_ID,
    configurationVersion: 4,
    savedRevision: policy ? 2 : null,
    policy,
    ...overrides,
  };
}

function makeStatusResult(
  overrides: Partial<CameraApplicationStatusResult> = {},
): CameraApplicationStatusResult {
  return {
    query: {
      isFetching: false,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    },
    canQuery: true,
    errorStatus: undefined,
    verifiedPayload: undefined,
    effectiveState: undefined,
    effectiveReasonCode: null,
    ...overrides,
  };
}

function makeVerifiedPayload(
  statusOverrides: Partial<CameraApplicationStatus> = {},
): NonNullable<CameraApplicationStatusResult['verifiedPayload']> {
  const now = new Date().toISOString();
  return {
    fetchedAtMonotonicMs: 1000,
    status: {
      siteId: '11111111-1111-4111-8111-111111111111',
      cameraId: CAMERA_ID,
      desiredRevision: 4,
      reportedRevision: 4,
      applicationState: 'LOADED',
      viewValidity: 'UNCONFIRMED',
      reasonCode: null,
      lastReceiptAt: now,
      observedAt: now,
      ...statusOverrides,
    },
  };
}

describe('resolveRegionEffectivePolicy', () => {
  it('resolves INHERIT regions strictly from camera default and tags source as CAMERA_DEFAULT', () => {
    const result = resolveRegionEffectivePolicy({
      cameraPolicy: EXPLICIT_CAMERA,
      regionSaved: makeSavedRegion({ mode: 'INHERIT' }),
      isLoading: false,
      isError: false,
    });
    expect(result).toEqual({
      kind: 'resolved',
      mode: 'INHERIT',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
      source: 'CAMERA_DEFAULT',
      disabled: false,
      disabledByCameraDefault: false,
      reason: undefined,
    });
  });

  it('marks INHERIT as disabledByCameraDefault when camera default is DISABLED', () => {
    const result = resolveRegionEffectivePolicy({
      cameraPolicy: DISABLED_CAMERA,
      regionSaved: makeSavedRegion({ mode: 'INHERIT' }),
      isLoading: false,
      isError: false,
    });
    expect(result).toEqual({
      kind: 'resolved',
      mode: 'INHERIT',
      requiredPpe: [],
      source: 'CAMERA_DEFAULT',
      disabled: true,
      disabledByCameraDefault: true,
      reason: 'Camera offline for maintenance',
    });
  });

  it('resolves EXPLICIT and DISABLED region overrides independently from camera default', () => {
    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: EXPLICIT_CAMERA,
        regionSaved: makeSavedRegion({ mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'GOGGLES'] }),
        isLoading: false,
        isError: false,
      }),
    ).toEqual({
      kind: 'resolved',
      mode: 'EXPLICIT',
      requiredPpe: ['GLOVES', 'GOGGLES'],
      source: 'REGION',
      disabled: false,
      disabledByCameraDefault: false,
      reason: undefined,
    });

    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: EXPLICIT_CAMERA,
        regionSaved: makeSavedRegion({ mode: 'DISABLED', reason: 'Walkway closed' }),
        isLoading: false,
        isError: false,
      }),
    ).toEqual({
      kind: 'resolved',
      mode: 'DISABLED',
      requiredPpe: [],
      source: 'REGION',
      disabled: true,
      disabledByCameraDefault: false,
      reason: 'Walkway closed',
    });
  });

  it('never infers PPE when region policy or camera policy is missing, loading, or errored', () => {
    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: EXPLICIT_CAMERA,
        regionSaved: makeSavedRegion(null),
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: 'unconfigured' });

    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: null,
        regionSaved: makeSavedRegion({ mode: 'INHERIT' }),
        isLoading: false,
        isError: false,
      }),
    ).toEqual({ kind: 'camera-unconfigured', mode: 'INHERIT', reason: undefined });

    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: EXPLICIT_CAMERA,
        regionSaved: undefined,
        isLoading: true,
        isError: false,
      }),
    ).toEqual({ kind: 'loading' });

    expect(
      resolveRegionEffectivePolicy({
        cameraPolicy: EXPLICIT_CAMERA,
        regionSaved: undefined,
        isLoading: false,
        isError: true,
      }),
    ).toEqual({ kind: 'error' });

    expect(resolveDraftEffectivePreview(null, { mode: 'INHERIT' })).toBeNull();
  });
});

describe('resolveSavedVsAppliedState', () => {
  const statusContext = {
    setupKey: ['setup'],
    token: 't',
    siteId: '11111111-1111-4111-8111-111111111111',
    client: {},
    enabled: true,
    onUnauthorized: vi.fn(),
  };

  it('returns applied ONLY when effectiveState is LOADED and reportedRevision matches savedConfigurationVersion', () => {
    const state = resolveSavedVsAppliedState({
      savedConfigurationVersion: 4,
      statusContext,
      statusResult: makeStatusResult({
        effectiveState: 'LOADED',
        verifiedPayload: makeVerifiedPayload({
          desiredRevision: 4,
          reportedRevision: 4,
          applicationState: 'LOADED',
        }),
      }),
    });
    expect(state).toEqual({
      kind: 'applied',
      savedConfigurationVersion: 4,
      reportedRevision: 4,
      viewValidity: 'UNCONFIRMED',
    });
  });

  it('never reports applied when revisions differ, status is stale/pending/unconfirmed/rejected, or context is missing', () => {
    expect(
      resolveSavedVsAppliedState({
        savedConfigurationVersion: 4,
        statusContext: undefined,
        statusResult: makeStatusResult({ canQuery: false }),
      }).kind,
    ).toBe('no-worker-status');

    expect(
      resolveSavedVsAppliedState({
        savedConfigurationVersion: 4,
        statusContext,
        statusResult: makeStatusResult({
          effectiveState: 'LOADED',
          verifiedPayload: makeVerifiedPayload({
            desiredRevision: 4,
            reportedRevision: 3,
            applicationState: 'LOADED',
          }),
        }),
      }).kind,
    ).toBe('not-yet-applied');

    expect(
      resolveSavedVsAppliedState({
        savedConfigurationVersion: 4,
        statusContext,
        statusResult: makeStatusResult({
          effectiveState: 'STALE',
          verifiedPayload: makeVerifiedPayload({
            desiredRevision: 4,
            reportedRevision: 4,
            applicationState: 'LOADED',
          }),
        }),
      }).kind,
    ).toBe('stale');

    expect(
      resolveSavedVsAppliedState({
        savedConfigurationVersion: 4,
        statusContext,
        statusResult: makeStatusResult({
          effectiveState: 'UNCONFIRMED',
          verifiedPayload: makeVerifiedPayload({
            desiredRevision: 4,
            reportedRevision: null,
            applicationState: 'UNCONFIRMED',
          }),
        }),
      }).kind,
    ).toBe('unconfirmed');

    expect(
      resolveSavedVsAppliedState({
        savedConfigurationVersion: 4,
        statusContext,
        statusResult: makeStatusResult({
          effectiveState: 'REJECTED',
          effectiveReasonCode: 'INVALID_POLICY',
          verifiedPayload: makeVerifiedPayload({
            desiredRevision: 4,
            reportedRevision: 3,
            applicationState: 'REJECTED',
            reasonCode: 'INVALID_POLICY',
          }),
        }),
      }).kind,
    ).toBe('rejected');
  });
});
