import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MAIN_AUTHORITY_SOURCES } from '../../common/configuration/main-authority-sources.js';

import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';
const mask = (sources: readonly (readonly [string, string, readonly string[]])[]) =>
  JSON.stringify(
    sources.map(([sourceKind, tableName, fields]) => ({ sourceKind, tableName, fields })),
  );
const artifactV1 = mask(MAIN_AUTHORITY_SOURCES),
  artifactV2 = mask(MAIN_AUTHORITY_V2_SOURCES);
const artifactBody = `
DECLARE req zone_entry_assessment_request%ROWTYPE; p jsonb; ctx jsonb; source jsonb;
        mask jsonb; row_data jsonb; registry jsonb := '${artifactV1}'::jsonb;
        rows_count bigint := 0; seen text[] := '{}';
BEGIN
 IF NEW.body->>'format'='MF06_MAIN_AUTHORITY_ARCHIVE_V2' THEN registry:='${artifactV2}'::jsonb; END IF;
 SELECT * INTO req FROM zone_entry_assessment_request WHERE request_id=NEW.request_id FOR SHARE;
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
      (source->'fields' IS DISTINCT FROM mask->'fields' AND NOT (
        NEW.body->>'format'='MF06_MAIN_AUTHORITY_ARCHIVE_V2' AND
        source->>'sourceKind'='TEAM_MEMBERSHIP' AND
        source->'fields' IS NOT DISTINCT FROM '["id","team_id","worker_id","site_id","contractor_id","joined_at","left_at"]'::jsonb
      )) OR jsonb_typeof(source->'rows') IS DISTINCT FROM 'array' THEN
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
/** Canonical immutable result storage only; no worker or authority activation. */
export class CanonicalMf06Results1794182400000 implements MigrationInterface {
  name = 'CanonicalMf06Results1794182400000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Canonical MF06 result migration requires a transaction');
    const [scope] = await runner.query('SELECT current_schema() AS name');
    if (!scope || typeof scope.name !== 'string') throw new Error('Missing target schema');
    const temporary = await runner.query(
      `SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname IN ('zone_entry_assessment_request','zone_entry_assessment_job','zone_entry_assessment','zone_entry_authority_artifact')`,
    );
    if (temporary.length) throw new Error('Temporary result storage shadows refused');
    const parents = await runner.query(
      `SELECT relname FROM pg_catalog.pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND relname IN ('zone_entry_assessment_request','zone_entry_assessment_job')`,
    );
    if (parents.length !== 2) throw new Error('Result parents must belong to target schema');
    const trustedPath = 'pg_catalog, "' + scope.name.replaceAll('"', '""') + '", pg_temp';

    const collisions =
      await runner.query(`SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('mf06_assessment','mf06_authority_artifact','zone_entry_assessment','zone_entry_authority_artifact')
    UNION ALL SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname IN ('mf06_b2_artifact_insert_guard','mf06_b2_assessment_insert_guard','mf06_b2_finalize_job','mf06_b2_job_complete_guard','mf06_b2_artifact_attachment_guard')`);
    if (collisions.length) throw new Error('Existing result objects require reviewed upgrade');

    await runner.query(`
CREATE TABLE zone_entry_authority_artifact (
 artifact_id uuid PRIMARY KEY,
 request_id uuid NOT NULL REFERENCES zone_entry_assessment_request(request_id) ON DELETE RESTRICT,
 sha256 char(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 body jsonb NOT NULL,
 body_hash char(64) NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(artifact_id,request_id),
 CHECK(isfinite(stored_at)),
 CHECK(octet_length(body::text)<=2097152)
);
CREATE TABLE zone_entry_assessment (
 assessment_id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE REFERENCES zone_entry_assessment_request(request_id) ON DELETE RESTRICT,
 command_id uuid NOT NULL UNIQUE,
 command_hash char(64) NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),
 site_id uuid NOT NULL,
 event_id uuid NOT NULL,
 binding_hash char(64) NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
 outcome varchar(16) NOT NULL CHECK(outcome IN ('ALLOWED','DENIED','UNAVAILABLE')),
 reason_code varchar(32) NOT NULL,
 evaluator_version varchar(128) NOT NULL CHECK(char_length(evaluator_version)>0 AND evaluator_version=btrim(evaluator_version)),
 provenance varchar(16) NOT NULL CHECK(provenance IN ('UNAVAILABLE','SYNTHETIC_TEST','TRUSTED_SERVICE')),
 worker_id uuid,
 profile_revision uuid,
 frame_sha256 char(64) CHECK(frame_sha256 ~ '^[0-9a-f]{64}$'),
 crop_sha256 char(64) CHECK(crop_sha256 ~ '^[0-9a-f]{64}$'),
 authority_artifact_id uuid UNIQUE,
 claim_head_revision integer NOT NULL CHECK(claim_head_revision>0),
 claim_lease_token uuid NOT NULL,
 assessed_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(assessed_at)),
 CONSTRAINT fk_mf06_assessment_artifact FOREIGN KEY(authority_artifact_id,request_id)
   REFERENCES zone_entry_authority_artifact(artifact_id,request_id) ON DELETE RESTRICT,
 CHECK((outcome='ALLOWED' AND reason_code IN ('POLICY_NONE','AUTHORIZED')) OR
       (outcome='DENIED' AND reason_code IN ('POLICY_PROHIBITED','UNAUTHORIZED')) OR
       (outcome='UNAVAILABLE' AND reason_code IN ('INVALID_BINDING','IDENTITY_UNAVAILABLE','MEDIA_UNAVAILABLE','PROFILE_REVOKED','AUTHORITY_UNAVAILABLE','SERVICE_DISABLED','ABORTED'))),
 CHECK(outcome='UNAVAILABLE' OR authority_artifact_id IS NOT NULL),
 CHECK(reason_code NOT IN ('AUTHORIZED','UNAUTHORIZED') OR
       (worker_id IS NOT NULL AND profile_revision IS NOT NULL AND frame_sha256 IS NOT NULL AND crop_sha256 IS NOT NULL AND provenance<>'UNAVAILABLE'))
);
CREATE INDEX idx_mf06_assessment_site_time ON zone_entry_assessment(site_id,assessed_at,assessment_id);

CREATE FUNCTION mf06_b2_artifact_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$${artifactBody}$$;
CREATE TRIGGER trg_mf06_b2_artifact_insert BEFORE INSERT ON zone_entry_authority_artifact
 FOR EACH ROW EXECUTE FUNCTION mf06_b2_artifact_insert_guard();

CREATE FUNCTION mf06_b2_assessment_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
DECLARE req zone_entry_assessment_request%ROWTYPE; head zone_entry_assessment_job%ROWTYPE; archive jsonb;
BEGIN
 SELECT * INTO req FROM zone_entry_assessment_request WHERE request_id=NEW.request_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MF06 assessment request absent' USING ERRCODE='23503'; END IF;
 IF NEW.site_id IS DISTINCT FROM req.site_id OR NEW.event_id IS DISTINCT FROM req.event_id OR
    NEW.binding_hash IS DISTINCT FROM req.binding_hash THEN
   RAISE EXCEPTION 'MF06 assessment request scope mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO head FROM zone_entry_assessment_job WHERE request_id=NEW.request_id FOR UPDATE;
 IF NOT FOUND OR head.status<>'CLAIMED' OR head.lease_token IS DISTINCT FROM NEW.claim_lease_token OR
    head.head_revision IS DISTINCT FROM NEW.claim_head_revision OR head.head_revision=2147483647 OR
    clock_timestamp()>=head.lease_expires_at OR clock_timestamp()>=head.deadline_at THEN
   RAISE EXCEPTION 'MF06 assessment lease is stale' USING ERRCODE='23514'; END IF;
 IF NEW.authority_artifact_id IS NOT NULL THEN
   SELECT body INTO archive FROM zone_entry_authority_artifact WHERE artifact_id=NEW.authority_artifact_id AND request_id=NEW.request_id FOR SHARE;
   IF NOT FOUND OR (archive->'payload'->'context'->>'workerId')::uuid IS DISTINCT FROM NEW.worker_id THEN
     RAISE EXCEPTION 'MF06 assessment artifact binding mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.assessed_at:=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER trg_mf06_b2_assessment_insert BEFORE INSERT ON zone_entry_assessment
 FOR EACH ROW EXECUTE FUNCTION mf06_b2_assessment_insert_guard();

CREATE FUNCTION mf06_b2_finalize_job() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
 UPDATE zone_entry_assessment_job SET status='SUCCEEDED',head_revision=head_revision+1,lease_token=NULL,
   lease_expires_at=NULL,last_error_code=NULL,updated_at=clock_timestamp()
 WHERE request_id=NEW.request_id AND status='CLAIMED' AND lease_token=NEW.claim_lease_token
   AND head_revision=NEW.claim_head_revision AND clock_timestamp()<lease_expires_at AND clock_timestamp()<deadline_at;
 IF NOT FOUND THEN RAISE EXCEPTION 'MF06 assessment lease expired during append' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_mf06_b2_finalize AFTER INSERT ON zone_entry_assessment
 FOR EACH ROW EXECUTE FUNCTION mf06_b2_finalize_job();

CREATE FUNCTION mf06_b2_job_complete_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM zone_entry_assessment WHERE request_id=OLD.request_id) AND
    NOT (TG_OP='UPDATE' AND OLD.status='CLAIMED' AND NEW.status='SUCCEEDED' AND
         NEW.head_revision::bigint=OLD.head_revision::bigint+1 AND NEW.attempt_count=OLD.attempt_count AND
         NEW.request_id=OLD.request_id AND NEW.created_at=OLD.created_at AND NEW.deadline_at=OLD.deadline_at AND
         NEW.next_attempt_at=OLD.next_attempt_at AND NEW.lease_token IS NULL AND NEW.lease_expires_at IS NULL AND NEW.last_error_code IS NULL) THEN
   RAISE EXCEPTION 'MF06 completed job head is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_mf06_b2_job_complete BEFORE UPDATE OR DELETE ON zone_entry_assessment_job
 FOR EACH ROW EXECUTE FUNCTION mf06_b2_job_complete_guard();

CREATE FUNCTION mf06_b2_artifact_attachment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM zone_entry_assessment WHERE authority_artifact_id=NEW.artifact_id AND request_id=NEW.request_id) THEN
   RAISE EXCEPTION 'MF06 archive cannot remain orphaned' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_mf06_b2_artifact_attached AFTER INSERT ON zone_entry_authority_artifact
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mf06_b2_artifact_attachment_guard();
CREATE TRIGGER trg_mf06_b2_assessment_immutable BEFORE UPDATE OR DELETE ON zone_entry_assessment
 FOR EACH ROW EXECUTE FUNCTION mf06_request_immutable_guard();
CREATE TRIGGER trg_mf06_b2_artifact_immutable BEFORE UPDATE OR DELETE ON zone_entry_authority_artifact
 FOR EACH ROW EXECUTE FUNCTION mf06_request_immutable_guard();
CREATE TRIGGER trg_mf06_b2_assessment_no_truncate BEFORE TRUNCATE ON zone_entry_assessment
 FOR EACH STATEMENT EXECUTE FUNCTION mf06_storage_truncate_guard();
CREATE TRIGGER trg_mf06_b2_artifact_no_truncate BEFORE TRUNCATE ON zone_entry_authority_artifact
 FOR EACH STATEMENT EXECUTE FUNCTION mf06_storage_truncate_guard();
`);
    // Physical table names are canonical; retain the reviewed entity constraint names.
    const constraints =
      await runner.query(`SELECT c.conname,t.relname FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid=c.conrelid WHERE t.relnamespace=current_schema()::regnamespace
      AND t.relname IN ('zone_entry_assessment','zone_entry_authority_artifact')`);
    const quotedSchema = '"' + scope.name.replaceAll('"', '""') + '"';
    for (const { conname, relname } of constraints) {
      const prefix =
        relname === 'zone_entry_assessment' ? 'mf06_assessment' : 'mf06_authority_artifact';
      if (!conname.startsWith(relname + '_')) continue;
      const renamed = prefix + conname.slice(relname.length);
      await runner.query(
        'ALTER TABLE ' +
          quotedSchema +
          '."' +
          relname +
          '" RENAME CONSTRAINT "' +
          conname.replaceAll('"', '""') +
          '" TO "' +
          renamed.replaceAll('"', '""') +
          '"',
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Canonical MF06 result migration requires a transaction');
    const [scope] = await runner.query('SELECT current_schema() AS name');
    if (!scope || typeof scope.name !== 'string') throw new Error('Missing target schema');
    const temporary = await runner.query(
      `SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname IN ('zone_entry_assessment_request','zone_entry_assessment_job','zone_entry_assessment','zone_entry_authority_artifact')`,
    );
    if (temporary.length) throw new Error('Temporary result storage shadows refused');
    const parents = await runner.query(
      `SELECT relname FROM pg_catalog.pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' AND relname IN ('zone_entry_assessment_request','zone_entry_assessment_job')`,
    );
    if (parents.length !== 2) throw new Error('Result parents must belong to target schema');
    const trustedPath = 'pg_catalog, "' + scope.name.replaceAll('"', '""') + '", pg_temp';

    await runner.query(`SET LOCAL search_path TO ${trustedPath}; DO $$ BEGIN
 LOCK TABLE zone_entry_assessment,zone_entry_authority_artifact,zone_entry_assessment_job IN ACCESS EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM zone_entry_assessment) OR EXISTS(SELECT 1 FROM zone_entry_authority_artifact) THEN
   RAISE EXCEPTION 'Refusing populated MF06 assessment revert' USING ERRCODE='23514'; END IF;
 DROP TRIGGER trg_mf06_b2_job_complete ON zone_entry_assessment_job;
 DROP TABLE zone_entry_assessment;
 DROP TABLE zone_entry_authority_artifact;
 DROP FUNCTION mf06_b2_artifact_attachment_guard();
 DROP FUNCTION mf06_b2_job_complete_guard();
 DROP FUNCTION mf06_b2_finalize_job();
 DROP FUNCTION mf06_b2_assessment_insert_guard();
 DROP FUNCTION mf06_b2_artifact_insert_guard();
 END $$;`);
  }
}
