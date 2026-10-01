import type { Page, ZoneEntryDecisionStatus } from './management-api.js';

export interface ObservationIdentitySubjectRef {
  eventId: string;
  personObservationIndex: number;
  payloadHash: string;
  cameraId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  trackId: number;
  personBoundingBox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    coordinateSpace: 'NORMALIZED_0_1';
  };
}
export interface ObservationIdentityManualDecision {
  id: string;
  revision: number;
  action: 'RESOLVE' | 'CLEAR';
  workerId: string | null;
  actorUserId: string;
  reason: string;
  scope: 'EXACT_OBSERVATION';
  verificationMethod: 'MANUAL';
  recordedAt: string;
}
export interface ObservationIdentityDecisionResponse extends ObservationIdentityManualDecision {
  subjectRef: ObservationIdentitySubjectRef;
  evidenceIndex: number | null;
  evidenceSha256: string | null;
}
export interface ObservationIdentityMutationResponse {
  recordedDecision: ObservationIdentityDecisionResponse;
  latestRevision: number;
  replayed: boolean;
}
export interface ObservationIdentityWorkerResponse {
  id: string;
  siteId: string;
  externalId: string;
  displayName: string;
  isActive: boolean;
}
export interface ObservationIdentityTechnicalCandidate {
  status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE';
  candidateWorkerId?: string;
  similarityScore?: number;
  qualityScore?: number;
}
export type ObservationIdentityResolveBlockReason =
  | 'EVENT_INCONSISTENT'
  | 'SUBJECT_UNAVAILABLE'
  | 'WORKER_READER_UNAVAILABLE'
  | 'FRAME_UNAVAILABLE'
  | 'REVISION_EXHAUSTED'
  | 'STATE_INCONSISTENT';
export type ObservationIdentityClearBlockReason =
  'NO_ACTIVE_RESOLUTION' | 'STATE_INCONSISTENT' | 'REVISION_EXHAUSTED';
export interface ObservationIdentitySubjectResponse {
  personObservationIndex: number;
  trackId: number | null;
  subjectRef: ObservationIdentitySubjectRef | null;
  subjectRefSource: 'RAW_EVENT' | 'PERSISTED_REVIEW' | null;
  technicalIdentity: {
    status: 'CANDIDATE' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFLICTED';
    candidates: ObservationIdentityTechnicalCandidate[];
  };
  latestManualDecision: ObservationIdentityManualDecision | null;
  revision: number;
  canResolve: boolean;
  resolveBlockReason: ObservationIdentityResolveBlockReason | null;
  canClear: boolean;
  clearBlockReason: ObservationIdentityClearBlockReason | null;
  originalZoneDecisions: Page<{
    id: string;
    zoneId: string;
    status: ZoneEntryDecisionStatus;
    reasonCode: string;
    evaluatedAt: string;
  }>;
}
export interface ObservationIdentityContextResponse {
  eventId: string;
  payloadHash: string;
  eventConsistent: boolean;
  frames: { index: number; kind: 'FRAME'; sha256: string | null; available: boolean }[];
  subjects: ObservationIdentitySubjectResponse[];
}
interface DecisionCommandBase {
  commandId: string;
  expectedRevision: number;
  expectedEventHash: string;
  reason: string;
}
export type ObservationIdentityDecisionCommand =
  | (DecisionCommandBase & {
      action: 'RESOLVE';
      workerId: string;
      evidenceIndex: number;
      expectedEvidenceSha256: string;
    })
  | (DecisionCommandBase & {
      action: 'CLEAR';
      workerId?: never;
      evidenceIndex?: never;
      expectedEvidenceSha256?: never;
    });

const MAX_REVISION = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  return required.every((k) => Object.hasOwn(object, k)) &&
    Object.keys(object).every((k) => required.includes(k) || optional.includes(k))
    ? object
    : undefined;
}
const integer = (v: unknown, max: number, min = 0): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const id = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && HASH.test(v);
const score = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const text = (v: unknown, max: number, min = 1): v is string =>
  typeof v === 'string' &&
  Array.from(v).length >= min &&
  Array.from(v).length <= max &&
  !v.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
function timestamp(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt](?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(
      v,
    ) &&
    Number.isFinite(Date.parse(v.replace(/:60(?=\.|[Zz]|[+-])/u, ':59')))
  );
}
function subjectRef(value: unknown): value is ObservationIdentitySubjectRef {
  const v = fields(value, [
    'eventId',
    'personObservationIndex',
    'payloadHash',
    'cameraId',
    'cameraExternalId',
    'streamSessionId',
    'capturedAt',
    'trackId',
    'personBoundingBox',
  ]);
  if (
    !v ||
    !id(v.eventId) ||
    !integer(v.personObservationIndex, 255) ||
    !hash(v.payloadHash) ||
    !id(v.cameraId) ||
    !text(v.cameraExternalId, 128) ||
    !id(v.streamSessionId) ||
    !timestamp(v.capturedAt) ||
    !integer(v.trackId, Number.MAX_SAFE_INTEGER)
  )
    return false;
  const b = fields(v.personBoundingBox, ['x1', 'y1', 'x2', 'y2', 'coordinateSpace']);
  return (
    !!b &&
    score(b.x1) &&
    score(b.y1) &&
    score(b.x2) &&
    score(b.y2) &&
    (b.x1 as number) < (b.x2 as number) &&
    (b.y1 as number) < (b.y2 as number) &&
    b.coordinateSpace === 'NORMALIZED_0_1'
  );
}
const manualKeys = [
  'id',
  'revision',
  'action',
  'workerId',
  'actorUserId',
  'reason',
  'scope',
  'verificationMethod',
  'recordedAt',
];
function manualValues(v: Record<string, unknown>): boolean {
  return (
    id(v.id) &&
    integer(v.revision, MAX_REVISION, 1) &&
    id(v.actorUserId) &&
    text(v.reason, 1000, 5) &&
    v.reason.trim() === v.reason &&
    timestamp(v.recordedAt) &&
    v.scope === 'EXACT_OBSERVATION' &&
    v.verificationMethod === 'MANUAL' &&
    ((v.action === 'RESOLVE' && id(v.workerId)) || (v.action === 'CLEAR' && v.workerId === null))
  );
}
function manual(value: unknown): value is ObservationIdentityManualDecision {
  const v = fields(value, manualKeys);
  return !!v && manualValues(v);
}
function decision(value: unknown): value is ObservationIdentityDecisionResponse {
  const v = fields(value, [...manualKeys, 'subjectRef', 'evidenceIndex', 'evidenceSha256']);
  return (
    !!v &&
    manualValues(v) &&
    subjectRef(v.subjectRef) &&
    ((v.action === 'RESOLVE' && integer(v.evidenceIndex, 255) && hash(v.evidenceSha256)) ||
      (v.action === 'CLEAR' && v.evidenceIndex === null && v.evidenceSha256 === null))
  );
}
function technical(value: unknown): boolean {
  const v = fields(value, ['status', 'candidates']);
  if (!v || !Array.isArray(v.candidates) || v.candidates.length > 256) return false;
  const keys = new Set<string>();
  for (const item of v.candidates) {
    const c = fields(item, ['status'], ['candidateWorkerId', 'similarityScore', 'qualityScore']);
    if (!c || (c.qualityScore !== undefined && !score(c.qualityScore))) return false;
    if (c.status === 'CANDIDATE') {
      if (!text(c.candidateWorkerId, 128) || !score(c.similarityScore)) return false;
    } else if (
      !['UNKNOWN', 'UNAVAILABLE'].includes(c.status as string) ||
      Object.hasOwn(c, 'candidateWorkerId') ||
      Object.hasOwn(c, 'similarityScore')
    )
      return false;
    keys.add(`${c.status as string}:${(c.candidateWorkerId as string) ?? ''}`);
  }
  return keys.size > 1
    ? v.status === 'CONFLICTED'
    : keys.size === 1
      ? v.status === (v.candidates[0] as { status: string }).status
      : ['UNKNOWN', 'UNAVAILABLE'].includes(v.status as string);
}
function zonePage(value: unknown): boolean {
  const v = fields(value, ['items', 'total']);
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 100 ||
    !integer(v.total, Number.MAX_SAFE_INTEGER) ||
    v.total < v.items.length
  )
    return false;
  return v.items.every((item) => {
    const z = fields(item, ['id', 'zoneId', 'status', 'reasonCode', 'evaluatedAt']);
    return (
      !!z &&
      id(z.id) &&
      id(z.zoneId) &&
      ['ALLOWED', 'DENIED', 'UNAVAILABLE'].includes(z.status as string) &&
      text(z.reasonCode, 128) &&
      timestamp(z.evaluatedAt)
    );
  });
}
export function parseObservationIdentityContextResponse(
  value: unknown,
): ObservationIdentityContextResponse | undefined {
  const v = fields(value, ['eventId', 'payloadHash', 'eventConsistent', 'frames', 'subjects']);
  if (
    !v ||
    !id(v.eventId) ||
    !hash(v.payloadHash) ||
    typeof v.eventConsistent !== 'boolean' ||
    !Array.isArray(v.frames) ||
    v.frames.length > 256 ||
    !Array.isArray(v.subjects) ||
    v.subjects.length > 256
  )
    return undefined;
  const frameIndices = new Set<number>();
  let availableFrame = false;
  for (const item of v.frames) {
    const f = fields(item, ['index', 'kind', 'sha256', 'available']);
    if (
      !f ||
      !integer(f.index, 255) ||
      frameIndices.has(f.index) ||
      f.kind !== 'FRAME' ||
      typeof f.available !== 'boolean' ||
      (f.available ? !hash(f.sha256) : f.sha256 !== null)
    )
      return undefined;
    frameIndices.add(f.index);
    availableFrame ||= f.available;
  }
  const subjectIndices = new Set<number>();
  for (const item of v.subjects) {
    const s = fields(item, [
      'personObservationIndex',
      'trackId',
      'subjectRef',
      'subjectRefSource',
      'technicalIdentity',
      'latestManualDecision',
      'revision',
      'canResolve',
      'resolveBlockReason',
      'canClear',
      'clearBlockReason',
      'originalZoneDecisions',
    ]);
    if (
      !s ||
      !integer(s.personObservationIndex, 255) ||
      subjectIndices.has(s.personObservationIndex) ||
      !(s.trackId === null || integer(s.trackId, Number.MAX_SAFE_INTEGER)) ||
      !integer(s.revision, MAX_REVISION) ||
      !technical(s.technicalIdentity) ||
      !zonePage(s.originalZoneDecisions) ||
      typeof s.canResolve !== 'boolean' ||
      typeof s.canClear !== 'boolean'
    )
      return undefined;
    subjectIndices.add(s.personObservationIndex);
    if (s.subjectRef === null) {
      if (s.subjectRefSource !== null) return undefined;
    } else if (
      !subjectRef(s.subjectRef) ||
      !['RAW_EVENT', 'PERSISTED_REVIEW'].includes(s.subjectRefSource as string) ||
      s.subjectRef.eventId.toLowerCase() !== v.eventId.toLowerCase() ||
      s.subjectRef.payloadHash !== v.payloadHash ||
      s.subjectRef.personObservationIndex !== s.personObservationIndex ||
      s.subjectRef.trackId !== s.trackId
    )
      return undefined;
    if (
      s.latestManualDecision !== null &&
      (!manual(s.latestManualDecision) || s.latestManualDecision.revision !== s.revision)
    )
      return undefined;
    if (s.canResolve) {
      if (
        s.resolveBlockReason !== null ||
        !v.eventConsistent ||
        !availableFrame ||
        s.subjectRefSource !== 'RAW_EVENT' ||
        s.subjectRef === null ||
        s.revision === MAX_REVISION
      )
        return undefined;
    } else if (
      ![
        'EVENT_INCONSISTENT',
        'SUBJECT_UNAVAILABLE',
        'WORKER_READER_UNAVAILABLE',
        'FRAME_UNAVAILABLE',
        'REVISION_EXHAUSTED',
        'STATE_INCONSISTENT',
      ].includes(s.resolveBlockReason as string)
    )
      return undefined;
    if (s.canClear) {
      if (
        s.clearBlockReason !== null ||
        !manual(s.latestManualDecision) ||
        s.latestManualDecision.action !== 'RESOLVE' ||
        s.subjectRef === null ||
        s.revision === MAX_REVISION
      )
        return undefined;
    } else if (
      !['NO_ACTIVE_RESOLUTION', 'STATE_INCONSISTENT', 'REVISION_EXHAUSTED'].includes(
        s.clearBlockReason as string,
      )
    )
      return undefined;
  }
  return value as ObservationIdentityContextResponse;
}
export function parseObservationIdentityMutationResponse(
  value: unknown,
): ObservationIdentityMutationResponse | undefined {
  const v = fields(value, ['recordedDecision', 'latestRevision', 'replayed']);
  return v &&
    decision(v.recordedDecision) &&
    integer(v.latestRevision, MAX_REVISION, v.recordedDecision.revision) &&
    typeof v.replayed === 'boolean'
    ? (value as ObservationIdentityMutationResponse)
    : undefined;
}
export function parseObservationIdentityDecisionPage(
  value: unknown,
): Page<ObservationIdentityDecisionResponse> | undefined {
  const v = fields(value, ['items', 'total']);
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 100 ||
    !integer(v.total, Number.MAX_SAFE_INTEGER) ||
    v.total < v.items.length
  )
    return undefined;
  let previous = 0;
  let ref: ObservationIdentitySubjectRef | undefined;
  for (const item of v.items) {
    if (!decision(item) || item.revision <= previous) return undefined;
    previous = item.revision;
    if (
      ref &&
      (item.subjectRef.eventId !== ref.eventId ||
        item.subjectRef.personObservationIndex !== ref.personObservationIndex ||
        item.subjectRef.payloadHash !== ref.payloadHash)
    )
      return undefined;
    ref = item.subjectRef;
  }
  return value as Page<ObservationIdentityDecisionResponse>;
}
export function parseObservationIdentityWorkerPage(
  value: unknown,
  expectedSiteId?: string,
): Page<ObservationIdentityWorkerResponse> | undefined {
  const v = fields(value, ['items', 'total']);
  if (
    !v ||
    !Array.isArray(v.items) ||
    v.items.length > 100 ||
    !integer(v.total, Number.MAX_SAFE_INTEGER) ||
    v.total < v.items.length
  )
    return undefined;
  const ids = new Set<string>();
  for (const item of v.items) {
    const w = fields(item, ['id', 'siteId', 'externalId', 'displayName', 'isActive']);
    if (
      !w ||
      !id(w.id) ||
      ids.has(w.id.toLowerCase()) ||
      !id(w.siteId) ||
      !text(w.externalId, 128) ||
      !text(w.displayName, 255) ||
      typeof w.isActive !== 'boolean' ||
      (expectedSiteId && w.siteId.toLowerCase() !== expectedSiteId.toLowerCase())
    )
      return undefined;
    ids.add(w.id.toLowerCase());
  }
  return value as Page<ObservationIdentityWorkerResponse>;
}
