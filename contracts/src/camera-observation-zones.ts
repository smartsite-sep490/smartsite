/** Current configured observation context, never historical event location or media permission. */
export interface CameraObservationZones {
  siteId: string;
  cameraId: string;
  configurationVersion: number;
  items: { id: string; code: string; name: string }[];
  total: number;
  unresolvedRegionCount: number;
}

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function check(value: unknown): asserts value {
  if (!value) throw new Error('Invalid camera observation Zone metadata');
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  check(Object.keys(value).length === expected.length);
  check(Object.keys(value).every((key) => expected.includes(key)));
}
function count(value: unknown, min = 0, max = 64): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[\p{Cc}\p{Cs}]/u.test(value)
  );
}
export function parseCameraObservationZones(value: unknown): CameraObservationZones {
  check(object(value));
  keys(value, [
    'siteId',
    'cameraId',
    'configurationVersion',
    'items',
    'total',
    'unresolvedRegionCount',
  ]);
  check(typeof value.siteId === 'string' && uuid.test(value.siteId));
  check(typeof value.cameraId === 'string' && uuid.test(value.cameraId));
  check(count(value.configurationVersion, 1, Number.MAX_SAFE_INTEGER));
  check(count(value.total) && count(value.unresolvedRegionCount));
  check(value.total + value.unresolvedRegionCount <= 64);
  check(Array.isArray(value.items) && value.items.length <= value.total);
  const ids = new Set<string>();
  for (const item of value.items) {
    check(object(item));
    keys(item, ['id', 'code', 'name']);
    check(typeof item.id === 'string' && uuid.test(item.id));
    check(!ids.has(item.id.toLowerCase()));
    ids.add(item.id.toLowerCase());
    check(text(item.code, 64) && text(item.name, 255));
  }
  return value as unknown as CameraObservationZones;
}
