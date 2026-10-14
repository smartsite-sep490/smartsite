import type { MigrationInterface, QueryRunner } from 'typeorm';

// Retained-main metadata and account-link provenance only; not identity, consent or flat ALLOW.
import { MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-authority-sources.js';

const sources = MAIN_AUTHORITY_SOURCES;

/** Unregistered retained-main candidate. Journal coverage is not a READY epoch or trusted authority. */
export class Mf06MainAuthorityJournal1791590400002 implements MigrationInterface {
  name = 'Mf06MainAuthorityJournal1791590400002';

  async up(runner: QueryRunner): Promise<void> {
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
    for (const [, table, fields] of sources) {
      for (const field of fields) {
        if (!(await runner.hasColumn(table, field))) {
          throw new Error(`Retained-main authority prerequisite missing: ${table}.${field}`);
        }
      }
    }
    await runner.query(`
      CREATE TABLE mf06_authority_source (
        source_kind VARCHAR(32) PRIMARY KEY, table_name VARCHAR(64) NOT NULL UNIQUE,
        fields TEXT[] NOT NULL, protocol_version TEXT NOT NULL CHECK(protocol_version='MAIN_ROW_JOURNAL_V1')
      );
      CREATE TABLE mf06_authority_command (
        command_id UUID PRIMARY KEY, actor_user_id UUID NOT NULL,
        operation VARCHAR(64) NOT NULL CHECK(char_length(btrim(operation)) BETWEEN 1 AND 64),
        request_hash CHAR(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
        transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
        started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(started_at))
      );
      CREATE TABLE mf06_authority_epoch (
        epoch_id UUID PRIMARY KEY, writer_manifest_hash CHAR(64) NOT NULL CHECK(writer_manifest_hash ~ '^[0-9a-f]{64}$'),
        state VARCHAR(16) NOT NULL DEFAULT 'STAGING' CHECK(state IN ('STAGING','READY','GAPPED','CLOSED')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), baseline_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
      );
      CREATE TABLE mf06_authority_control (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), epoch_id UUID REFERENCES mf06_authority_epoch(epoch_id) ON DELETE RESTRICT
      );
      INSERT INTO mf06_authority_control(singleton,epoch_id) VALUES(1,NULL);
      CREATE TABLE mf06_authority_head (
        source_kind VARCHAR(32) NOT NULL REFERENCES mf06_authority_source(source_kind) ON DELETE RESTRICT,
        source_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision>=1),
        after_payload JSONB, PRIMARY KEY(source_kind,source_id)
      );
      CREATE TABLE mf06_authority_fact (
        fact_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_kind VARCHAR(32) NOT NULL REFERENCES mf06_authority_source(source_kind) ON DELETE RESTRICT,
        source_id UUID NOT NULL, revision BIGINT NOT NULL CHECK(revision>=1),
        epoch_id UUID REFERENCES mf06_authority_epoch(epoch_id) ON DELETE RESTRICT,
        command_id UUID REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        transaction_id XID8 NOT NULL, operation VARCHAR(8) NOT NULL CHECK(operation IN ('INSERT','UPDATE','DELETE')),
        before_payload JSONB,after_payload JSONB,before_hash CHAR(64),after_hash CHAR(64),
        hash_algorithm TEXT NOT NULL DEFAULT 'POSTGRES_JSONB_TEXT_SHA256_V1' CHECK(hash_algorithm='POSTGRES_JSONB_TEXT_SHA256_V1'),
        observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(observed_at)),
        UNIQUE(source_kind,source_id,revision),
        CHECK((operation='INSERT' AND before_payload IS NULL AND after_payload IS NOT NULL)
          OR (operation='UPDATE' AND before_payload IS NOT NULL AND after_payload IS NOT NULL)
          OR (operation='DELETE' AND before_payload IS NOT NULL AND after_payload IS NULL))
      );
      CREATE INDEX idx_mf06_authority_fact_command ON mf06_authority_fact(command_id);
      CREATE INDEX idx_mf06_authority_fact_epoch_time ON mf06_authority_fact(epoch_id,observed_at);
      CREATE TABLE mf06_authority_gap (
        gap_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), epoch_id UUID REFERENCES mf06_authority_epoch(epoch_id) ON DELETE RESTRICT,
        source_kind VARCHAR(32) NOT NULL REFERENCES mf06_authority_source(source_kind) ON DELETE RESTRICT,
        source_id UUID, transaction_id XID8 NOT NULL, observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
        reason VARCHAR(32) NOT NULL CHECK(reason IN ('UNATTRIBUTED_WRITE','INITIAL_STATE_UNCAPTURED','SOURCE_HEAD_MISMATCH','UNCOVERED_TRUNCATE'))
      );
      CREATE TABLE mf06_authority_commit_witness (
        command_id UUID PRIMARY KEY REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        transaction_id XID8 NOT NULL, confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(confirmed_at))
      );
      CREATE TABLE mf06_authority_baseline (
        epoch_id UUID PRIMARY KEY REFERENCES mf06_authority_epoch(epoch_id) ON DELETE RESTRICT,
        command_id UUID NOT NULL UNIQUE REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        transaction_id XID8 NOT NULL,captured_at TIMESTAMPTZ NOT NULL CHECK(isfinite(captured_at)),
        source_registry_hash CHAR(64) NOT NULL CHECK(source_registry_hash ~ '^[0-9a-f]{64}$'),
        snapshot_hash CHAR(64) NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
        hash_algorithm TEXT NOT NULL CHECK(hash_algorithm='POSTGRES_JSONB_TEXT_SHA256_V1'),
        row_count INTEGER NOT NULL CHECK(row_count BETWEEN 0 AND 2048),
        snapshot_json JSONB NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND octet_length(snapshot_json::text)<=2097152)
      );
      CREATE TABLE mf06_zone_deny_command_result (
        command_id UUID PRIMARY KEY REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        source_id UUID NOT NULL, result_json JSONB NOT NULL,
        result_hash CHAR(64) NOT NULL,
        CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536)
      );
      CREATE TABLE mf06_zone_permission_command_result (
        command_id UUID PRIMARY KEY REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        source_id UUID NOT NULL,kind VARCHAR(16) NOT NULL CHECK(kind IN ('contractor','worker')),
        result_json JSONB NOT NULL,result_hash CHAR(64) NOT NULL,
        CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536)
      );
      CREATE TABLE mf06_assignment_command_result (
        command_id UUID PRIMARY KEY REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        source_id UUID NOT NULL,contractor_id UUID,result_json JSONB NOT NULL,result_hash CHAR(64) NOT NULL,
        CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536)
      );
      CREATE FUNCTION mf06_assignment_response(source UUID) RETURNS JSONB LANGUAGE sql STABLE
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
        SELECT jsonb_build_object('id',id,'workerId',worker_id,'siteId',site_id,'siteContractorId',site_contractor_id,
          'zoneIds',zone_ids,'gateId',gate_id,'status',status,'version',version,'validFrom',valid_from,'validUntil',valid_until,
          'requestedByUserId',requested_by_user_id,'safetyReviewedByUserId',safety_reviewed_by_user_id,
          'siteManagerDecidedByUserId',site_manager_decided_by_user_id,'reviewedAt',reviewed_at,'reviewNote',review_note,'createdAt',created_at)
          FROM worker_site_zone_assignment WHERE id=source
      $$;
      CREATE FUNCTION mf06_assignment_result_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE c mf06_authority_command%ROWTYPE;actual JSONB;actual_contractor UUID;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id()
          OR c.operation NOT IN ('MAIN_ASSIGNMENT_REQUEST','MAIN_ASSIGNMENT_SAFETY_REVIEW','MAIN_ASSIGNMENT_DECISION','MAIN_ASSIGNMENT_REVOKE')
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text THEN
          RAISE EXCEPTION 'Assignment result has no matching origin transaction' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM worker_site_zone_assignment WHERE id=NEW.source_id FOR SHARE;
        actual:=mf06_assignment_response(NEW.source_id);
        SELECT p.contractor_id INTO actual_contractor FROM worker_site_zone_assignment a
          LEFT JOIN contractor_site_participation p ON p.id=a.site_contractor_id WHERE a.id=NEW.source_id;
        IF actual IS NULL OR NEW.result_json IS DISTINCT FROM actual OR NEW.contractor_id IS DISTINCT FROM actual_contractor
          OR (c.operation='MAIN_ASSIGNMENT_REQUEST' AND (actual->>'status'<>'PENDING' OR actual->>'requestedByUserId'<>c.actor_user_id::text))
          OR (c.operation='MAIN_ASSIGNMENT_SAFETY_REVIEW' AND (actual->>'status'<>'SAFETY_REVIEWED' OR actual->>'safetyReviewedByUserId' IS DISTINCT FROM c.actor_user_id::text))
          OR (c.operation='MAIN_ASSIGNMENT_DECISION' AND (actual->>'status' NOT IN ('APPROVED','REJECTED') OR actual->>'siteManagerDecidedByUserId' IS DISTINCT FROM c.actor_user_id::text))
          OR (c.operation='MAIN_ASSIGNMENT_REVOKE' AND (actual->>'status'<>'REVOKED' OR actual->>'siteManagerDecidedByUserId' IS DISTINCT FROM c.actor_user_id::text)) THEN
          RAISE EXCEPTION 'Assignment result differs from its original scoped projection' USING ERRCODE='23514';
        END IF;
        NEW.result_hash:=encode(sha256(convert_to(actual::text,'UTF8')),'hex');RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_assignment_result_insert BEFORE INSERT ON mf06_assignment_command_result
        FOR EACH ROW EXECUTE FUNCTION mf06_assignment_result_guard();
      CREATE TABLE mf06_participation_command_result (
        command_id UUID PRIMARY KEY REFERENCES mf06_authority_command(command_id) ON DELETE RESTRICT,
        source_id UUID NOT NULL,result_json JSONB NOT NULL,result_hash CHAR(64) NOT NULL,
        CHECK(jsonb_typeof(result_json)='object' AND octet_length(result_json::text)<=65536)
      );
      CREATE FUNCTION mf06_participation_response(source UUID) RETURNS JSONB LANGUAGE sql STABLE
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
        SELECT jsonb_build_object('id',id,'contractorId',contractor_id,'siteId',site_id,
          'isActive',is_active,'validFrom',valid_from,'validUntil',valid_until,'createdAt',created_at)
          FROM contractor_site_participation WHERE id=source
      $$;
      CREATE FUNCTION mf06_participation_result_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE c mf06_authority_command%ROWTYPE;actual JSONB;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id() OR c.operation<>'MAIN_PARTICIPATION_CREATE'
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text
          OR NOT EXISTS(SELECT 1 FROM mf06_authority_fact f WHERE f.command_id=c.command_id
            AND f.transaction_id=c.transaction_id AND f.source_kind='PARTICIPATION'
            AND f.source_id=NEW.source_id AND f.operation='INSERT') THEN
          RAISE EXCEPTION 'Participation result has no matching origin insert' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM contractor_site_participation WHERE id=NEW.source_id FOR SHARE;
        actual:=mf06_participation_response(NEW.source_id);
        IF actual IS NULL OR NEW.result_json IS DISTINCT FROM actual THEN
          RAISE EXCEPTION 'Participation result differs from its original projection' USING ERRCODE='23514';
        END IF;
        NEW.result_hash:=encode(sha256(convert_to(actual::text,'UTF8')),'hex');RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_participation_result_insert BEFORE INSERT ON mf06_participation_command_result
        FOR EACH ROW EXECUTE FUNCTION mf06_participation_result_guard();
      CREATE FUNCTION mf06_zone_permission_response(source UUID,kind TEXT) RETURNS JSONB LANGUAGE sql STABLE
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
        SELECT jsonb_build_object('id',c.id,'siteId',p.site_id,'contractorId',p.contractor_id,
          'siteContractorId',p.id,'zoneId',c.zone_id,'workerAssignmentId',NULL,'contractorZonePermissionId',NULL,
          'validFrom',c.valid_from,'validUntil',c.valid_until,'grantedBy',c.granted_by,'revokedAt',c.revoked_at,'createdAt',c.created_at)
          FROM contractor_zone_permission c JOIN contractor_site_participation p ON p.id=c.site_contractor_id
          JOIN zone z ON z.id=c.zone_id AND z.site_id=p.site_id WHERE kind='contractor' AND c.id=source
        UNION ALL
        SELECT jsonb_build_object('id',w.id,'siteId',a.site_id,'contractorId',p.contractor_id,
          'siteContractorId',p.id,'zoneId',c.zone_id,'workerAssignmentId',a.id,'contractorZonePermissionId',c.id,
          'validFrom',w.valid_from,'validUntil',w.valid_until,'grantedBy',w.granted_by,'revokedAt',w.revoked_at,'createdAt',w.created_at)
          FROM worker_zone_permission w JOIN worker_site_zone_assignment a ON a.id=w.worker_assignment_id
          JOIN contractor_zone_permission c ON c.id=w.contractor_zone_permission_id AND c.site_contractor_id=a.site_contractor_id
          JOIN contractor_site_participation p ON p.id=a.site_contractor_id AND p.site_id=a.site_id
          JOIN zone z ON z.id=c.zone_id AND z.site_id=a.site_id WHERE kind='worker' AND w.id=source
      $$;
      CREATE FUNCTION mf06_zone_permission_result_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE c mf06_authority_command%ROWTYPE; actual JSONB;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id()
          OR (NEW.kind='contractor' AND c.operation NOT IN ('MAIN_CONTRACTOR_ZONE_GRANT','MAIN_CONTRACTOR_ZONE_REVOKE'))
          OR (NEW.kind='worker' AND c.operation NOT IN ('MAIN_WORKER_ZONE_GRANT','MAIN_WORKER_ZONE_REVOKE'))
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text THEN
          RAISE EXCEPTION 'Permission result has no matching origin transaction' USING ERRCODE='23514';
        END IF;
        IF NEW.kind='contractor' THEN
          PERFORM 1 FROM contractor_zone_permission WHERE id=NEW.source_id FOR SHARE;
        ELSE
          PERFORM 1 FROM worker_zone_permission WHERE id=NEW.source_id FOR SHARE;
        END IF;
        actual:=mf06_zone_permission_response(NEW.source_id,NEW.kind);
        IF actual IS NULL OR actual IS DISTINCT FROM NEW.result_json THEN
          RAISE EXCEPTION 'Permission result differs from its original scoped projection' USING ERRCODE='23514';
        END IF;
        NEW.result_hash:=encode(sha256(convert_to(actual::text,'UTF8')),'hex'); RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_zone_permission_result_insert BEFORE INSERT ON mf06_zone_permission_command_result
        FOR EACH ROW EXECUTE FUNCTION mf06_zone_permission_result_guard();
      CREATE FUNCTION mf06_zone_deny_response(source UUID) RETURNS JSONB LANGUAGE sql STABLE
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
        SELECT jsonb_build_object('id',id,'siteId',site_id,'zoneId',zone_id,'workerId',worker_id,
          'effect',effect,'validFrom',valid_from,'validUntil',valid_until,'revokedAt',revoked_at,'createdAt',created_at)
          FROM zone_access_grant WHERE id=source
      $$;
      CREATE FUNCTION mf06_zone_deny_result_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE c mf06_authority_command%ROWTYPE; actual JSONB;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR c.transaction_id<>pg_current_xact_id()
          OR c.operation NOT IN ('MAIN_ZONE_DENY_CREATE','MAIN_ZONE_DENY_REVOKE')
          OR current_setting('smartsite.mf06_command_id',true) IS DISTINCT FROM NEW.command_id::text THEN
          RAISE EXCEPTION 'Zone command result has no matching origin transaction' USING ERRCODE='23514';
        END IF;
        PERFORM 1 FROM zone_access_grant WHERE id=NEW.source_id FOR SHARE;
        actual:=mf06_zone_deny_response(NEW.source_id);
        IF actual IS NULL OR NEW.result_json IS DISTINCT FROM actual
          OR (c.operation='MAIN_ZONE_DENY_CREATE' AND actual->>'effect'<>'DENY') THEN
          RAISE EXCEPTION 'Zone command result differs from its original projection' USING ERRCODE='23514';
        END IF;
        NEW.result_hash:=encode(sha256(convert_to(actual::text,'UTF8')),'hex'); RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_zone_deny_result_insert BEFORE INSERT ON mf06_zone_deny_command_result
        FOR EACH ROW EXECUTE FUNCTION mf06_zone_deny_result_guard();
      CREATE FUNCTION mf06_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Main authority provenance is immutable' USING ERRCODE='23514'; END $$;

      CREATE FUNCTION mf06_authority_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        PERFORM 1 FROM app_user WHERE id=NEW.actor_user_id AND is_active
          AND (NOT must_change_password OR NEW.operation='USER_PASSWORD_CHANGE') FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Authority command actor unavailable' USING ERRCODE='23514'; END IF;
        NEW.transaction_id:=pg_current_xact_id(); NEW.started_at:=clock_timestamp(); RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_authority_command_insert BEFORE INSERT ON mf06_authority_command
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_command_guard();

      CREATE FUNCTION mf06_authority_epoch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='INSERT' THEN
          IF NEW.state<>'STAGING' OR NEW.baseline_at IS NOT NULL OR NEW.closed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Controlled authority cutover is not installed' USING ERRCODE='23514';
          END IF;
          NEW.started_at:=clock_timestamp();
        ELSE
          IF pg_trigger_depth()=2 AND OLD.state='STAGING' AND NEW.state='STAGING'
            AND OLD.baseline_at IS NULL AND NEW.baseline_at IS NOT NULL
            AND (to_jsonb(NEW)-'baseline_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'baseline_at')
            AND EXISTS(SELECT 1 FROM mf06_authority_baseline b WHERE b.epoch_id=NEW.epoch_id
              AND b.captured_at=NEW.baseline_at AND b.transaction_id=pg_current_xact_id()) THEN
            RETURN NEW;
          END IF;
          IF (to_jsonb(NEW)-'state'-'closed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'closed_at')
            OR NEW.state NOT IN ('GAPPED','CLOSED') OR OLD.state='CLOSED' THEN
            RAISE EXCEPTION 'Authority epoch provenance cannot be rewritten or promoted' USING ERRCODE='23514';
          END IF;
          NEW.closed_at:=CASE WHEN NEW.state='CLOSED' THEN clock_timestamp() ELSE NULL END;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_authority_epoch_guard BEFORE INSERT OR UPDATE ON mf06_authority_epoch
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_epoch_guard();
      CREATE TRIGGER trg_mf06_authority_epoch_delete BEFORE DELETE ON mf06_authority_epoch
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_immutable();
      CREATE TRIGGER trg_mf06_authority_epoch_truncate BEFORE TRUNCATE ON mf06_authority_epoch
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_authority_immutable();

      CREATE FUNCTION mf06_authority_internal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Authority journal is source owned' USING ERRCODE='23514'; END IF;
        IF TG_OP='INSERT' AND TG_TABLE_NAME='mf06_authority_fact' THEN
          NEW.transaction_id:=pg_current_xact_id(); NEW.observed_at:=clock_timestamp();
          NEW.before_hash:=CASE WHEN NEW.before_payload IS NULL THEN NULL ELSE encode(sha256(convert_to(NEW.before_payload::text,'UTF8')),'hex') END;
          NEW.after_hash:=CASE WHEN NEW.after_payload IS NULL THEN NULL ELSE encode(sha256(convert_to(NEW.after_payload::text,'UTF8')),'hex') END;
        ELSIF TG_OP='INSERT' AND TG_TABLE_NAME='mf06_authority_gap' THEN
          NEW.transaction_id:=pg_current_xact_id(); NEW.observed_at:=clock_timestamp();
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_authority_fact_insert BEFORE INSERT ON mf06_authority_fact
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_internal_guard();
      CREATE TRIGGER trg_mf06_authority_gap_insert BEFORE INSERT ON mf06_authority_gap
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_internal_guard();
      CREATE TRIGGER trg_mf06_authority_head_write BEFORE INSERT OR UPDATE ON mf06_authority_head
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_internal_guard();
      CREATE TRIGGER trg_mf06_authority_head_delete BEFORE DELETE ON mf06_authority_head
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_immutable();
      CREATE TRIGGER trg_mf06_authority_head_truncate BEFORE TRUNCATE ON mf06_authority_head
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_authority_immutable();

      CREATE FUNCTION mf06_authority_witness_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      DECLARE c mf06_authority_command%ROWTYPE;
      BEGIN
        SELECT * INTO c FROM mf06_authority_command WHERE command_id=NEW.command_id;
        IF NOT FOUND OR pg_xact_status(c.transaction_id) IS DISTINCT FROM 'committed' THEN
          RAISE EXCEPTION 'Authority transaction is not confirmed committed' USING ERRCODE='23514';
        END IF;
        NEW.transaction_id:=c.transaction_id; NEW.confirmed_at:=clock_timestamp(); RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_authority_witness_insert BEFORE INSERT ON mf06_authority_commit_witness
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_witness_guard();

      CREATE FUNCTION mf06_capture_main_authority() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
      DECLARE kind VARCHAR(32):=TG_ARGV[0]; keys TEXT[]; prior JSONB; following JSONB; sid UUID;
        previous_head mf06_authority_head%ROWTYPE; rev BIGINT; cmd UUID; cmd_text TEXT;
        epoch UUID; gap_reason VARCHAR(32);
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
          -- Credential replacement still revokes sessions when eligibility flags are unchanged.
          -- Record the existing metadata projection, never the secret or a password-derived hash.
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
        IF NOT FOUND AND prior IS NOT NULL THEN
          gap_reason:=COALESCE(gap_reason,'INITIAL_STATE_UNCAPTURED');
        ELSIF FOUND AND previous_head.after_payload IS DISTINCT FROM prior THEN
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
      END $$;
    `);
    for (const [kind, table, fields] of sources) {
      await runner.query(
        "INSERT INTO mf06_authority_source(source_kind,table_name,fields,protocol_version) VALUES($1,$2,$3,'MAIN_ROW_JOURNAL_V1')",
        [kind, table, [...fields]],
      );
      await runner.query(`CREATE TRIGGER trg_mf06_capture_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION mf06_capture_main_authority('${kind}');
        CREATE TRIGGER trg_mf06_truncate_${table} AFTER TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_capture_main_authority('${kind}');`);
    }
    await runner.query(`
      CREATE FUNCTION mf06_authority_baseline_capture() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT SET timezone='UTC' AS $$
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
      END $$;
      CREATE TRIGGER trg_mf06_baseline_insert BEFORE INSERT ON mf06_authority_baseline
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_baseline_capture();
      CREATE FUNCTION mf06_authority_baseline_link() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
      BEGIN
        UPDATE mf06_authority_epoch SET baseline_at=NEW.captured_at WHERE epoch_id=NEW.epoch_id;
        RETURN NULL;
      END $$;
      CREATE TRIGGER trg_mf06_baseline_link AFTER INSERT ON mf06_authority_baseline
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_baseline_link();
    `);
    for (const table of [
      'mf06_authority_baseline',
      'mf06_authority_source',
      'mf06_authority_command',
      'mf06_authority_fact',
      'mf06_authority_gap',
      'mf06_authority_commit_witness',
      'mf06_zone_deny_command_result',
      'mf06_zone_permission_command_result',
      'mf06_assignment_command_result',
      'mf06_participation_command_result',
    ]) {
      await runner.query(`CREATE TRIGGER trg_${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION mf06_authority_immutable();
        CREATE TRIGGER trg_${table}_truncate BEFORE TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION mf06_authority_immutable();`);
    }
    await runner.query(`CREATE TRIGGER trg_mf06_authority_source_insert BEFORE INSERT ON mf06_authority_source
      FOR EACH ROW EXECUTE FUNCTION mf06_authority_immutable();
      CREATE TRIGGER trg_mf06_authority_control_delete BEFORE DELETE ON mf06_authority_control
      FOR EACH ROW EXECUTE FUNCTION mf06_authority_immutable();
      CREATE TRIGGER trg_mf06_authority_control_truncate BEFORE TRUNCATE ON mf06_authority_control
      FOR EACH STATEMENT EXECUTE FUNCTION mf06_authority_immutable();`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`LOCK TABLE ${sources.map(([, table]) => table).join(',')},
      mf06_authority_baseline,mf06_authority_source,mf06_authority_command,mf06_authority_fact,mf06_authority_head,
      mf06_authority_gap,mf06_authority_commit_witness,mf06_zone_deny_command_result,mf06_zone_permission_command_result,mf06_assignment_command_result,mf06_participation_command_result,mf06_authority_epoch,mf06_authority_control IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM mf06_authority_baseline) OR EXISTS(SELECT 1 FROM mf06_authority_command) OR EXISTS(SELECT 1 FROM mf06_authority_fact)
          OR EXISTS(SELECT 1 FROM mf06_authority_head) OR EXISTS(SELECT 1 FROM mf06_authority_gap)
          OR EXISTS(SELECT 1 FROM mf06_authority_commit_witness) OR EXISTS(SELECT 1 FROM mf06_zone_deny_command_result)
          OR EXISTS(SELECT 1 FROM mf06_zone_permission_command_result)
          OR EXISTS(SELECT 1 FROM mf06_assignment_command_result)
          OR EXISTS(SELECT 1 FROM mf06_participation_command_result)
          OR EXISTS(SELECT 1 FROM mf06_authority_epoch) THEN
          RAISE EXCEPTION 'Populated main authority provenance requires forward recovery' USING ERRCODE='23514';
        END IF;
      END $$;`);
    for (const [, table] of sources) {
      await runner.query(
        `DROP TRIGGER trg_mf06_capture_${table} ON ${table}; DROP TRIGGER trg_mf06_truncate_${table} ON ${table};`,
      );
    }
    await runner.query(`DROP TABLE mf06_authority_baseline,mf06_participation_command_result,mf06_assignment_command_result,mf06_zone_permission_command_result,mf06_zone_deny_command_result,mf06_authority_commit_witness,mf06_authority_gap,mf06_authority_fact,mf06_authority_head,
      mf06_authority_control,mf06_authority_epoch,mf06_authority_command,mf06_authority_source;
      DROP FUNCTION mf06_authority_baseline_capture(),mf06_authority_baseline_link(),mf06_capture_main_authority(),mf06_authority_witness_guard(),mf06_authority_internal_guard(),
        mf06_authority_epoch_guard(),mf06_authority_command_guard(),mf06_authority_immutable(),
        mf06_zone_deny_result_guard(),mf06_zone_deny_response(UUID),mf06_zone_permission_result_guard(),mf06_zone_permission_response(UUID,TEXT),
        mf06_assignment_result_guard(),mf06_assignment_response(UUID),mf06_participation_result_guard(),mf06_participation_response(UUID);`);
  }
}
