import type { CameraPolicyConfigurationBundle, NormalizedCoordinate } from '@smartsite/contracts';
import { resolvePpePolicyAtLocation } from '@smartsite/contracts/camera-ppe-policy';

function contains([x, y]: NormalizedCoordinate, polygon: readonly NormalizedCoordinate[]) {
  const tolerance = 1e-12;
  let inside = false;
  for (let index = 0; index < polygon.length; index++) {
    const [x1, y1] = polygon[index]!;
    const [x2, y2] = polygon[(index + 1) % polygon.length]!;
    const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
    if (
      Math.abs(cross) <= tolerance &&
      x >= Math.min(x1, x2) - tolerance &&
      x <= Math.max(x1, x2) + tolerance &&
      y >= Math.min(y1, y2) - tolerance &&
      y <= Math.max(y1, y2) + tolerance
    )
      return true;
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** Uses the same normalized bottom-center and inclusive edge rule as the worker. */
export function resolveIssuedPpeLocation(
  bundle: CameraPolicyConfigurationBundle,
  box: Record<string, unknown> | undefined,
) {
  const { x1, x2, y1, y2 } = box ?? {};
  if (
    !box ||
    box.coordinateSpace !== 'NORMALIZED_0_1' ||
    typeof x1 !== 'number' ||
    typeof x2 !== 'number' ||
    typeof y1 !== 'number' ||
    typeof y2 !== 'number' ||
    ![x1, x2, y1, y2].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
    x1 >= x2 ||
    y1 >= y2
  )
    return undefined;
  const point: NormalizedCoordinate = [(x1 + x2) / 2, y2];
  const regions = bundle.regions.filter((region) => contains(point, region.polygon.coordinates));
  return {
    regions,
    policy: resolvePpePolicyAtLocation(
      bundle.cameraPpePolicy,
      regions.map((region) => region.ppePolicy),
    ),
  };
}
