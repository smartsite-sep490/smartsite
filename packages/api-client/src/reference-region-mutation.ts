import type { UpdateReferenceRegionPolygonCommand } from '@smartsite/contracts/camera-region-reference';
import {
  parseRegionGeometryConfirmation,
  type ReferenceRegionMutationResponse,
} from '@smartsite/contracts/camera-region-geometry-confirmation';
import { ApiError } from './errors';
export function parseReferenceRegionMutation(
  payload: unknown,
  command: UpdateReferenceRegionPolygonCommand,
  expectedScope: {
    cameraId: string;
    zoneId?: string;
    regionId?: string;
  },
): ReferenceRegionMutationResponse {
  const isUuid = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  const isPositiveSafeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

  try {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      typeof (payload as { region?: unknown }).region !== 'object' ||
      (payload as { region?: unknown }).region === null ||
      Array.isArray((payload as { region?: unknown }).region)
    ) {
      throw new Error('Invalid reference region mutation response');
    }
    const mutation = payload as ReferenceRegionMutationResponse;
    const { region, configurationVersion } = mutation;
    const expectedConfigurationVersion = command.expectedConfigurationVersion + 1;
    if (
      !isPositiveSafeInteger(configurationVersion) ||
      !isPositiveSafeInteger(expectedConfigurationVersion) ||
      configurationVersion !== expectedConfigurationVersion
    ) {
      throw new Error('Invalid reference region mutation configurationVersion');
    }
    if (
      !isUuid(region.id) ||
      !isUuid(region.cameraId) ||
      !isUuid(region.zoneId) ||
      !isUuid(expectedScope.cameraId) ||
      region.cameraId.toLowerCase() !== expectedScope.cameraId.toLowerCase()
    ) {
      throw new Error('Invalid reference region mutation scope');
    }
    if (
      expectedScope.zoneId !== undefined &&
      (!isUuid(expectedScope.zoneId) ||
        region.zoneId.toLowerCase() !== expectedScope.zoneId.toLowerCase())
    ) {
      throw new Error('Invalid reference region create zoneId binding');
    }
    if (
      expectedScope.regionId !== undefined &&
      (!isUuid(expectedScope.regionId) ||
        region.id.toLowerCase() !== expectedScope.regionId.toLowerCase())
    ) {
      throw new Error('Invalid reference region update regionId binding');
    }

    const geometryConfirmation = parseRegionGeometryConfirmation(region.geometryConfirmation);
    if (
      geometryConfirmation.status !== 'MANUALLY_CONFIRMED' ||
      geometryConfirmation.referenceId !== command.referenceId ||
      geometryConfirmation.viewRevision !== command.viewRevision
    ) {
      throw new Error('Invalid reference region confirmation provenance');
    }
    return {
      ...mutation,
      region: {
        ...region,
        geometryConfirmation,
      },
    };
  } catch {
    throw new ApiError(
      'invalid-response',
      'Backend returned an invalid reference region mutation response.',
    );
  }
}
