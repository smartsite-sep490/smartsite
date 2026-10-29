export interface CameraApplicationStatus {
  readonly cameraId: string;
  readonly siteId: string;
  readonly desiredRevision: number;
  readonly reportedRevision: number | null;
  readonly applicationState: 'UNCONFIRMED' | 'PENDING' | 'LOADED' | 'REJECTED' | 'STALE';
  readonly observedAt: string;
  readonly lastReceiptAt: string | null;
  readonly viewValidity: 'UNCONFIRMED' | 'NEEDS_REVALIDATION' | 'UNAVAILABLE';
  readonly reasonCode: string | null;
}

const keys = [
  'cameraId',
  'siteId',
  'desiredRevision',
  'reportedRevision',
  'applicationState',
  'observedAt',
  'lastReceiptAt',
  'viewValidity',
  'reasonCode',
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

/** Browser-safe response validation; LOADED describes configuration, not physical pose or model health. */
export function parseCameraApplicationStatus(input: unknown): CameraApplicationStatus | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key)))
    return null;
  if (
    typeof value.cameraId !== 'string' ||
    !uuid.test(value.cameraId) ||
    typeof value.siteId !== 'string' ||
    !uuid.test(value.siteId) ||
    !version(value.desiredRevision) ||
    (value.reportedRevision !== null &&
      (!version(value.reportedRevision) || value.reportedRevision > value.desiredRevision)) ||
    typeof value.applicationState !== 'string' ||
    !['UNCONFIRMED', 'PENDING', 'LOADED', 'REJECTED', 'STALE'].includes(value.applicationState) ||
    typeof value.viewValidity !== 'string' ||
    !['UNCONFIRMED', 'NEEDS_REVALIDATION', 'UNAVAILABLE'].includes(value.viewValidity) ||
    !timestamp(value.observedAt) ||
    (value.lastReceiptAt !== null &&
      (!timestamp(value.lastReceiptAt) || value.lastReceiptAt > value.observedAt)) ||
    (value.reportedRevision === null) !== (value.lastReceiptAt === null) ||
    (value.reasonCode !== null &&
      (typeof value.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)))
  )
    return null;
  if (value.applicationState === 'UNCONFIRMED' && value.reportedRevision !== null) return null;
  if (
    ['LOADED', 'REJECTED'].includes(String(value.applicationState)) &&
    (value.reportedRevision !== value.desiredRevision ||
      value.lastReceiptAt === null ||
      value.viewValidity !== 'UNCONFIRMED')
  )
    return null;
  if (value.applicationState === 'LOADED' && value.reasonCode !== null) return null;
  return value as unknown as CameraApplicationStatus;
}
