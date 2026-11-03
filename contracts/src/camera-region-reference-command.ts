import type { NormalizedCoordinate } from './camera-region-configuration.js';
import { polygonError } from './validation/polygon-validator.js';

/** Shape only: Backend must validate issuance, current revision/view, expiry and actor scope. */
export interface UpdateReferenceRegionPolygonCommand {
  readonly expectedConfigurationVersion: number;
  readonly referenceId: string;
  readonly viewRevision: number;
  readonly confirmReferenceView: true;
  readonly polygon: { readonly coordinates: readonly NormalizedCoordinate[] };
}

export interface CreateReferenceRegionCommand extends UpdateReferenceRegionPolygonCommand {
  readonly zoneId: string;
}

const keys = [
  'expectedConfigurationVersion',
  'referenceId',
  'viewRevision',
  'confirmReferenceView',
  'polygon',
];
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid reference-bound region command');
}

function polygon(value: unknown): UpdateReferenceRegionPolygonCommand['polygon'] {
  check(
    object(value) && Reflect.ownKeys(value).length === 1 && Object.hasOwn(value, 'coordinates'),
  );
  const points = value.coordinates;
  check(Array.isArray(points) && points.length >= 3 && points.length <= 64);
  const coordinates: NormalizedCoordinate[] = points.map((point) => {
    check(
      Array.isArray(point) &&
        point.length === 2 &&
        [point[0], point[1]].every(
          (coordinate) =>
            typeof coordinate === 'number' &&
            Number.isFinite(coordinate) &&
            coordinate >= 0 &&
            coordinate <= 1,
        ),
    );
    return [point[0], point[1]];
  });
  check(polygonError(coordinates) === undefined);
  return { coordinates };
}

function parse(value: unknown, create: boolean): UpdateReferenceRegionPolygonCommand {
  check(object(value));
  const expectedKeys = create ? [...keys, 'zoneId'] : keys;
  check(
    Reflect.ownKeys(value).length === expectedKeys.length &&
      expectedKeys.every((key) => Object.hasOwn(value, key)),
  );
  check(version(value.expectedConfigurationVersion) && version(value.viewRevision));
  check(uuid(value.referenceId) && value.confirmReferenceView === true);
  return {
    expectedConfigurationVersion: value.expectedConfigurationVersion,
    referenceId: value.referenceId,
    viewRevision: value.viewRevision,
    confirmReferenceView: true,
    polygon: polygon(value.polygon),
  };
}

export function parseUpdateReferenceRegionPolygonCommand(
  value: unknown,
): UpdateReferenceRegionPolygonCommand {
  return parse(value, false);
}

export function parseCreateReferenceRegionCommand(value: unknown): CreateReferenceRegionCommand {
  const parsed = parse(value, true);
  check(object(value) && uuid(value.zoneId));
  return { ...parsed, zoneId: value.zoneId };
}
