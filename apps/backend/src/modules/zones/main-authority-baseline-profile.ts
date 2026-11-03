import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-authority-sources.js';

type Registry = readonly (readonly [string, string, readonly string[]])[];

/** Select only known frozen masks; row contents still require archive validation. */
export function baselineSourceProfile(
  sources: unknown,
  installed: Registry,
): 'V1' | 'CURRENT' | null {
  if (!Array.isArray(sources) || sources.length > installed.length) return null;
  const masks: [string, string, string[]][] = [];
  for (const source of sources) {
    if (
      !source ||
      typeof source !== 'object' ||
      typeof source.sourceKind !== 'string' ||
      typeof source.tableName !== 'string' ||
      !Array.isArray(source.fields) ||
      !source.fields.every((field: unknown) => typeof field === 'string')
    )
      return null;
    masks.push([source.sourceKind, source.tableName, source.fields]);
  }
  if (new Set(masks.map(([kind]) => kind)).size !== masks.length) return null;
  const digest = (registry: Registry) =>
    computeCanonicalPayloadHash([...registry].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const actual = digest(masks);
  if (actual === digest(MAIN_AUTHORITY_SOURCES)) return 'V1';
  return actual === digest(installed) ? 'CURRENT' : null;
}

// The immutable snapshot carries its historical registry; today's registry may have advanced.
// Callers separately validate installed capture and select an exact known snapshot mask above.
export const BASELINE_REGISTRY_HASH_VALID_SQL = `b.source_registry_hash=(
  SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_object(
    'source_kind',s->>'sourceKind','table_name',s->>'tableName',
    'fields',s->'fields','protocol_version','MAIN_ROW_JOURNAL_V1'
  ) ORDER BY s->>'sourceKind' COLLATE "C")::text,'UTF8')),'hex')
  FROM jsonb_array_elements(b.snapshot_json->'sources') s
)`;
