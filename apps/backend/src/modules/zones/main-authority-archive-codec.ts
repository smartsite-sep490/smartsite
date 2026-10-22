import type { Mf06AssessmentPurpose } from '../../database/entities/zone-entry-assessment-request.entity.js';
import { computeCanonicalPayloadHash, PPE_ITEMS } from '@smartsite/contracts';
import { z } from 'zod';
import { MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-authority-sources.js';
import { CameraStatus, ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import { UserRole } from '../../database/entities/user.entity.js';
import {
  MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT,
  MAIN_TEAM_AUTHORITY_SOURCES,
  teamAuthorityRowSchemas,
  teamAuthorityScopeMatches,
} from './main-team-authority-archive.js';

export const MAIN_AUTHORITY_ARCHIVE_FORMAT = 'MF06_MAIN_AUTHORITY_ARCHIVE_V1';
export const MAIN_AUTHORITY_ARCHIVE_FORMAT_V2 = MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT;
export const MAIN_AUTHORITY_ARCHIVE_FORMATS = [
  MAIN_AUTHORITY_ARCHIVE_FORMAT,
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
] as const;
export interface MainAuthorityArchiveContext {
  siteId: string;
  zoneId: string;
  workerId: string | null;
  capturedAt: string;
  purpose: Mf06AssessmentPurpose;
}
export interface MainAuthorityArchivePayload {
  version: typeof MAIN_AUTHORITY_ARCHIVE_FORMAT | typeof MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT;
  context: MainAuthorityArchiveContext;
  archivedAt: string;
  baseline: {
    epochId: string;
    capturedAt: string;
    declaredWriterManifestHash: string;
    sourceRegistryHash: string;
    snapshotHash: string;
  };
  sources: readonly {
    sourceKind: string;
    tableName: string;
    fields: readonly string[];
    rows: readonly Record<string, unknown>[];
  }[];
}
export interface MainAuthorityArchive {
  format: MainAuthorityArchivePayload['version'];
  sha256: string;
  payload: MainAuthorityArchivePayload;
}
export type MainAuthorityArchiveResult =
  | {
      status: 'UNAVAILABLE';
      reason:
        | 'MALFORMED_ARCHIVE'
        | 'RESOURCE_LIMIT'
        | 'UNSUPPORTED_VERSION'
        | 'BINDING_MISMATCH'
        | 'DIGEST_MISMATCH'
        | 'SOURCE_REGISTRY_MISMATCH'
        | 'SOURCE_SCOPE_MISMATCH'
        | 'INVALID_TIME'
        | 'PRE_BASELINE';
    }
  | {
      status: 'VALID';
      archive: MainAuthorityArchive;
      authorityCoverageEstablished: false;
      identityEstablished: false;
    };

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2048;
const MAX_JSON_NODES = 100000;
const MAX_DEPTH = 32;
// Preserve the earlier Root V2 metadata order; never normalize stored bytes or widen V1.
const rootV2MembershipFields = [
  'id',
  'team_id',
  'worker_id',
  'site_id',
  'contractor_id',
  'joined_at',
  'left_at',
];
class ArchiveInputError extends Error {
  constructor(readonly reason: 'RESOURCE_LIMIT' | 'MALFORMED_ARCHIVE') {
    super(reason);
  }
}
type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
function materialize(
  value: unknown,
  budget = { nodes: 0, bytes: 0 },
  ancestors = new Set<object>(),
  depth = 0,
): Json {
  if (++budget.nodes > MAX_JSON_NODES || depth > MAX_DEPTH)
    throw new ArchiveInputError('RESOURCE_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new ArchiveInputError('MALFORMED_ARCHIVE');
    return value;
  }
  if (typeof value !== 'object') throw new ArchiveInputError('MALFORMED_ARCHIVE');
  const array = Array.isArray(value),
    proto = Object.getPrototypeOf(value);
  if (
    (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) ||
    ancestors.has(value) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new ArchiveInputError('MALFORMED_ARCHIVE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length?.value as unknown;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_JSON_NODES
      )
        throw new ArchiveInputError('RESOURCE_LIMIT');
      if (Object.keys(descriptors).length !== length + 1)
        throw new ArchiveInputError('MALFORMED_ARCHIVE');
      const copy: Json[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          throw new ArchiveInputError('MALFORMED_ARCHIVE');
        copy.push(materialize(descriptor.value, budget, ancestors, depth + 1));
      }
      return copy;
    }
    const copy: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key) ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      )
        throw new ArchiveInputError('MALFORMED_ARCHIVE');
      budget.bytes += Buffer.byteLength(key, 'utf8');
      if (budget.bytes > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
      copy[key] = materialize(descriptor.value, budget, ancestors, depth + 1);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}
function safeInput(value: unknown): Json {
  const copy = materialize(value);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > MAX_BYTES)
    throw new ArchiveInputError('RESOURCE_LIMIT');
  return copy;
}
/** Offset-aware PostgreSQL precision. Never round interval/header instants through JS Date. */
function micros(value: string): bigint | null {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(
      value,
    );
  if (!parts) return null;
  const y = Number(parts[1]),
    m = Number(parts[2]),
    d = Number(parts[3]),
    h = Number(parts[4]),
    minute = Number(parts[5]),
    s = Number(parts[6]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const clock = new Date(0);
  clock.setUTCFullYear(y, m - 1, d);
  clock.setUTCHours(h, minute, s, 0);
  if (
    clock.getUTCFullYear() !== y ||
    clock.getUTCMonth() !== m - 1 ||
    clock.getUTCDate() !== d ||
    !Number.isFinite(clock.getTime())
  )
    return null;
  const offset = parts[8]!;
  const offsetMinutes =
    offset === 'Z'
      ? 0
      : (offset[0] === '+' ? 1 : -1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  return (
    BigInt(clock.getTime()) * 1000n +
    BigInt((parts[7] ?? '').padEnd(6, '0')) -
    BigInt(offsetMinutes) * 60000000n
  );
}
export { micros as parseMainAuthorityInstant };
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const instant = z
  .string()
  .max(40)
  .refine((value) => micros(value) !== null);
const contextSchema = z.strictObject({
  siteId: id,
  zoneId: id,
  workerId: id.nullable(),
  capturedAt: z.string().max(40),
  purpose: z.enum(['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW']),
});
const sourceSchema = z.strictObject({
  sourceKind: z.string(),
  tableName: z.string(),
  fields: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});
const payloadSchema = z.strictObject({
  version: z.enum([MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT]),
  context: contextSchema,
  archivedAt: z.string().max(40),
  baseline: z.strictObject({
    epochId: id,
    capturedAt: z.string().max(40),
    declaredWriterManifestHash: digest,
    sourceRegistryHash: digest,
    snapshotHash: digest,
  }),
  sources: z.array(sourceSchema),
});
const range = { valid_from: instant, valid_until: instant.nullable() };
const rowSchemas = {
  USER_ACCOUNT: z.strictObject({
    id,
    is_active: z.boolean(),
    must_change_password: z.boolean(),
    created_at: instant,
  }),
  USER_ROLE: z.strictObject({
    id,
    user_id: id,
    role: z.enum(UserRole),
    site_id: id.nullable(),
    created_at: instant,
  }),
  SITE: z.strictObject({ id, access_policy_version: version }),
  WORKER: z.strictObject({
    id,
    site_id: id,
    contractor_id: id.nullable(),
    user_id: id.nullable(),
    is_active: z.boolean(),
  }),
  CONTRACTOR: z.strictObject({ id, is_active: z.boolean() }),
  REPRESENTATIVE_GRANT: z.strictObject({ id, user_id: id, contractor_id: id, created_at: instant }),
  REPRESENTATIVE_ASSIGNMENT: z.strictObject({
    id,
    site_id: id,
    contractor_id: id,
    user_id: id,
    created_at: instant,
  }),
  PARTICIPATION: z.strictObject({
    id,
    contractor_id: id,
    site_id: id,
    is_active: z.boolean(),
    ...range,
  }),
  ASSIGNMENT: z.strictObject({
    id,
    worker_id: id,
    site_id: id,
    site_contractor_id: id.nullable(),
    // Retained MAIN archive vocabulary, including inactive historical assignments.
    // Parsing these records establishes neither current eligibility nor authority.
    status: z.enum([
      'PENDING',
      'SAFETY_REVIEWED',
      'APPROVED',
      'REJECTED',
      'CANCELLED',
      'REVOKED',
      'EXPIRED',
    ]),
    version,
    ...range,
  }),
  CONTRACTOR_PERMISSION: z.strictObject({
    id,
    site_contractor_id: id,
    zone_id: id,
    valid_from: instant,
    valid_until: instant,
    revoked_at: instant.nullable(),
  }),
  WORKER_PERMISSION: z.strictObject({
    id,
    worker_assignment_id: id,
    contractor_zone_permission_id: id,
    valid_from: instant,
    valid_until: instant,
    revoked_at: instant.nullable(),
  }),
  ZONE_GRANT: z.strictObject({
    id,
    site_id: id,
    zone_id: id,
    worker_id: id,
    effect: z.enum(['ALLOW', 'DENY']),
    ...range,
    revoked_at: instant.nullable(),
  }),
  ZONE_POLICY: z.strictObject({
    id,
    site_id: id,
    restriction_policy: z.enum(ZoneRestrictionPolicy),
    required_ppe: z.array(z.enum(PPE_ITEMS)).max(PPE_ITEMS.length),
    configuration_locked: z.boolean(),
  }),
  CAMERA: z.strictObject({
    id,
    site_id: id,
    external_id: z.string().min(1).max(128),
    status: z.enum(CameraStatus),
    configuration_version: version,
  }),
  REGION: z.strictObject({
    id,
    camera_id: id,
    zone_id: id,
    // Preserve retained tuple archives and the camera API's coordinates envelope verbatim.
    polygon: z.union([
      z
        .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
        .min(3)
        .max(256),
      z.strictObject({
        coordinates: z
          .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
          .min(3)
          .max(64),
      }),
    ]),
    coordinate_space: z.literal('NORMALIZED_0_1'),
    version,
    is_active: z.boolean(),
  }),
};
const teamRows: Record<string, z.ZodType> = {
  ...rowSchemas,
  ...teamAuthorityRowSchemas((value) => micros(value) !== null),
  ASSIGNMENT: rowSchemas.ASSIGNMENT.extend({ zone_ids: z.array(id).max(MAX_ROWS) }),
};
const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const unavailable = (
  reason: Extract<MainAuthorityArchiveResult, { status: 'UNAVAILABLE' }>['reason'],
): MainAuthorityArchiveResult => ({ status: 'UNAVAILABLE', reason });
function validatePayload(
  value: unknown,
  expected: MainAuthorityArchiveContext,
): MainAuthorityArchiveResult | MainAuthorityArchivePayload {
  const target = contextSchema.safeParse(safeInput(expected));
  const parsed = payloadSchema.safeParse(value);
  if (!target.success) return unavailable('BINDING_MISMATCH');
  if (!parsed.success) return unavailable('MALFORMED_ARCHIVE');
  const payload = parsed.data;
  const at = micros(payload.context.capturedAt),
    wanted = micros(target.data.capturedAt),
    base = micros(payload.baseline.capturedAt),
    archived = micros(payload.archivedAt);
  if (at === null || wanted === null || base === null || archived === null || archived < at)
    return unavailable('INVALID_TIME');
  if (
    !same(payload.context.siteId, target.data.siteId) ||
    !same(payload.context.zoneId, target.data.zoneId) ||
    (payload.context.workerId === null
      ? target.data.workerId !== null
      : !same(payload.context.workerId, target.data.workerId)) ||
    payload.context.purpose !== target.data.purpose ||
    at !== wanted
  )
    return unavailable('BINDING_MISMATCH');
  if (at < base) return unavailable('PRE_BASELINE');
  if (payload.sources.reduce((sum, source) => sum + source.rows.length, 0) > MAX_ROWS)
    return unavailable('RESOURCE_LIMIT');
  const sourceRegistry =
    payload.version === MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT
      ? MAIN_TEAM_AUTHORITY_SOURCES
      : MAIN_AUTHORITY_SOURCES;
  const schemas: Record<string, z.ZodType> =
    payload.version === MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT ? teamRows : rowSchemas;
  if (payload.sources.length !== sourceRegistry.length)
    return unavailable('SOURCE_REGISTRY_MISMATCH');
  const registry = new Map(
    sourceRegistry.map(([kind, table, fields]) => [kind, { table, fields }]),
  );
  const seenKinds = new Set<string>(),
    rows = new Map<string, Record<string, unknown>[]>();
  for (const source of payload.sources) {
    const entry = registry.get(source.sourceKind);
    const legacyV2Membership =
      payload.version === MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT &&
      source.sourceKind === 'TEAM_MEMBERSHIP' &&
      source.fields.length === rootV2MembershipFields.length &&
      source.fields.every((field, index) => field === rootV2MembershipFields[index]);
    if (
      !entry ||
      seenKinds.has(source.sourceKind) ||
      source.tableName !== entry.table ||
      source.fields.length !== entry.fields.length ||
      (!legacyV2Membership && source.fields.some((field, index) => field !== entry.fields[index]))
    )
      return unavailable('SOURCE_REGISTRY_MISMATCH');
    seenKinds.add(source.sourceKind);
    const seenIds = new Set<string>();
    for (const row of source.rows) {
      if (!schemas[source.sourceKind]?.safeParse(row).success)
        return unavailable('MALFORMED_ARCHIVE');
      const key = (row.id as string).toLowerCase();
      if (seenIds.has(key)) return unavailable('MALFORMED_ARCHIVE');
      seenIds.add(key);
      if (
        typeof row.valid_from === 'string' &&
        typeof row.valid_until === 'string' &&
        micros(row.valid_until)! <= micros(row.valid_from)!
      )
        return unavailable('INVALID_TIME');
    }
    if (
      source.sourceKind === 'TEAM_MEMBERSHIP' &&
      source.rows.some(
        (row) =>
          row.left_at !== null && micros(row.left_at as string)! < micros(row.joined_at as string)!,
      )
    )
      return unavailable('INVALID_TIME');
    rows.set(source.sourceKind, source.rows);
  }
  const site = (rows.get('SITE') ?? []).find((row) => same(row.id, target.data.siteId));
  const zone = (rows.get('ZONE_POLICY') ?? []).find((row) => same(row.id, target.data.zoneId));
  const worker =
    target.data.workerId === null
      ? null
      : (rows.get('WORKER') ?? []).find((row) => same(row.id, target.data.workerId));
  if (
    !site ||
    !zone ||
    !same(zone.site_id, target.data.siteId) ||
    (target.data.workerId !== null && (!worker || !same(worker.site_id, target.data.siteId)))
  )
    return unavailable('SOURCE_SCOPE_MISMATCH');
  for (const camera of rows.get('CAMERA') ?? [])
    if (!(rows.get('SITE') ?? []).some((row) => same(row.id, camera.site_id)))
      return unavailable('SOURCE_SCOPE_MISMATCH');
  for (const region of rows.get('REGION') ?? []) {
    const camera = (rows.get('CAMERA') ?? []).find((row) => same(row.id, region.camera_id));
    const parentZone = (rows.get('ZONE_POLICY') ?? []).find((row) => same(row.id, region.zone_id));
    if (!camera || !parentZone || !same(camera.site_id, parentZone.site_id))
      return unavailable('SOURCE_SCOPE_MISMATCH');
  }
  if (payload.version === MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT && !teamAuthorityScopeMatches(rows))
    return unavailable('SOURCE_SCOPE_MISMATCH');
  return payload;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function accepted(payload: MainAuthorityArchivePayload): MainAuthorityArchiveResult {
  const archive = freeze<MainAuthorityArchive>({
    format: payload.version,
    sha256: computeCanonicalPayloadHash(payload),
    payload,
  });
  return {
    status: 'VALID',
    archive,
    authorityCoverageEstablished: false,
    identityEstablished: false,
  };
}
const rejection = (error: unknown) =>
  unavailable(error instanceof ArchiveInputError ? error.reason : 'MALFORMED_ARCHIVE');

/** Private JSON archive integrity only; this codec does not assert READY or permissions. */
export function sealMainAuthorityArchive(
  payload: unknown,
  expected: MainAuthorityArchiveContext,
): MainAuthorityArchiveResult {
  try {
    const input = safeInput(payload);
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      !([MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT] as unknown[]).includes(
        input.version,
      )
    )
      return unavailable('UNSUPPORTED_VERSION');
    const parsed = validatePayload(input, expected);
    return 'status' in parsed ? parsed : accepted(parsed);
  } catch (error) {
    return rejection(error);
  }
}
export function decodeStoredMainAuthorityArchive(
  value: unknown,
  expected: MainAuthorityArchiveContext & { sha256: string },
): MainAuthorityArchiveResult {
  try {
    const input = safeInput(value);
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return unavailable('MALFORMED_ARCHIVE');
    if (
      !([MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT] as unknown[]).includes(
        input.format,
      )
    )
      return unavailable('UNSUPPORTED_VERSION');
    const envelope = z
      .strictObject({
        format: z.enum([MAIN_AUTHORITY_ARCHIVE_FORMAT, MAIN_TEAM_AUTHORITY_ARCHIVE_FORMAT]),
        sha256: digest,
        payload: z.unknown(),
      })
      .safeParse(input);
    const wanted = z
      .strictObject({ ...contextSchema.shape, sha256: digest })
      .safeParse(safeInput(expected));
    if (!envelope.success) return unavailable('MALFORMED_ARCHIVE');
    if (!wanted.success) return unavailable('BINDING_MISMATCH');
    if (
      envelope.data.sha256 !== wanted.data.sha256 ||
      computeCanonicalPayloadHash(envelope.data.payload) !== envelope.data.sha256
    )
      return unavailable('DIGEST_MISMATCH');
    if (
      envelope.data.payload &&
      typeof envelope.data.payload === 'object' &&
      'version' in envelope.data.payload &&
      envelope.data.payload.version !== envelope.data.format
    )
      return unavailable('UNSUPPORTED_VERSION');
    const { sha256: expectedDigest, ...context } = wanted.data;
    void expectedDigest;
    const parsed = validatePayload(envelope.data.payload, context);
    return 'status' in parsed ? parsed : accepted(parsed);
  } catch (error) {
    return rejection(error);
  }
}
