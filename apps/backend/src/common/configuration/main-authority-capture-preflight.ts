import type { EntityManager } from 'typeorm';
import { AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS } from './authorization-history-cutover-bodies-v1.js';
import { MAIN_AUTHORITY_V2_SOURCES as MAIN_AUTHORITY_SOURCES } from './main-team-authority-sources.js';
import { MAIN_AUTHORITY_V2_FUNCTION_PROFILES } from './main-team-authority-function-profiles.js';
import { ZONE_ENTRY_STORAGE_FUNCTIONS } from './zone-entry-storage-profile-v1.js';

const MAIN_AUTHORITY_FUNCTION_PROFILES = MAIN_AUTHORITY_V2_FUNCTION_PROFILES.map((profile) => ({
  ...profile,
  body_sha256:
    ZONE_ENTRY_STORAGE_FUNCTIONS.find((f) => f.name === profile.name)?.after ?? profile.body_sha256,
}));

const CUTOVER_FUNCTION_PROFILES = [
  ...MAIN_AUTHORITY_FUNCTION_PROFILES.map((profile) =>
    profile.name === 'mf06_authority_epoch_guard'
      ? {
          ...profile,
          search_path: true,
          owned_path: true,
          body_sha256: AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_epoch_guard.after,
        }
      : profile,
  ),
  {
    name: 'mf06_authority_control_guard',
    arguments: '',
    return_type: 'trigger',
    language: 'plpgsql',
    volatility: 'v',
    search_path: true,
    owned_path: true,
    utc: false,
    body_sha256: AUTHORIZATION_HISTORY_CUTOVER_FUNCTIONS.mf06_authority_control_guard.after,
  },
];

/** Point-in-time canonical trigger/source/function preflight, not writer closure or cutover. */
export async function hasMainAuthorityCapture(
  manager: EntityManager,
  tables: readonly string[] = MAIN_AUTHORITY_SOURCES.map(([, table]) => table),
): Promise<boolean> {
  const sources = MAIN_AUTHORITY_SOURCES.filter(([, table]) => tables.includes(table));
  if (!sources.length || sources.length !== tables.length) return false;
  const [result]: { valid: boolean }[] = await manager.query(
    `
    WITH sources AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS s(table_name text,source_kind text,fields text[])
    ),
    capability AS (
      SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND p.proname='mf06_authority_control_guard')
        OR EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=current_schema() AND c.relname='authorization_history_control' AND t.tgname='trg_mf06_authority_control_update') AS cutover
    ),
    functions AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS f(name text,arguments text,return_type text,
        language text,volatility text,search_path boolean,owned_path boolean,utc boolean,body_sha256 text[],cutover boolean)
      WHERE f.cutover=(SELECT cutover FROM capability)
    ),
    expected AS (
      -- pg_trigger event bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
      SELECT table_name,'trg_mf06_capture_'||table_name AS trigger_name,
        'mf06_capture_main_authority' AS function_name,29 AS trigger_type,1 AS nargs,
        encode(convert_to(source_kind,'UTF8'),'hex')||'00' AS arguments FROM sources
      UNION ALL SELECT table_name,'trg_mf06_truncate_'||table_name,
        'mf06_capture_main_authority',32,1,encode(convert_to(source_kind,'UTF8'),'hex')||'00' FROM sources
      UNION ALL VALUES
        ('authorization_history_command','trg_mf06_authority_command_insert','mf06_authority_command_guard',7,0,''),
        ('authorization_history_commit_receipt','trg_mf06_authority_witness_insert','mf06_authority_witness_guard',7,0,'')
      UNION ALL SELECT * FROM (VALUES
        ('authorization_history_control','trg_mf06_authority_control_update','mf06_authority_control_guard',17,0,''),
        ('authorization_history_control','trg_mf06_authority_control_delete','mf06_authority_immutable',11,0,''),
        ('authorization_history_control','trg_mf06_authority_control_truncate','mf06_authority_immutable',34,0,''),
        ('authorization_history_epoch','trg_mf06_authority_epoch_guard','mf06_authority_epoch_guard',23,0,''),
        ('authorization_history_epoch','trg_mf06_authority_epoch_delete','mf06_authority_immutable',11,0,''),
        ('authorization_history_epoch','trg_mf06_authority_epoch_truncate','mf06_authority_immutable',34,0,''),
        ('authorization_history_baseline','trg_mf06_baseline_insert','mf06_authority_baseline_capture',7,0,''),
        ('authorization_history_baseline','trg_mf06_baseline_link','mf06_authority_baseline_link',5,0,'')
      ) cutover_triggers WHERE (SELECT cutover FROM capability)
    )
    SELECT current_setting('session_replication_role')='origin' AND
      -- Match every journal function, including helpers used by capture/baseline
      -- and response guards. Same-name overloads cannot silently change dispatch.
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND p.proname IN (SELECT name FROM functions))
        =(SELECT count(*) FROM functions) AND
      (SELECT count(*) FROM functions f
        JOIN pg_proc p ON p.proname=f.name
        JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname=current_schema()
        JOIN pg_language l ON l.oid=p.prolang AND l.lanname=f.language
        WHERE p.prokind='f' AND oidvectortypes(p.proargtypes)=f.arguments
          AND p.prorettype=f.return_type::regtype AND p.provolatile::text=f.volatility
          AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.proparallel='u' AND p.prosupport=0 AND p.provariadic=0
          AND p.proargmodes IS NULL AND p.proallargtypes IS NULL
          AND p.pronargdefaults=0 AND p.proargdefaults IS NULL
          AND COALESCE(p.proconfig,ARRAY[]::text[])=
            (CASE WHEN f.owned_path THEN ARRAY['search_path='||format('%I, pg_catalog, pg_temp',current_schema())]
              WHEN f.search_path THEN ARRAY['search_path='||current_setting('search_path')]
              ELSE ARRAY[]::text[] END ||
             CASE WHEN f.utc THEN ARRAY['TimeZone=UTC'] ELSE ARRAY[]::text[] END)
          AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=ANY(f.body_sha256))
        =(SELECT count(*) FROM functions) AND
      NOT EXISTS (
        -- Capture reads this registry to construct before/after payloads. A valid
        -- trigger profile alone cannot prevent omitted authority or secret fields.
        SELECT 1 FROM sources s LEFT JOIN authorization_history_source r ON r.source_kind=s.source_kind
        WHERE r.table_name IS DISTINCT FROM s.table_name OR r.fields IS DISTINCT FROM s.fields
          OR r.protocol_version IS DISTINCT FROM 'MAIN_ROW_JOURNAL_V1'
      ) AND
      count(*)=(SELECT count(*) FROM expected) AS valid
    FROM expected e
    JOIN pg_class c ON c.relname=e.table_name AND c.relkind='r'
    JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname=current_schema()
    JOIN pg_trigger t ON t.tgrelid=c.oid AND t.tgname=e.trigger_name
      AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
      AND t.tgtype=e.trigger_type AND t.tgnargs=e.nargs AND encode(t.tgargs,'hex')=e.arguments
      AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgconstraint=0
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
    JOIN pg_proc p ON p.oid=t.tgfoid AND p.proname=e.function_name AND p.pronamespace=n.oid
      AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype`,
    [
      JSON.stringify(
        sources.map(([source_kind, table_name, fields]) => ({ source_kind, table_name, fields })),
      ),
      JSON.stringify([
        ...MAIN_AUTHORITY_FUNCTION_PROFILES.map((profile) => ({ ...profile, cutover: false })),
        ...CUTOVER_FUNCTION_PROFILES.map((profile) => ({ ...profile, cutover: true })),
      ]),
    ],
  );
  return result?.valid === true;
}
