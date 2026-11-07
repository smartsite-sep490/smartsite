import type { QueryRunner } from 'typeorm';

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
const TEAM_BASELINE_CAPTURE_BODY = `
      DECLARE c authorization_history_command%ROWTYPE;e authorization_history_epoch%ROWTYPE;
        registry JSONB;body JSONB;row_total BIGINT;enabled INTEGER;
      BEGIN
        SELECT * INTO c FROM authorization_history_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id() OR c.operation<>'MAIN_AUTHORITY_BASELINE'
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text THEN
          RAISE EXCEPTION 'Baseline has no matching origin transaction' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM app_user u JOIN user_role_assignment a ON a.user_id=u.id
          WHERE u.id=c.actor_user_id AND u.is_active AND NOT u.must_change_password
            AND a.role='ADMIN' AND a.site_id IS NULL FOR SHARE OF u,a;
        IF NOT FOUND THEN RAISE EXCEPTION 'Baseline actor unavailable' USING ERRCODE='23514';END IF;
        SELECT * INTO e FROM authorization_history_epoch WHERE epoch_id=NEW.epoch_id FOR UPDATE;
        IF NOT FOUND OR e.state<>'STAGING' OR e.baseline_at IS NOT NULL THEN
          RAISE EXCEPTION 'Baseline requires a fresh staging epoch' USING ERRCODE='23514';END IF;
        LOCK TABLE ${sources.map(([, table]) => table).join(',')} IN SHARE MODE;
        SELECT jsonb_agg(to_jsonb(s) ORDER BY source_kind COLLATE "C") INTO registry FROM authorization_history_source s;
        IF registry IS DISTINCT FROM '${registry}'::jsonb THEN
          RAISE EXCEPTION 'Baseline source registry unavailable' USING ERRCODE='55000';END IF;
        SELECT count(*) INTO enabled FROM authorization_history_source s
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

const TEAM_ROW_CAPTURE_BODY = `
      DECLARE kind VARCHAR(32):=TG_ARGV[0]; keys TEXT[]; prior JSONB; following JSONB; sid UUID;
        previous_head authorization_history_head%ROWTYPE; rev BIGINT; cmd UUID; cmd_text TEXT;
        epoch UUID; gap_reason VARCHAR(32); head_found BOOLEAN; bridge BOOLEAN:=false;
      BEGIN
        SELECT fields INTO keys FROM authorization_history_source WHERE source_kind=kind AND table_name=TG_TABLE_NAME;
        IF NOT FOUND THEN RAISE EXCEPTION 'Authority source registry mismatch' USING ERRCODE='23514'; END IF;
        SELECT epoch_id INTO epoch FROM authorization_history_control WHERE singleton=1;
        IF TG_OP='TRUNCATE' THEN
          INSERT INTO authorization_history_gap(epoch_id,source_kind,source_id,transaction_id,reason)
            VALUES(epoch,kind,NULL,pg_current_xact_id(),'UNCOVERED_TRUNCATE');
          IF epoch IS NOT NULL THEN UPDATE authorization_history_epoch SET state='GAPPED' WHERE epoch_id=epoch AND state<>'CLOSED'; END IF;
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
          SELECT command_id INTO cmd FROM authorization_history_command
            WHERE command_id=cmd_text::uuid AND transaction_id=pg_current_xact_id();
        END IF;
        IF cmd IS NULL THEN gap_reason:='UNATTRIBUTED_WRITE'; END IF;
        SELECT * INTO previous_head FROM authorization_history_head WHERE source_kind=kind AND source_id=sid FOR UPDATE;
        head_found:=FOUND;
        -- Only bridge newly covered state from a committed V2 baseline, never infer earlier history.
        IF cmd IS NOT NULL AND prior IS NOT NULL AND
          (NOT head_found OR
           (kind='ASSIGNMENT' AND head_found AND NOT (previous_head.after_payload ? 'zone_ids')
            AND previous_head.after_payload=prior-'zone_ids')) THEN
          SELECT EXISTS(SELECT 1 FROM authorization_history_baseline b
            JOIN authorization_history_command c USING(command_id)
            JOIN authorization_history_commit_receipt w USING(command_id)
            CROSS JOIN LATERAL jsonb_array_elements(b.snapshot_json->'sources') s
            CROSS JOIN LATERAL jsonb_array_elements(s->'rows') r
            WHERE c.operation='MAIN_AUTHORITY_BASELINE' AND c.transaction_id=b.transaction_id
              AND w.transaction_id=c.transaction_id AND w.confirmed_at<=clock_timestamp()
              AND b.snapshot_hash=encode(sha256(convert_to(b.snapshot_json::text,'UTF8')),'hex')
              AND b.source_registry_hash=(SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(x) ORDER BY source_kind COLLATE "C")::text,'UTF8')),'hex') FROM authorization_history_source x)
              AND s->>'sourceKind'=kind AND s->'fields'=to_jsonb(keys) AND r=prior
              AND NOT EXISTS(SELECT 1 FROM authorization_history_revision f WHERE f.source_kind=kind AND f.source_id=sid AND f.observed_at>b.captured_at)) INTO bridge;
        END IF;
        IF NOT head_found AND prior IS NOT NULL AND NOT bridge THEN
          gap_reason:=COALESCE(gap_reason,'INITIAL_STATE_UNCAPTURED');
        ELSIF head_found AND previous_head.after_payload IS DISTINCT FROM prior AND NOT bridge THEN
          gap_reason:='SOURCE_HEAD_MISMATCH';
        END IF;
        INSERT INTO authorization_history_head(source_kind,source_id,revision,after_payload) VALUES(kind,sid,1,following)
          ON CONFLICT(source_kind,source_id) DO UPDATE SET revision=authorization_history_head.revision+1,after_payload=EXCLUDED.after_payload
          RETURNING revision INTO rev;
        INSERT INTO authorization_history_revision(source_kind,source_id,revision,epoch_id,command_id,transaction_id,operation,before_payload,after_payload)
          VALUES(kind,sid,rev,epoch,cmd,pg_current_xact_id(),TG_OP,prior,following);
        IF gap_reason IS NOT NULL THEN
          INSERT INTO authorization_history_gap(epoch_id,source_kind,source_id,transaction_id,reason)
            VALUES(epoch,kind,sid,pg_current_xact_id(),gap_reason);
          IF epoch IS NOT NULL THEN UPDATE authorization_history_epoch SET state='GAPPED' WHERE epoch_id=epoch AND state<>'CLOSED'; END IF;
        END IF;
        RETURN NULL;
      END `;

export async function extendAuthorityJournalToTeams(runner: QueryRunner): Promise<void> {
  for (const [, table, fields] of sources)
    for (const field of fields) {
      if (!(await runner.hasColumn(table, field)))
        throw new Error(`Team authority prerequisite missing: ${table}.${field}`);
    }
  await runner.query(`LOCK TABLE ${sources.map(([, table]) => table).join(',')},authorization_history_source IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE authorization_history_source DISABLE TRIGGER trg_mf06_authority_source_insert;
      ALTER TABLE authorization_history_source DISABLE TRIGGER trg_mf06_authority_source_immutable;`);
  const assignment = sources.find(([kind]) => kind === 'ASSIGNMENT')!;
  await runner.query(
    "UPDATE authorization_history_source SET fields=$1 WHERE source_kind='ASSIGNMENT'",
    [[...assignment[2]]],
  );
  for (const [kind, table, fields] of sources.filter(([kind]) => kind.startsWith('TEAM'))) {
    await runner.query(
      'INSERT INTO authorization_history_source(source_kind,table_name,fields,protocol_version) VALUES($1,$2,$3,$4)',
      [kind, table, [...fields], 'MAIN_ROW_JOURNAL_V1'],
    );
    await runner.query(`CREATE TRIGGER trg_mf06_capture_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('${kind}');
        CREATE TRIGGER trg_mf06_truncate_${table} AFTER TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_capture_main_authority('${kind}');`);
  }
  await runner.query(`ALTER TABLE authorization_history_source ENABLE TRIGGER trg_mf06_authority_source_insert;
      ALTER TABLE authorization_history_source ENABLE TRIGGER trg_mf06_authority_source_immutable;
      CREATE OR REPLACE FUNCTION mf06_authority_baseline_capture() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$${TEAM_BASELINE_CAPTURE_BODY}$$;
      CREATE OR REPLACE FUNCTION mf06_capture_main_authority() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$${TEAM_ROW_CAPTURE_BODY}$$;`);
  // No snapshots, backfill, consent or epoch activation: old incomplete baselines remain untrusted.
}
