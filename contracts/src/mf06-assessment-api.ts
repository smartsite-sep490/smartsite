/** Historical assessment projection, never an identity, current grant or alert identifier. */
export interface Mf06AssessmentResponse {
  assessmentId: string;
  requestId: string;
  siteId: string;
  eventId: string;
  cameraId: string;
  zoneId: string;
  capturedAt: string;
  assessedAt: string;
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';
  outcome: 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';
  reasonCode:
    | 'INVALID_BINDING'
    | 'IDENTITY_UNAVAILABLE'
    | 'MEDIA_UNAVAILABLE'
    | 'PROFILE_REVOKED'
    | 'AUTHORITY_UNAVAILABLE'
    | 'SERVICE_DISABLED'
    | 'ABORTED'
    | 'POLICY_NONE'
    | 'POLICY_PROHIBITED'
    | 'AUTHORIZED'
    | 'UNAUTHORIZED';
  evaluatorVersion: string;
  provenance: 'UNAVAILABLE' | 'TRUSTED_SERVICE';
  /** Delivery completeness only; never means evaluation, evidence or identity is complete. */
  frameDelivery?: {
    frameId: string;
    sequenceNumber: string;
    partCount: number;
    receivedParts: number;
    status: 'PARTIAL' | 'COMPLETE';
  };
}
export interface Mf06AssessmentPage {
  items: Mf06AssessmentResponse[];
  total: number;
  offset: number;
  limit: number;
}
const keys = [
  'assessmentId',
  'requestId',
  'siteId',
  'eventId',
  'cameraId',
  'zoneId',
  'capturedAt',
  'assessedAt',
  'purpose',
  'outcome',
  'reasonCode',
  'evaluatorVersion',
  'provenance',
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons: Record<Mf06AssessmentResponse['outcome'], readonly string[]> = {
  ALLOWED: ['POLICY_NONE', 'AUTHORIZED'],
  DENIED: ['POLICY_PROHIBITED', 'UNAUTHORIZED'],
  UNAVAILABLE: [
    'INVALID_BINDING',
    'IDENTITY_UNAVAILABLE',
    'MEDIA_UNAVAILABLE',
    'PROFILE_REVOKED',
    'AUTHORITY_UNAVAILABLE',
    'SERVICE_DISABLED',
    'ABORTED',
  ],
};
function record(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function time(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function delivery(value: unknown): boolean {
  return (
    record(value, ['frameId', 'sequenceNumber', 'partCount', 'receivedParts', 'status']) &&
    typeof value.frameId === 'string' &&
    uuid.test(value.frameId) &&
    value.frameId === value.frameId.toLowerCase() &&
    typeof value.sequenceNumber === 'string' &&
    /^(0|[1-9][0-9]{0,19})$/.test(value.sequenceNumber) &&
    BigInt(value.sequenceNumber) <= 18446744073709551615n &&
    Number.isInteger(value.partCount) &&
    Number(value.partCount) >= 1 &&
    Number(value.partCount) <= 1024 &&
    Number.isInteger(value.receivedParts) &&
    Number(value.receivedParts) >= 1 &&
    Number(value.receivedParts) <= Number(value.partCount) &&
    value.status === (value.receivedParts === value.partCount ? 'COMPLETE' : 'PARTIAL')
  );
}
export function parseMf06AssessmentResponse(value: unknown): Mf06AssessmentResponse {
  if (
    !(
      record(value, keys) ||
      (record(value, [...keys, 'frameDelivery']) && delivery(value.frameDelivery))
    ) ||
    keys
      .slice(0, 6)
      .some((key) => typeof value[key] !== 'string' || !uuid.test(value[key] as string)) ||
    !time(value.capturedAt) ||
    !time(value.assessedAt) ||
    !['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW'].includes(value.purpose as string) ||
    !Object.hasOwn(reasons, value.outcome as string) ||
    !reasons[value.outcome as Mf06AssessmentResponse['outcome']].includes(
      value.reasonCode as string,
    ) ||
    !['UNAVAILABLE', 'TRUSTED_SERVICE'].includes(value.provenance as string) ||
    (['AUTHORIZED', 'UNAUTHORIZED'].includes(value.reasonCode as string) &&
      value.provenance !== 'TRUSTED_SERVICE') ||
    typeof value.evaluatorVersion !== 'string' ||
    value.evaluatorVersion.length < 1 ||
    value.evaluatorVersion.length > 128 ||
    value.evaluatorVersion.trim() !== value.evaluatorVersion
  )
    throw new Error('Invalid MF06 assessment response');
  return { ...value } as unknown as Mf06AssessmentResponse;
}
export function parseMf06AssessmentPage(value: unknown): Mf06AssessmentPage {
  if (
    !record(value, ['items', 'total', 'offset', 'limit']) ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    !Number.isSafeInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > 100 ||
    value.items.length > Number(value.limit) ||
    value.items.length > Math.max(0, Number(value.total) - Number(value.offset))
  )
    throw new Error('Invalid MF06 assessment page');
  const items = value.items.map(parseMf06AssessmentResponse);
  if (new Set(items.map((item) => item.assessmentId.toLowerCase())).size !== items.length)
    throw new Error('Invalid MF06 assessment page');
  return {
    items,
    total: Number(value.total),
    offset: Number(value.offset),
    limit: Number(value.limit),
  };
}

/** Persisted processing state, never a Worker identity, permission decision or alert. */
export interface Mf06RequestStatusResponse {
  requestId: string;
  siteId: string;
  eventId: string;
  cameraId: string;
  zoneId: string;
  capturedAt: string;
  requestedAt: string;
  purpose: Mf06AssessmentResponse['purpose'];
  jobStatus: 'NOT_QUEUED' | 'PENDING' | 'CLAIMED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  attemptCount: number | null;
  deadlineAt: string | null;
  deadlinePassed: boolean;
  assessmentId: string | null;
}
export interface Mf06RequestStatusPage {
  items: Mf06RequestStatusResponse[];
  total: number;
  offset: number;
  limit: number;
}
const requestKeys = [
  'requestId',
  'siteId',
  'eventId',
  'cameraId',
  'zoneId',
  'capturedAt',
  'requestedAt',
  'purpose',
  'jobStatus',
  'attemptCount',
  'deadlineAt',
  'deadlinePassed',
  'assessmentId',
];
export function parseMf06RequestStatusResponse(value: unknown): Mf06RequestStatusResponse {
  if (
    !record(value, requestKeys) ||
    requestKeys
      .slice(0, 5)
      .some((key) => typeof value[key] !== 'string' || !uuid.test(value[key] as string)) ||
    !time(value.capturedAt) ||
    !time(value.requestedAt) ||
    !['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW'].includes(value.purpose as string) ||
    !['NOT_QUEUED', 'PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(
      value.jobStatus as string,
    ) ||
    typeof value.deadlinePassed !== 'boolean' ||
    (value.jobStatus === 'NOT_QUEUED'
      ? value.attemptCount !== null || value.deadlineAt !== null || value.deadlinePassed !== false
      : !Number.isInteger(value.attemptCount) ||
        Number(value.attemptCount) < 0 ||
        Number(value.attemptCount) > 2147483647 ||
        !time(value.deadlineAt)) ||
    (value.jobStatus === 'SUCCEEDED'
      ? typeof value.assessmentId !== 'string' || !uuid.test(value.assessmentId)
      : value.assessmentId !== null)
  )
    throw new Error('Invalid MF06 request status response');
  return { ...value } as unknown as Mf06RequestStatusResponse;
}
export function parseMf06RequestStatusPage(value: unknown): Mf06RequestStatusPage {
  if (
    !record(value, ['items', 'total', 'offset', 'limit']) ||
    !Array.isArray(value.items) ||
    !Number.isSafeInteger(value.total) ||
    Number(value.total) < 0 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    !Number.isSafeInteger(value.limit) ||
    Number(value.limit) < 1 ||
    Number(value.limit) > 100 ||
    value.items.length > Number(value.limit) ||
    value.items.length > Math.max(0, Number(value.total) - Number(value.offset))
  )
    throw new Error('Invalid MF06 request status page');
  const items = value.items.map(parseMf06RequestStatusResponse);
  if (new Set(items.map((item) => item.requestId.toLowerCase())).size !== items.length)
    throw new Error('Invalid MF06 request status page');
  return {
    items,
    total: Number(value.total),
    offset: Number(value.offset),
    limit: Number(value.limit),
  };
}
