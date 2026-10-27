import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-authority-sources.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';

// Versioned inputs are frozen with this additive migration; never extend V1 in place.
const sources = MAIN_AUTHORITY_V2_SOURCES;
const registry = JSON.stringify(
  sources
    .map(([source_kind, table_name, fields]) => ({
      source_kind,
      table_name,
      fields,
      protocol_version: 'MAIN_ROW_JOURNAL_V1',
    }))
    .sort((a, b) => (a.source_kind < b.source_kind ? -1 : 1)),
).replaceAll("'", "''");
const projections = sources
  .map(
    ([kind, table, fields]) =>
      `SELECT '${kind}'::text AS kind,jsonb_build_object('sourceKind','${kind}','tableName','${table}',
  'fields','${JSON.stringify(fields)}'::jsonb,'rows',COALESCE(jsonb_agg(
  jsonb_build_object(${fields.map((field) => `'${field}',${field}`).join(',')}) ORDER BY id),'[]'::jsonb)) AS doc FROM ${table}`,
  )
  .join(' UNION ALL ');
const mask = (items: readonly (readonly [string, string, readonly string[]])[]) =>
  JSON.stringify(
    items.map(([sourceKind, tableName, fields]) => ({ sourceKind, tableName, fields })),
  ).replaceAll("'", "''");
const artifactV1 = mask(MAIN_AUTHORITY_SOURCES),
  artifactV2 = mask(sources);

export const TEAM_BASELINE_CAPTURE_BODY = `
      DECLARE c mf06_authority_command%ROWTYPE;e mf06_authority_epoch%ROWTYPE;
        registry JSONB;body JSONB;row_total BIGINT;enabled INTEGER;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id() OR c.operation<>'MAIN_AUTHORITY_BASELINE'
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text THEN
          RAISE EXCEPTION 'Baseline has no matching origin transaction' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM app_user u JOIN user_role_assignment a ON a.user_id=u.id
          WHERE u.id=c.actor_user_id AND u.is_active AND NOT u.must_change_password
            AND a.role='ADMIN' AND a.site_id IS NULL FOR SHARE OF u,a;
        IF NOT FOUND THEN RAISE EXCEPTION 'Baseline actor unavailable' USING ERRCODE='23514';END IF;
        SELECT * INTO e FROM mf06_authority_epoch WHERE epoch_id=NEW.epoch_id FOR UPDATE;
        IF NOT FOUND OR e.state<>'STAGING' OR e.baseline_at IS NOT NULL THEN
          RAISE EXCEPTION 'Baseline requires a fresh staging epoch' USING ERRCODE='23514';END IF;
        LOCK TABLE ${sources.map(([, table]) => table).join(',')} IN SHARE MODE;
        SELECT jsonb_agg(to_jsonb(s) ORDER BY source_kind COLLATE "C") INTO registry FROM mf06_authority_source s;
        IF registry IS DISTINCT FROM '${registry}'::jsonb THEN
          RAISE EXCEPTION 'Baseline source registry unavailable' USING ERRCODE='55000';END IF;
        SELECT count(*) INTO enabled FROM mf06_authority_source s
          JOIN pg_class r ON r.relname=s.table_name
          JOIN pg_namespace n ON n.oid=r.relnamespace AND n.nspname=current_schema()
          JOIN pg_trigger t ON t.tgrelid=r.oid AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal
            AND t.tgname IN ('trg_mf06_capture_'||s.table_name,'trg_mf06_truncate_'||s.table_name)
          JOIN pg_proc p ON p.oid=t.tgfoid AND p.pronamespace=n.oid AND p.proname='mf06_capture_main_authority';
        IF enabled<>${sources.length * 2} THEN
          RAISE EXCEPTION 'Baseline source capture unavailable' USING ERRCODE='55000';END IF;
        SELECT ${sources.map(([, table]) => `(SELECT count(*) FROM ${table})`).join('+')} INTO row_total;
        IF row_total>2048 THEN RAISE EXCEPTION 'Baseline resource limit' USING ERRCODE='54000';END IF;
        NEW.captured_at:=clock_timestamp();NEW.transaction_id:=pg_current_xact_id();NEW.row_count:=row_total;
        NEW.source_registry_hash:=encode(sha256(convert_to(registry::text,'UTF8')),'hex');
        SELECT jsonb_agg(doc ORDER BY kind COLLATE "C") INTO body FROM (${projections}) projected;
        NEW.snapshot_json:=jsonb_build_object('version','MF06_MAIN_BASELINE_JSONB_V1','epochId',NEW.epoch_id,
          'capturedAt',to_char(NEW.captured_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'declaredWriterManifestHash',e.writer_manifest_hash,'sourceRegistryHash',NEW.source_registry_hash,'sources',body);
        IF octet_length(NEW.snapshot_json::text)>2097152 THEN
          RAISE EXCEPTION 'Baseline resource limit' USING ERRCODE='54000';END IF;
        NEW.snapshot_hash:=encode(sha256(convert_to(NEW.snapshot_json::text,'UTF8')),'hex');
        NEW.hash_algorithm:='POSTGRES_JSONB_TEXT_SHA256_V1';RETURN NEW;
      END `;

export const TEAM_ROW_CAPTURE_BODY = `
      DECLARE kind VARCHAR(32):=TG_ARGV[0]; keys TEXT[]; prior JSONB; following JSONB; sid UUID;
        previous_head mf06_authority_head%ROWTYPE; rev BIGINT; cmd UUID; cmd_text TEXT;
        epoch UUID; gap_reason VARCHAR(32); head_found BOOLEAN; bridge BOOLEAN:=false;
      BEGIN
        SELECT fields INTO keys FROM mf06_authority_source WHERE source_kind=kind AND table_name=TG_TABLE_NAME;
        IF NOT FOUND THEN RAISE EXCEPTION 'Authority source registry mismatch' USING ERRCODE='23514'; END IF;
        SELECT epoch_id INTO epoch FROM mf06_authority_control WHERE singleton=1;
        IF TG_OP='TRUNCATE' THEN
          INSERT INTO mf06_authority_gap(epoch_id,source_kind,source_id,transaction_id,reason)
            VALUES(epoch,kind,NULL,pg_current_xact_id(),'UNCOVERED_TRUNCATE');
          IF epoch IS NOT NULL THEN UPDATE mf06_authority_epoch SET state='GAPPED' WHERE epoch_id=epoch AND state<>'CLOSED'; END IF;
          RETURN NULL;
        END IF;
        IF TG_OP<>'INSERT' THEN
          SELECT jsonb_object_agg(k,to_jsonb(OLD)->k) INTO prior FROM unnest(keys) AS k;
        END IF;
        IF TG_OP<>'DELETE' THEN
          SELECT jsonb_object_agg(k,to_jsonb(NEW)->k) INTO following FROM unnest(keys) AS k;
        END IF;
        IF prior IS NOT DISTINCT FROM following THEN
          IF TG_TABLE_NAME<>'app_user' OR TG_OP<>'UPDATE' THEN RETURN NULL; END IF;
          IF to_jsonb(OLD)->'password_hash' IS NOT DISTINCT FROM to_jsonb(NEW)->'password_hash' THEN RETURN NULL; END IF;
        END IF;
        sid:=(COALESCE(following,prior)->>'id')::uuid;
        cmd_text:=current_setting('smartsite.mf06_command_id',true);
        IF cmd_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
          SELECT command_id INTO cmd FROM mf06_authority_command
            WHERE command_id=cmd_text::uuid AND transaction_id=pg_current_xact_id();
        END IF;
        IF cmd IS NULL THEN gap_reason:='UNATTRIBUTED_WRITE'; END IF;
        SELECT * INTO previous_head FROM mf06_authority_head WHERE source_kind=kind AND source_id=sid FOR UPDATE;
        head_found:=FOUND;
        -- Only bridge newly covered state from a committed V2 baseline, never infer earlier history.
        IF cmd IS NOT NULL AND prior IS NOT NULL AND
          (NOT head_found OR
           (kind='ASSIGNMENT' AND head_found AND NOT (previous_head.after_payload ? 'zone_ids')
            AND previous_head.after_payload=prior-'zone_ids')) THEN
          SELECT EXISTS(SELECT 1 FROM mf06_authority_baseline b
            JOIN mf06_authority_command c USING(command_id)
            JOIN mf06_authority_commit_witness w USING(command_id)
            CROSS JOIN LATERAL jsonb_array_elements(b.snapshot_json->'sources') s
            CROSS JOIN LATERAL jsonb_array_elements(s->'rows') r
            WHERE c.operation='MAIN_AUTHORITY_BASELINE' AND c.transaction_id=b.transaction_id
              AND w.transaction_id=c.transaction_id AND w.confirmed_at<=clock_timestamp()
              AND b.snapshot_hash=encode(sha256(convert_to(b.snapshot_json::text,'UTF8')),'hex')
              AND b.source_registry_hash=(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(x) ORDER BY source_kind COLLATE "C")::text,'UTF8')),'hex') FROM mf06_authority_source x)
              AND s->>'sourceKind'=kind AND s->'fields'=to_jsonb(keys) AND r=prior
              AND NOT EXISTS(SELECT 1 FROM mf06_authority_fact f WHERE f.source_kind=kind AND f.source_id=sid AND f.observed_at>b.captured_at)) INTO bridge;
        END IF;
        IF NOT head_found AND prior IS NOT NULL AND NOT bridge THEN
          gap_reason:=COALESCE(gap_reason,'INITIAL_STATE_UNCAPTURED');
        ELSIF head_found AND previous_head.after_payload IS DISTINCT FROM prior AND NOT bridge THEN
          gap_reason:='SOURCE_HEAD_MISMATCH';
        END IF;
        INSERT INTO mf06_authority_head(source_kind,source_id,revision,after_payload) VALUES(kind,sid,1,following)
          ON CONFLICT(source_kind,source_id) DO UPDATE SET revision=mf06_authority_head.revision+1,after_payload=EXCLUDED.after_payload
          RETURNING revision INTO rev;
        INSERT INTO mf06_authority_fact(source_kind,source_id,revision,epoch_id,command_id,transaction_id,operation,before_payload,after_payload)
          VALUES(kind,sid,rev,epoch,cmd,pg_current_xact_id(),TG_OP,prior,following);
        IF gap_reason IS NOT NULL THEN
          INSERT INTO mf06_authority_gap(epoch_id,source_kind,source_id,transaction_id,reason)
            VALUES(epoch,kind,sid,pg_current_xact_id(),gap_reason);
          IF epoch IS NOT NULL THEN UPDATE mf06_authority_epoch SET state='GAPPED' WHERE epoch_id=epoch AND state<>'CLOSED'; END IF;
        END IF;
        RETURN NULL;
      END `;

const TEAM_ARTIFACT_CAPTURE_BODY = `
DECLARE req mf06_assessment_request%ROWTYPE; p jsonb; ctx jsonb; source jsonb;
        mask jsonb; row_data jsonb; registry jsonb := '${artifactV1}'::jsonb;
        rows_count bigint := 0; seen text[] := '{}';
BEGIN
 IF NEW.body->>'format'='MF06_MAIN_AUTHORITY_ARCHIVE_V2' THEN registry:='${artifactV2}'::jsonb; END IF;
 SELECT * INTO req FROM mf06_assessment_request WHERE request_id=NEW.request_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MF06 archive request absent' USING ERRCODE='23503'; END IF;
 IF jsonb_typeof(NEW.body) IS DISTINCT FROM 'object' OR
    (NEW.body->>'format' IS DISTINCT FROM 'MF06_MAIN_AUTHORITY_ARCHIVE_V1' AND NEW.body->>'format' IS DISTINCT FROM 'MF06_MAIN_AUTHORITY_ARCHIVE_V2') OR
    NEW.body->>'sha256' IS DISTINCT FROM NEW.sha256::text OR
    (SELECT count(*) FROM jsonb_object_keys(NEW.body))<>3 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(NEW.body) k WHERE k NOT IN ('format','sha256','payload')) THEN
   RAISE EXCEPTION 'MF06 archive envelope invalid' USING ERRCODE='23514'; END IF;
 p:=NEW.body->'payload';ctx:=p->'context';
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'version' IS DISTINCT FROM NEW.body->>'format' OR
    (SELECT count(*) FROM jsonb_object_keys(p))<>5 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('version','context','archivedAt','baseline','sources')) OR
    jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ctx))<>5 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(ctx) k WHERE k NOT IN ('siteId','zoneId','workerId','capturedAt','purpose')) OR
    (ctx->>'siteId')::uuid IS DISTINCT FROM req.site_id OR (ctx->>'zoneId')::uuid IS DISTINCT FROM req.zone_id OR
    (ctx->>'capturedAt')::timestamptz IS DISTINCT FROM req.captured_at OR ctx->>'purpose' IS DISTINCT FROM req.requested_purpose OR
    NOT isfinite((ctx->>'capturedAt')::timestamptz) OR
    jsonb_typeof(p->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sources')<>jsonb_array_length(registry) THEN
   RAISE EXCEPTION 'MF06 archive scope or format invalid' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(ctx->'workerId') IS DISTINCT FROM 'string' AND jsonb_typeof(ctx->'workerId') IS DISTINCT FROM 'null' THEN
   RAISE EXCEPTION 'MF06 archive worker reference invalid' USING ERRCODE='23514'; END IF;
 IF ctx->>'workerId' IS NOT NULL THEN PERFORM (ctx->>'workerId')::uuid; END IF;
 IF jsonb_typeof(p->'baseline') IS DISTINCT FROM 'object' OR
    (SELECT count(*) FROM jsonb_object_keys(p->'baseline'))<>5 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p->'baseline') k WHERE k NOT IN ('epochId','capturedAt','declaredWriterManifestHash','sourceRegistryHash','snapshotHash')) OR
    jsonb_typeof(p->'baseline'->'epochId') IS DISTINCT FROM 'string' OR
    jsonb_typeof(p->'baseline'->'capturedAt') IS DISTINCT FROM 'string' OR
    jsonb_typeof(p->'archivedAt') IS DISTINCT FROM 'string' OR
    ((p->'baseline'->>'declaredWriterManifestHash') ~ '^[0-9a-f]{64}$') IS NOT TRUE OR
    ((p->'baseline'->>'sourceRegistryHash') ~ '^[0-9a-f]{64}$') IS NOT TRUE OR
    ((p->'baseline'->>'snapshotHash') ~ '^[0-9a-f]{64}$') IS NOT TRUE OR
    isfinite((p->'baseline'->>'capturedAt')::timestamptz) IS NOT TRUE OR
    isfinite((p->>'archivedAt')::timestamptz) IS NOT TRUE OR
    (p->'baseline'->>'capturedAt')::timestamptz>req.captured_at OR (p->>'archivedAt')::timestamptz<req.captured_at THEN
   RAISE EXCEPTION 'MF06 archive baseline declaration invalid' USING ERRCODE='23514'; END IF;
 PERFORM (p->'baseline'->>'epochId')::uuid;
 FOR source IN SELECT value FROM jsonb_array_elements(p->'sources') LOOP
   SELECT value INTO mask FROM jsonb_array_elements(registry) WHERE value->>'sourceKind'=source->>'sourceKind';
   IF NOT FOUND OR jsonb_typeof(source) IS DISTINCT FROM 'object' OR
      (SELECT count(*) FROM jsonb_object_keys(source))<>4 OR
      EXISTS(SELECT 1 FROM jsonb_object_keys(source) k WHERE k NOT IN ('sourceKind','tableName','fields','rows')) OR
      source->>'sourceKind'=ANY(seen) OR source->>'tableName' IS DISTINCT FROM mask->>'tableName' OR
      source->'fields' IS DISTINCT FROM mask->'fields' OR jsonb_typeof(source->'rows') IS DISTINCT FROM 'array' THEN
     RAISE EXCEPTION 'MF06 archive source mask invalid' USING ERRCODE='23514'; END IF;
   seen:=array_append(seen,source->>'sourceKind'); rows_count:=rows_count+jsonb_array_length(source->'rows');
   IF rows_count>2048 THEN RAISE EXCEPTION 'MF06 archive row budget exceeded' USING ERRCODE='23514'; END IF;
   FOR row_data IN SELECT value FROM jsonb_array_elements(source->'rows') LOOP
     IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' OR
        (SELECT count(*) FROM jsonb_object_keys(row_data))<>jsonb_array_length(mask->'fields') OR
        EXISTS(SELECT 1 FROM jsonb_object_keys(row_data) k WHERE NOT (mask->'fields' ? k)) THEN
       RAISE EXCEPTION 'MF06 archive contains unmasked fields' USING ERRCODE='23514'; END IF;
   END LOOP;
 END LOOP;
 -- This database body hash is distinct from application canonical SHA. No origin/coverage assertion.
 NEW.body_hash:=encode(sha256(convert_to(NEW.body::text,'UTF8')),'hex');
 NEW.stored_at:=clock_timestamp(); RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
 RAISE EXCEPTION 'MF06 archive values invalid' USING ERRCODE='23514';
END `;

export class Mf06TeamAuthorityHistory1792281600000 implements MigrationInterface {
  name = 'Mf06TeamAuthorityHistory1792281600000';
  async up(runner: QueryRunner): Promise<void> {
    for (const [, table, fields] of sources)
      for (const field of fields) {
        if (!(await runner.hasColumn(table, field)))
          throw new Error(`Team authority prerequisite missing: ${table}.${field}`);
      }
    await runner.query(`LOCK TABLE ${sources.map(([, table]) => table).join(',')},mf06_authority_source IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE mf06_authority_source DISABLE TRIGGER trg_mf06_authority_source_insert;
      ALTER TABLE mf06_authority_source DISABLE TRIGGER trg_mf06_authority_source_immutable;`);
    const assignment = sources.find(([kind]) => kind === 'ASSIGNMENT')!;
    await runner.query(
      "UPDATE mf06_authority_source SET fields=$1 WHERE source_kind='ASSIGNMENT'",
      [[...assignment[2]]],
    );
    for (const [kind, table, fields] of sources.filter(([kind]) => kind.startsWith('TEAM'))) {
      await runner.query(
        'INSERT INTO mf06_authority_source(source_kind,table_name,fields,protocol_version) VALUES($1,$2,$3,$4)',
        [kind, table, [...fields], 'MAIN_ROW_JOURNAL_V1'],
      );
      await runner.query(`CREATE TRIGGER trg_mf06_capture_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('${kind}');
        CREATE TRIGGER trg_mf06_truncate_${table} AFTER TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_capture_main_authority('${kind}');`);
    }
    await runner.query(`ALTER TABLE mf06_authority_source ENABLE TRIGGER trg_mf06_authority_source_insert;
      ALTER TABLE mf06_authority_source ENABLE TRIGGER trg_mf06_authority_source_immutable;
      CREATE OR REPLACE FUNCTION mf06_authority_baseline_capture() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$${TEAM_BASELINE_CAPTURE_BODY}$$;
      CREATE OR REPLACE FUNCTION mf06_capture_main_authority() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$${TEAM_ROW_CAPTURE_BODY}$$;
      CREATE OR REPLACE FUNCTION mf06_b2_artifact_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$${TEAM_ARTIFACT_CAPTURE_BODY}$$;`);
    // No snapshots, backfill, consent or epoch activation: old incomplete baselines remain untrusted.
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DO $$ BEGIN RAISE EXCEPTION 'Team authority history requires forward recovery' USING ERRCODE='23514'; END $$;`,
    );
  }
}
