import type { EntityManager } from 'typeorm';
import {
  parseMainAuthorityInstant,
  type MainAuthorityArchive,
} from './main-authority-archive-codec.js';

const RAW_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/;
const TEMPORAL_BOUNDARY_FIELDS = [
  'valid_from',
  'valid_until',
  'revoked_at',
  'joined_at',
  'left_at',
] as const;

export function parseAuthorityInstantNanoseconds(value: string): bigint | null {
  const match = RAW_INSTANT_PATTERN.exec(value);
  if (!match) return null;
  const rawZone = match[3]!;
  const zone =
    rawZone === 'Z' || rawZone.includes(':')
      ? rawZone
      : `${rawZone.slice(0, 3)}:${rawZone.slice(3)}`;
  if (zone === '-00:00') return null;
  const wholeMicros = parseMainAuthorityInstant(`${match[1]}${zone}`);
  if (wholeMicros === null) return null;
  return wholeMicros * 1000n + BigInt((match[2] ?? '').padEnd(9, '0'));
}

export function resolveSameMillisecondCaptureWindow(
  canonicalCapturedAt: string,
  rawCapturedAt: string,
): { canonicalNs: bigint; rawNs: bigint } | null {
  const canonicalMicros = parseMainAuthorityInstant(canonicalCapturedAt);
  if (canonicalMicros === null || canonicalMicros % 1000n !== 0n) {
    return null;
  }
  const canonicalNs = canonicalMicros * 1000n;
  const rawNs = parseAuthorityInstantNanoseconds(rawCapturedAt);
  if (rawNs === null || rawNs < canonicalNs || rawNs - canonicalNs >= 1_000_000n) {
    return null;
  }
  return { canonicalNs, rawNs };
}

function hasTemporalBoundaryInWindow(
  archive: MainAuthorityArchive,
  canonicalNs: bigint,
  rawNs: bigint,
): boolean {
  for (const source of archive.payload.sources) {
    for (const row of source.rows) {
      for (const field of TEMPORAL_BOUNDARY_FIELDS) {
        const value = row[field];
        if (typeof value !== 'string') continue;
        const micros = parseMainAuthorityInstant(value);
        if (micros === null) return true;
        const boundaryNs = micros * 1000n;
        if (boundaryNs > canonicalNs && boundaryNs <= rawNs) return true;
      }
    }
  }
  return false;
}

/**
 * Interval bridge only; does not independently establish authority coverage or Worker identity.
 * Caller must first succeed `MainQualifiedAuthorityReader.revalidate` in the same active 20-table fenced SERIALIZABLE TX.
 */
export async function verifySubMillisecondAuthorityBridgeInTx(
  manager: EntityManager,
  archive: MainAuthorityArchive,
  rawCapturedAt: string,
): Promise<boolean> {
  if (!manager?.queryRunner?.isTransactionActive) return false;
  const canonicalCapturedAt = archive?.payload?.context?.capturedAt;
  const epochId = archive?.payload?.baseline?.epochId;
  if (
    typeof canonicalCapturedAt !== 'string' ||
    typeof epochId !== 'string' ||
    !Array.isArray(archive?.payload?.sources)
  ) {
    return false;
  }
  const window = resolveSameMillisecondCaptureWindow(canonicalCapturedAt, rawCapturedAt);
  if (!window) return false;
  if (window.rawNs === window.canonicalNs) return true;
  if (hasTemporalBoundaryInWindow(archive, window.canonicalNs, window.rawNs)) return false;
  const [row] = (await manager.query(
    `SELECT
       $3::numeric <= (EXTRACT(EPOCH FROM transaction_timestamp()) * 1000000000)::numeric
         AND $3::numeric <= (EXTRACT(EPOCH FROM statement_timestamp()) * 1000000000)::numeric AS not_future,
       (e.closed_at IS NULL OR $3::numeric < (EXTRACT(EPOCH FROM e.closed_at) * 1000000000)::numeric) AS before_close,
       (e.gapped_at IS NULL OR $3::numeric < (EXTRACT(EPOCH FROM e.gapped_at) * 1000000000)::numeric) AS before_gap,
       NOT EXISTS (
         SELECT 1 FROM authorization_history_revision r
         WHERE (r.epoch_id = e.epoch_id OR r.observed_at >= b.captured_at)
           AND (EXTRACT(EPOCH FROM r.observed_at) * 1000000000)::numeric > $2::numeric
           AND (EXTRACT(EPOCH FROM r.observed_at) * 1000000000)::numeric <= $3::numeric
       ) AS no_revision,
       NOT EXISTS (
         SELECT 1 FROM authorization_history_gap g
         WHERE (g.epoch_id = e.epoch_id OR g.observed_at >= b.captured_at)
           AND (EXTRACT(EPOCH FROM g.observed_at) * 1000000000)::numeric > $2::numeric
           AND (EXTRACT(EPOCH FROM g.observed_at) * 1000000000)::numeric <= $3::numeric
       ) AS no_gap
     FROM authorization_history_epoch e
     JOIN authorization_history_baseline b USING (epoch_id)
     WHERE e.epoch_id = $1`,
    [epochId, window.canonicalNs.toString(), window.rawNs.toString()],
  )) as Array<Record<string, boolean>>;
  return Boolean(
    row?.not_future && row.before_close && row.before_gap && row.no_revision && row.no_gap,
  );
}
