import type {
  CameraRegionConfiguration,
  NormalizedCoordinate,
} from '../camera-region-configuration.js';
import type { ValidationIssue } from './geometry-validator.js';

function cross(a: NormalizedCoordinate, b: NormalizedCoordinate, c: NormalizedCoordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(
  a: NormalizedCoordinate,
  b: NormalizedCoordinate,
  point: NormalizedCoordinate,
): boolean {
  return (
    point[0] >= Math.min(a[0], b[0]) &&
    point[0] <= Math.max(a[0], b[0]) &&
    point[1] >= Math.min(a[1], b[1]) &&
    point[1] <= Math.max(a[1], b[1])
  );
}

function segmentsIntersect(
  a: NormalizedCoordinate,
  b: NormalizedCoordinate,
  c: NormalizedCoordinate,
  d: NormalizedCoordinate,
): boolean {
  const abc = cross(a, b, c);
  const abd = cross(a, b, d);
  const cda = cross(c, d, a);
  const cdb = cross(c, d, b);

  if (abc === 0 && onSegment(a, b, c)) return true;
  if (abd === 0 && onSegment(a, b, d)) return true;
  if (cda === 0 && onSegment(c, d, a)) return true;
  if (cdb === 0 && onSegment(c, d, b)) return true;

  return (
    ((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))
  );
}

/** Express a schema-validated [0, 1] coordinate exactly in units of 2^-1074. */
function exactCoordinate(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = (bits >> 52n) & 0x7ffn;
  const fraction = bits & 0xfffffffffffffn;
  // Subnormal numbers have no implicit leading bit; this also handles +/-0.
  if (exponent === 0n) return fraction;
  return ((1n << 52n) | fraction) << (exponent - 1n);
}

function hasZeroArea(coordinates: readonly NormalizedCoordinate[]): boolean {
  const exact = coordinates.map(([x, y]) => [exactCoordinate(x), exactCoordinate(y)] as const);
  let twiceArea = 0n;
  for (let index = 0; index < exact.length; index++) {
    const current = exact[index];
    const next = exact[(index + 1) % exact.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  // The common scale cancels for a zero test. BigInt prevents cancellation
  // and underflow without imposing any minimum area on valid polygons.
  return twiceArea === 0n;
}

function polygonError(coordinates: readonly NormalizedCoordinate[]): string | undefined {
  const vertices = new Set<string>();
  for (const [x, y] of coordinates) {
    const key = `${x},${y}`;
    if (vertices.has(key)) return 'Polygon vertices must be distinct, including the closing vertex';
    vertices.add(key);
  }

  if (hasZeroArea(coordinates)) return 'Polygon must have nonzero area';

  for (let first = 0; first < coordinates.length; first++) {
    const firstNext = (first + 1) % coordinates.length;
    for (let second = first + 1; second < coordinates.length; second++) {
      const secondNext = (second + 1) % coordinates.length;
      // Consecutive edges (including the closing edge) share one endpoint.
      if (firstNext === second || secondNext === first) continue;
      if (
        segmentsIntersect(
          coordinates[first],
          coordinates[firstNext],
          coordinates[second],
          coordinates[secondNext],
        )
      ) {
        return 'Non-adjacent polygon edges must not intersect';
      }
    }
  }
  return undefined;
}

/** Validates semantic invariants after the camera region schema has passed. */
export function validateCameraRegionPolygons(
  configuration: CameraRegionConfiguration,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const regionIds = new Set<string>();
  for (const [index, region] of configuration.regions.entries()) {
    if (regionIds.has(region.regionId)) {
      issues.push({
        code: 'DUPLICATE_REGION_ID',
        path: `/regions/${index}/regionId`,
        message: 'Region IDs must be unique',
      });
    }
    regionIds.add(region.regionId);
  }
  if (issues.length > 0) return issues;

  for (const [index, region] of configuration.regions.entries()) {
    const message = polygonError(region.polygon.coordinates);
    if (message) {
      issues.push({
        code: 'INVALID_GEOMETRY',
        path: `/regions/${index}/polygon/coordinates`,
        message,
      });
    }
  }
  return issues;
}
