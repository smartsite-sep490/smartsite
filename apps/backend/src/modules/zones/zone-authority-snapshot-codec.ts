import type { CompleteZoneAuthoritySnapshot } from './zone-authority-chain.policy.js';
import {
  ZoneRestrictionPolicy,
  ZoneAuthoritySourceKind,
  ZoneAccessEffect,
} from '../../database/entities/index.js';
import { canonicalizeJson, computeCanonicalPayloadHash } from '@smartsite/contracts';
import { z } from 'zod';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AUTHORITY_SNAPSHOT_BYTE_LIMIT,
} from './zone-authority-reader.port.js';
import { selectAuthorityHistory } from './zone-authority-history-selection.js';
import { projectSelectedZoneAuthority } from './zone-authority-history-projection.js';

export interface StoredAuthoritySnapshotContext {
  siteId: string;
  zoneId: string;
  workerId: string;
  capturedAt: Date;
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';
  snapshotVersion: string;
}
export type StoredAuthoritySnapshotResult =
  | {
      status: 'VALID';
      snapshot: CompleteZoneAuthoritySnapshot;
      restrictionPolicy: ZoneRestrictionPolicy;
      capturedAt: Date;
      readAt: Date;
      purpose: StoredAuthoritySnapshotContext['purpose'];
    }
  | {
      status: 'UNAVAILABLE';
      reason:
        | 'RESOURCE_LIMIT'
        | 'MALFORMED_SNAPSHOT'
        | 'SNAPSHOT_BINDING_MISMATCH'
        | 'SNAPSHOT_DIGEST_MISMATCH'
        | 'SNAPSHOT_PROJECTION_MISMATCH'
        | 'UNSUPPORTED_SNAPSHOT_VERSION';
    };

const id = z.uuid().transform((v) => v.toLowerCase());
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const purpose = z.enum(['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW']);
// Metadata comes from Date.toISOString(); payload validity strings retain the writer's offset-aware format.
const instant = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v);
const scopeFields = { siteId: id, zoneId: id, workerId: id, contractorId: id };
const scopeSchema = z.strictObject(scopeFields);
const intervalFields = {
  ...scopeFields,
  validFrom: instant,
  validUntil: instant.nullable(),
  revokedAt: instant.nullable(),
};
const intervalSchema = z.strictObject(intervalFields);
const grantSchema = z.strictObject({ ...intervalFields, effect: z.enum(ZoneAccessEffect) });
const projectionSchema = z.strictObject({
  status: z.literal('COMPLETE'),
  ...scopeFields,
  participationIntervals: z.array(intervalSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
  assignmentIntervals: z.array(intervalSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
  contractorGrants: z.array(grantSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
  workerGrants: z.array(grantSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
});
const sourceFields = {
  sourceKind: z.enum(ZoneAuthoritySourceKind),
  sourceId: id,
  siteId: id.nullable(),
  payload: z.record(z.string(), z.json()),
};
const sourceSchema = z.strictObject(sourceFields);
const factSchema = z.strictObject({
  ...sourceFields,
  id,
  commandId: id,
  revision: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  recordedAt: instant,
  effectiveFrom: instant,
  effectiveTo: instant.nullable(),
});
const payloadSchema = z.strictObject({
  schemaVersion: z.literal('1.0.0'),
  readerVersion: z.literal('zone-authority-history-v1'),
  purpose,
  scope: scopeSchema,
  capturedAt: instant,
  readAt: instant,
  epoch: z.strictObject({ siteId: id, startedAt: instant, writerManifestHash: digest }),
  coverage: z.strictObject({
    method: z.literal('SCOPED_SOURCE_CLOSURE'),
    transactionIsolation: z.literal('SERIALIZABLE'),
  }),
  evidence: z.strictObject({
    facts: z.array(factSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
    sources: z.array(sourceSchema).max(AUTHORITY_HISTORY_FACT_LIMIT),
  }),
  policyProjection: projectionSchema,
  restrictionPolicy: z.enum(ZoneRestrictionPolicy),
  eligibility: z.strictObject({ workerActive: z.boolean(), contractorActive: z.boolean() }),
});
const contextSchema = z.strictObject({
  siteId: id,
  zoneId: id,
  workerId: id,
  capturedAt: z.date().refine((v) => Number.isFinite(v.getTime())),
  purpose,
  snapshotVersion: digest,
});
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Canonical hashing may honor toJSON or omit unsupported members. Require actual JSON
// data before hashing, including all own properties; do not execute accessor functions.
function jsonData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  const array = Array.isArray(value);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (
    (array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) ||
    ancestors.has(value) ||
    Object.getOwnPropertySymbols(value).length > 0
  )
    return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  ancestors.add(value);
  try {
    return Object.entries(descriptors).every(([key, descriptor]) => {
      if (array && key === 'length') return true;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) return false;
      return (
        descriptor.enumerable === true &&
        'value' in descriptor &&
        jsonData(descriptor.value, ancestors)
      );
    });
  } finally {
    ancestors.delete(value);
  }
}

/** Only for data retrieved from trusted internal storage with independently bound row context.
 * A digest is integrity, not identity, historical coverage approval or storage authenticity.
 * Replay never queries current authority/epoch and preserves the recorded original purpose.
 */
export function decodeStoredAuthoritySnapshot(
  value: unknown,
  expected: StoredAuthoritySnapshotContext,
): StoredAuthoritySnapshotResult {
  const unavailable = (
    reason: Extract<StoredAuthoritySnapshotResult, { status: 'UNAVAILABLE' }>['reason'],
  ): StoredAuthoritySnapshotResult => ({ status: 'UNAVAILABLE', reason });
  try {
    const context = contextSchema.safeParse(expected);
    if (!context.success || !jsonData(value) || !record(value) || !record(value.payload))
      return unavailable('MALFORMED_SNAPSHOT');
    const raw = value.payload;
    if (record(raw.evidence)) {
      for (const key of ['facts', 'sources']) {
        const rows = raw.evidence[key];
        if (Array.isArray(rows) && rows.length > AUTHORITY_HISTORY_FACT_LIMIT)
          return unavailable('RESOURCE_LIMIT');
      }
    }
    // Hash the original JSON bytes' meaning before UUID/date hydration.
    if (Buffer.byteLength(canonicalizeJson(raw), 'utf8') > AUTHORITY_SNAPSHOT_BYTE_LIMIT)
      return unavailable('RESOURCE_LIMIT');
    if (record(raw.evidence)) {
      for (const key of ['facts', 'sources']) {
        const rows = raw.evidence[key];
        if (
          Array.isArray(rows) &&
          rows.some(
            (row) =>
              record(row) &&
              record(row.payload) &&
              Buffer.byteLength(canonicalizeJson(row.payload), 'utf8') > 16384,
          )
        )
          return unavailable('RESOURCE_LIMIT');
      }
    }
    const outer = z
      .strictObject({ snapshotVersion: digest, payload: z.record(z.string(), z.json()) })
      .safeParse(value);
    if (!outer.success) return unavailable('MALFORMED_SNAPSHOT');
    if (
      (typeof raw.schemaVersion === 'string' && raw.schemaVersion !== '1.0.0') ||
      (typeof raw.readerVersion === 'string' && raw.readerVersion !== 'zone-authority-history-v1')
    )
      return unavailable('UNSUPPORTED_SNAPSHOT_VERSION');
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return unavailable('MALFORMED_SNAPSHOT');
    if (
      outer.data.snapshotVersion !== context.data.snapshotVersion ||
      computeCanonicalPayloadHash(raw) !== context.data.snapshotVersion
    )
      return unavailable('SNAPSHOT_DIGEST_MISMATCH');
    const saved = parsed.data;
    const capturedAt = new Date(saved.capturedAt),
      readAt = new Date(saved.readAt);
    if (
      saved.epoch.siteId !== saved.scope.siteId ||
      new Date(saved.epoch.startedAt) > capturedAt ||
      capturedAt > readAt ||
      saved.evidence.facts.some((f) => new Date(f.recordedAt) > readAt)
    )
      return unavailable('MALFORMED_SNAPSHOT');
    if (
      saved.scope.siteId !== context.data.siteId ||
      saved.scope.zoneId !== context.data.zoneId ||
      saved.scope.workerId !== context.data.workerId ||
      capturedAt.getTime() !== context.data.capturedAt.getTime() ||
      saved.purpose !== context.data.purpose
    )
      return unavailable('SNAPSHOT_BINDING_MISMATCH');
    const selection = selectAuthorityHistory(
      {
        sources: saved.evidence.sources,
        facts: saved.evidence.facts.map((f) => ({
          ...f,
          recordedAt: new Date(f.recordedAt),
          effectiveFrom: new Date(f.effectiveFrom),
          effectiveTo: f.effectiveTo === null ? null : new Date(f.effectiveTo),
        })),
      },
      capturedAt,
    );
    if (selection.status !== 'SELECTED')
      return unavailable(
        selection.reason === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'MALFORMED_SNAPSHOT',
      );
    const projected = projectSelectedZoneAuthority(selection.selected, saved.scope);
    if (projected.status !== 'PROJECTED') return unavailable('SNAPSHOT_PROJECTION_MISMATCH');
    // The shared projector creates typed Dates; convert only its own output for wire comparison.
    const projectionJson: unknown = JSON.parse(JSON.stringify(projected.projection));
    if (
      canonicalizeJson(projected.scope) !== canonicalizeJson(saved.scope) ||
      canonicalizeJson(projectionJson) !== canonicalizeJson(saved.policyProjection) ||
      projected.restrictionPolicy !== saved.restrictionPolicy ||
      canonicalizeJson(projected.eligibility) !== canonicalizeJson(saved.eligibility)
    )
      return unavailable('SNAPSHOT_PROJECTION_MISMATCH');
    return {
      status: 'VALID',
      snapshot: { ...projected.projection, snapshotVersion: context.data.snapshotVersion },
      restrictionPolicy: projected.restrictionPolicy,
      capturedAt,
      readAt,
      purpose: saved.purpose,
    };
  } catch {
    // This is a pure decoder: only parsing/canonicalization errors occur here, no driver errors.
    return unavailable('MALFORMED_SNAPSHOT');
  }
}
