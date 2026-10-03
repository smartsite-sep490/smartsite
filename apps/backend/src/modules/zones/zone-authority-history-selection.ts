import type {
  AuthorityHistoryEvidence,
  AuthorityHistoryRow,
} from './zone-authority-reader.port.js';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AUTHORITY_SNAPSHOT_BYTE_LIMIT,
} from './zone-authority-reader.port.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { z } from 'zod';
import { parseZoneAuthorityFact } from './zone-authority-history.js';
import { ZoneAuthoritySourceKind } from '../../database/entities/index.js';

export type HistorySelection =
  | { status: 'SELECTED'; evidence: AuthorityHistoryEvidence; selected: AuthorityHistoryRow[] }
  | {
      status: 'UNAVAILABLE';
      reason: 'RESOURCE_LIMIT' | 'MALFORMED_HISTORY' | 'INCOMPLETE_HISTORY';
    };

const id = z.uuid().transform((value) => value.toLowerCase());
const date = z.date().refine((value) => Number.isFinite(value.getTime()));
const sourceFields = {
  sourceKind: z.enum(ZoneAuthoritySourceKind),
  sourceId: id,
  siteId: id.nullable(),
  payload: z.record(z.string(), z.json()),
};
const sourceSchema = z.strictObject(sourceFields);
const rowSchema = z.strictObject({
  ...sourceFields,
  id,
  commandId: id,
  revision: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  recordedAt: date,
  effectiveFrom: date,
  effectiveTo: date.nullable(),
});
const evidenceSchema = z.strictObject({
  facts: z.array(rowSchema),
  sources: z.array(sourceSchema),
});

export function authorityPayloadHash(payload: Record<string, unknown>): string {
  const normalized = { ...payload };
  for (const key of ['validFrom', 'validUntil', 'revokedAt']) {
    if (typeof normalized[key] === 'string')
      normalized[key] = new Date(normalized[key]).toISOString();
  }
  return computeCanonicalPayloadHash(normalized);
}

/** Checks source closure, not identity/cutover. Caller supplies one stable database view. */
export function selectAuthorityHistory(input: unknown, at: Date): HistorySelection {
  const unavailable = (
    reason: 'RESOURCE_LIMIT' | 'MALFORMED_HISTORY' | 'INCOMPLETE_HISTORY',
  ): HistorySelection => ({ status: 'UNAVAILABLE', reason });
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    return unavailable('MALFORMED_HISTORY');
  try {
    if (input && typeof input === 'object') {
      const value = input as { facts?: unknown; sources?: unknown };
      if (
        (Array.isArray(value.facts) && value.facts.length > AUTHORITY_HISTORY_FACT_LIMIT) ||
        (Array.isArray(value.sources) && value.sources.length > AUTHORITY_HISTORY_FACT_LIMIT)
      )
        return unavailable('RESOURCE_LIMIT');
    }
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > AUTHORITY_SNAPSHOT_BYTE_LIMIT)
      return unavailable('RESOURCE_LIMIT');
    const parsed = evidenceSchema.safeParse(input);
    if (!parsed.success) return unavailable('MALFORMED_HISTORY');
    const sources = parsed.data.sources.map((source) => {
      const fact = parseZoneAuthorityFact({
        ...source,
        effectiveFrom: new Date(0),
        effectiveTo: null,
      });
      return {
        sourceKind: fact.sourceKind,
        sourceId: fact.sourceId,
        siteId: fact.siteId,
        payload: fact.payload,
      };
    });
    const facts: AuthorityHistoryRow[] = parsed.data.facts.map((row) => ({
      ...parseZoneAuthorityFact({
        sourceKind: row.sourceKind,
        sourceId: row.sourceId,
        siteId: row.siteId,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        payload: row.payload,
      }),
      id: row.id,
      commandId: row.commandId,
      revision: row.revision,
      recordedAt: row.recordedAt,
    }));
    const key = (source: { sourceKind: string; sourceId: string }) =>
      `${source.sourceKind}:${source.sourceId}`;
    const inventory = new Map(sources.map((source) => [key(source), source]));
    if (
      inventory.size !== sources.length ||
      new Set(facts.map((fact) => fact.id)).size !== facts.length
    )
      return unavailable('MALFORMED_HISTORY');
    facts.sort(
      (a, b) =>
        key(a).localeCompare(key(b)) ||
        (BigInt(a.revision) < BigInt(b.revision)
          ? -1
          : BigInt(a.revision) > BigInt(b.revision)
            ? 1
            : 0),
    );
    const groups = new Map<string, AuthorityHistoryRow[]>();
    for (const fact of facts) {
      const sourceKey = key(fact);
      if (!inventory.has(sourceKey)) return unavailable('INCOMPLETE_HISTORY');
      const group = groups.get(sourceKey) ?? [];
      const previous = group[group.length - 1];
      if (
        BigInt(fact.revision) !== BigInt(group.length) + 1n ||
        (previous &&
          (fact.effectiveFrom < previous.effectiveFrom || fact.recordedAt < previous.recordedAt))
      )
        return unavailable('INCOMPLETE_HISTORY');
      group.push(fact);
      groups.set(sourceKey, group);
    }
    const selected: AuthorityHistoryRow[] = [];
    for (const [sourceKey, source] of inventory) {
      const group = groups.get(sourceKey);
      const latest = group?.[group.length - 1];
      if (
        !latest ||
        latest.siteId !== source.siteId ||
        authorityPayloadHash(latest.payload) !== authorityPayloadHash(source.payload)
      )
        return unavailable('INCOMPLETE_HISTORY');
      const state = group!.filter((fact) => fact.effectiveFrom <= at).at(-1);
      // An expired latest state does not resurrect an older state with an open end.
      if (state && (state.effectiveTo === null || at < state.effectiveTo)) selected.push(state);
    }
    sources.sort((a, b) => key(a).localeCompare(key(b)));
    return { status: 'SELECTED', evidence: { facts, sources }, selected };
  } catch {
    // Only pure parsing/canonicalization errors are mapped here, never driver SQLSTATEs.
    return unavailable('MALFORMED_HISTORY');
  }
}
