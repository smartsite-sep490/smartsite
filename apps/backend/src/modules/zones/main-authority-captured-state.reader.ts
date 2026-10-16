import type { EntityManager } from 'typeorm';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { z } from 'zod';
import { MAIN_AUTHORITY_V2_SOURCES as MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-team-authority-sources.js';
import { hasMainAuthorityCapture } from '../../common/configuration/main-authority-capture-preflight.js';
import {
  MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
  parseMainAuthorityInstant,
  sealMainAuthorityArchive,
  type MainAuthorityArchive,
  type MainAuthorityArchiveContext,
} from './main-authority-archive-codec.js';

// Bound data read into Node independently of the final archive size.
const LIMIT = 2048,
  READ_BYTES = 2 * 1024 * 1024;
const inputSchema = z.strictObject({
  epochId: z.uuid(),
  siteId: z.uuid(),
  zoneId: z.uuid(),
  workerId: z.uuid().nullable(),
  capturedAt: z
    .string()
    .max(40)
    .refine((v) => parseMainAuthorityInstant(v) !== null),
  purpose: z.enum(['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW']),
});
export type MainCapturedStateInput = MainAuthorityArchiveContext & { epochId: string };
export type MainCapturedStateResult =
  | { status: 'UNAVAILABLE'; reason: string }
  | {
      status: 'RECONSTRUCTED';
      archive: MainAuthorityArchive;
      authorityCoverageEstablished: false;
      identityEstablished: false;
    };
type Sources = MainAuthorityArchive['payload']['sources'];
interface Baseline {
  epoch_id: string;
  captured_at: string;
  writer_manifest_hash: string;
  source_registry_hash: string;
  snapshot_hash: string;
  snapshot_text: string;
  archived_at: string;
  row_count: number;
  baseline_hash_valid: boolean;
  registry_hash_valid: boolean;
  origin_valid: boolean;
  witness_known: boolean;
  before_baseline: boolean;
  future: boolean;
}
interface Fact {
  fact_id: string;
  source_kind: string;
  source_id: string;
  revision: string;
  base_revision: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  before_text: string | null;
  after_text: string | null;
  known: boolean;
  hashes_valid: boolean;
}
const unavailable = (reason: string): MainCapturedStateResult => ({
  status: 'UNAVAILABLE',
  reason,
});

/** Internal historical metadata only. Not a permission/identity reader or runtime provider.
 * Reconstruction does not certify writer coverage, activate an epoch or grant entry.
 * Caller owns authorization and the SERIALIZABLE READ ONLY transaction lifetime.
 */
export class MainAuthorityCapturedStateReader {
  async read(
    manager: EntityManager,
    input: MainCapturedStateInput,
  ): Promise<MainCapturedStateResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return unavailable('INVALID_SCOPE');
    const scope = parsed.data;
    if (!manager.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    const [settings]: { isolation: string; readonly: string; after_transaction_start: boolean }[] =
      await manager.query(
        "SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly,$1::timestamptz>transaction_timestamp() AS after_transaction_start",
        [scope.capturedAt],
      );
    if (settings?.isolation !== 'serializable') return unavailable('SNAPSHOT_TRANSACTION_REQUIRED');
    if (settings.readonly !== 'on') return unavailable('READ_ONLY_TRANSACTION_REQUIRED');
    // MVCC can predate statement_timestamp() in a caller-held transaction.
    // Never reconstruct an observation made after that transaction began.
    if (settings.after_transaction_start) return unavailable('OBSERVATION_AFTER_TRANSACTION_START');
    await manager.query("SET LOCAL statement_timeout='1500ms'");
    const registry: {
      source_kind: string;
      table_name: string;
      fields: string[];
      protocol_version: string;
    }[] = await manager.query(
      'SELECT source_kind,table_name,fields,protocol_version FROM mf06_authority_source ORDER BY source_kind COLLATE "C"',
    );
    const expected = MAIN_AUTHORITY_SOURCES.map(([kind, table, fields]) => ({
      source_kind: kind,
      table_name: table,
      fields: [...fields],
      protocol_version: 'MAIN_ROW_JOURNAL_V1',
    })).sort((a, b) => (a.source_kind < b.source_kind ? -1 : 1));
    if (computeCanonicalPayloadHash(registry) !== computeCanonicalPayloadHash(expected))
      return unavailable('SOURCE_REGISTRY_MISMATCH');
    if (!(await hasMainAuthorityCapture(manager))) return unavailable('CAPTURE_UNAVAILABLE');
    const [baseline]: Baseline[] = await manager.query(
      `
      SELECT b.epoch_id,to_char(b.captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS captured_at,
        to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS archived_at,
        e.writer_manifest_hash,b.source_registry_hash,b.snapshot_hash,b.snapshot_json::text AS snapshot_text,b.row_count,
        b.hash_algorithm='POSTGRES_JSONB_TEXT_SHA256_V1' AND b.snapshot_hash=encode(sha256(convert_to(b.snapshot_json::text,'UTF8')),'hex') AS baseline_hash_valid,
        b.source_registry_hash=(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY source_kind COLLATE "C")::text,'UTF8')),'hex') FROM mf06_authority_source s) AS registry_hash_valid,
        b.transaction_id=c.transaction_id AND c.operation='MAIN_AUTHORITY_BASELINE' AND b.captured_at=e.baseline_at AS origin_valid,
        COALESCE(w.transaction_id=c.transaction_id AND w.confirmed_at<=$2::timestamptz,false) AS witness_known,
        $2::timestamptz<b.captured_at AS before_baseline,$2::timestamptz>statement_timestamp() AS future
      FROM mf06_authority_baseline b JOIN mf06_authority_epoch e USING(epoch_id)
      JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id)
      WHERE b.epoch_id=$1`,
      [scope.epochId, scope.capturedAt],
    );
    if (!baseline) return unavailable('BASELINE_UNAVAILABLE');
    if (baseline.future) return unavailable('FUTURE_OBSERVATION');
    if (baseline.before_baseline) return unavailable('PRE_BASELINE');
    if (!baseline.origin_valid || !baseline.baseline_hash_valid || !baseline.registry_hash_valid)
      return unavailable('BASELINE_INTEGRITY_UNAVAILABLE');
    if (!baseline.witness_known) return unavailable('COMMIT_TIME_UNCERTAIN');
    const base = JSON.parse(baseline.snapshot_text) as {
      version: string;
      epochId: string;
      capturedAt: string;
      declaredWriterManifestHash: string;
      sourceRegistryHash: string;
      sources: Sources;
    };
    const [roundtrip]: { exact: boolean }[] = await manager.query(
      'SELECT snapshot_json=$2::jsonb AS exact FROM mf06_authority_baseline WHERE epoch_id=$1',
      [scope.epochId, JSON.stringify(base)],
    );
    if (
      !roundtrip?.exact ||
      base.version !== 'MF06_MAIN_BASELINE_JSONB_V1' ||
      base.epochId !== baseline.epoch_id ||
      base.capturedAt !== baseline.captured_at ||
      base.declaredWriterManifestHash !== baseline.writer_manifest_hash ||
      base.sourceRegistryHash !== baseline.source_registry_hash
    )
      return unavailable('BASELINE_INTEGRITY_UNAVAILABLE');
    const context: MainAuthorityArchiveContext = {
      siteId: scope.siteId,
      zoneId: scope.zoneId,
      workerId: scope.workerId,
      capturedAt: scope.capturedAt,
      purpose: scope.purpose,
    };
    const payload = {
      version: MAIN_AUTHORITY_ARCHIVE_FORMAT_V2,
      context,
      archivedAt: baseline.archived_at,
      baseline: {
        epochId: baseline.epoch_id,
        capturedAt: baseline.captured_at,
        declaredWriterManifestHash: baseline.writer_manifest_hash,
        sourceRegistryHash: baseline.source_registry_hash,
        snapshotHash: baseline.snapshot_hash,
      },
      sources: base.sources,
    };
    // Validate baseline shape/scope before traversing unbounded or untrusted data.
    const initial = sealMainAuthorityArchive(payload, context);
    if (initial.status !== 'VALID') return unavailable(initial.reason);
    if (base.sources.reduce((sum, s) => sum + s.rows.length, 0) !== baseline.row_count)
      return unavailable('BASELINE_INTEGRITY_UNAVAILABLE');
    const gaps = await manager.query(
      'SELECT 1 FROM mf06_authority_gap WHERE observed_at>$1::timestamptz AND observed_at<=$2::timestamptz LIMIT 1',
      [baseline.captured_at, scope.capturedAt],
    );
    if (gaps.length) return unavailable('HISTORY_GAP');
    const [budget]: { n: number; bytes: string }[] = await manager.query(
      `
      WITH selected AS (SELECT before_payload,after_payload FROM mf06_authority_fact
        WHERE observed_at>$1::timestamptz AND observed_at<=$2::timestamptz LIMIT 2049)
      SELECT count(*)::int AS n,COALESCE(sum(COALESCE(octet_length(before_payload::text),0)+COALESCE(octet_length(after_payload::text),0)),0)::text AS bytes FROM selected`,
      [baseline.captured_at, scope.capturedAt],
    );
    if (
      !budget ||
      budget.n > LIMIT ||
      BigInt(budget.bytes) + BigInt(Buffer.byteLength(baseline.snapshot_text, 'utf8')) >
        BigInt(READ_BYTES)
    )
      return unavailable('RESOURCE_LIMIT');
    // STAGING capture does not activate authority_control. Legitimate later facts
    // can have epoch_id=NULL; filtering by epoch would silently omit mutations.
    const facts: Fact[] = await manager.query(
      `
      SELECT f.fact_id,f.source_kind,f.source_id,f.revision::text,f.operation,
        COALESCE((SELECT max(prior.revision) FROM mf06_authority_fact prior WHERE prior.source_kind=f.source_kind AND prior.source_id=f.source_id AND prior.observed_at<=$1::timestamptz),0)::text AS base_revision,
        f.before_payload::text AS before_text,f.after_payload::text AS after_text,
        COALESCE(c.transaction_id=f.transaction_id AND w.transaction_id=f.transaction_id AND w.confirmed_at>=f.observed_at AND w.confirmed_at<=$2::timestamptz,false) AS known,
        f.hash_algorithm='POSTGRES_JSONB_TEXT_SHA256_V1'
        AND f.before_hash IS NOT DISTINCT FROM CASE WHEN f.before_payload IS NOT NULL THEN encode(sha256(convert_to(f.before_payload::text,'UTF8')),'hex') END
        AND f.after_hash IS NOT DISTINCT FROM CASE WHEN f.after_payload IS NOT NULL THEN encode(sha256(convert_to(f.after_payload::text,'UTF8')),'hex') END AS hashes_valid
      FROM mf06_authority_fact f LEFT JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id)
      WHERE f.observed_at>$1::timestamptz AND f.observed_at<=$2::timestamptz
      ORDER BY f.source_kind COLLATE "C",f.source_id,f.revision LIMIT 2049`,
      [baseline.captured_at, scope.capturedAt],
    );
    const sources = new Map(
      base.sources.map((s) => [
        s.sourceKind,
        { ...s, rows: new Map(s.rows.map((r) => [r.id as string, { ...r }])) },
      ]),
    );
    const revisions = new Map<string, bigint>();
    if (facts.some((f) => !f.known)) return unavailable('COMMIT_TIME_UNCERTAIN');
    if (facts.some((f) => !f.hashes_valid)) return unavailable('FACT_INTEGRITY_UNAVAILABLE');
    const documents = facts.map((f) => ({
      fact_id: f.fact_id,
      before_payload:
        f.before_text === null ? null : (JSON.parse(f.before_text) as Record<string, unknown>),
      after_payload:
        f.after_text === null ? null : (JSON.parse(f.after_text) as Record<string, unknown>),
    }));
    if (documents.length) {
      const [exact]: { value: boolean }[] = await manager.query(
        `
        SELECT NOT EXISTS(SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS d(fact_id UUID,before_payload JSONB,after_payload JSONB)
          LEFT JOIN mf06_authority_fact f USING(fact_id)
          WHERE f.fact_id IS NULL OR f.before_payload IS DISTINCT FROM d.before_payload OR f.after_payload IS DISTINCT FROM d.after_payload) AS value`,
        [JSON.stringify(documents)],
      );
      if (!exact?.value) return unavailable('FACT_INTEGRITY_UNAVAILABLE');
    }
    for (const [index, fact] of facts.entries()) {
      const source = sources.get(fact.source_kind);
      if (!source) return unavailable('SOURCE_REGISTRY_MISMATCH');
      const key = fact.source_kind + '/' + fact.source_id,
        priorRevision = revisions.get(key) ?? BigInt(fact.base_revision);
      if (BigInt(fact.revision) !== priorRevision + 1n) return unavailable('REVISION_GAP');
      const before = documents[index]!.before_payload,
        after = documents[index]!.after_payload;
      const current = source.rows.get(fact.source_id) ?? null;
      if (computeCanonicalPayloadHash(current) !== computeCanonicalPayloadHash(before))
        return unavailable('SOURCE_CHAIN_MISMATCH');
      if (
        (fact.operation === 'INSERT' && (before !== null || after === null)) ||
        (fact.operation === 'UPDATE' && (before === null || after === null)) ||
        (fact.operation === 'DELETE' && (before === null || after !== null)) ||
        (after !== null && after.id !== fact.source_id)
      )
        return unavailable('SOURCE_CHAIN_MISMATCH');
      if (after === null) source.rows.delete(fact.source_id);
      else source.rows.set(fact.source_id, after);
      revisions.set(key, BigInt(fact.revision));
    }
    const final = sealMainAuthorityArchive(
      {
        ...payload,
        sources: [...sources.values()].map((s) => ({
          ...s,
          rows: [...s.rows.values()].sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1)),
        })),
      },
      context,
    );
    if (final.status !== 'VALID') return unavailable(final.reason);
    return {
      status: 'RECONSTRUCTED',
      archive: final.archive,
      authorityCoverageEstablished: false,
      identityEstablished: false,
    };
  }
}
