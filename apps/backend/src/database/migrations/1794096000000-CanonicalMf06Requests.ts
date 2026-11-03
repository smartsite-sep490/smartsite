import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Storage only: no legacy backfill, identity assertion, enqueue or worker activation. */
export class CanonicalMf06Requests1794096000000 implements MigrationInterface {
  name = 'CanonicalMf06Requests1794096000000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Canonical MF06 storage requires a transaction');

    const temporary = await runner.query(`SELECT 1 FROM pg_catalog.pg_class
      WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname IN
      ('ai_observation_event','site','zone','mf06_assessment_request','mf06_assessment_job','zone_entry_assessment_request','zone_entry_assessment_job')`);
    if (temporary.length)
      throw new Error('Temporary relations cannot shadow MF06 migration objects');
    const [scope] = await runner.query('SELECT current_schema() AS name');
    if (!scope || typeof scope.name !== 'string') throw new Error('Missing target schema');
    const parents =
      await runner.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname IN ('ai_observation_event','site','zone')`);
    if (parents.length !== 3) throw new Error('Required parents must belong to the target schema');
    const trustedPath = 'pg_catalog, "' + scope.name.replaceAll('"', '""') + '", pg_temp';
    const collisions =
      await runner.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname IN ('mf06_assessment_request','mf06_assessment_job','zone_entry_assessment_request','zone_entry_assessment_job')
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema()
      AND p.proname IN ('mf06_request_person_box_valid','mf06_request_insert_guard','mf06_request_immutable_guard','mf06_storage_truncate_guard','mf06_request_parent_guard','mf06_job_head_guard')
      UNION ALL SELECT 1 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname='uq_mf06_request_zone_scope'`);
    if (collisions.length)
      throw new Error('Existing MF06 storage objects require a reviewed upgrade path');

    await runner.query(`
-- Own the required scope key independently of the optional authority-history
-- migration. Current main does not have its old composite Zone uniqueness.
ALTER TABLE zone ADD CONSTRAINT uq_mf06_request_zone_scope UNIQUE(id,site_id);
CREATE TABLE zone_entry_assessment_request (
        request_id uuid NOT NULL CONSTRAINT pk_mf06_request PRIMARY KEY,
        event_id uuid NOT NULL,
        payload_hash char(64) NOT NULL,
        person_observation_index smallint,
        zone_observation_index smallint NOT NULL,
        subject_binding_status varchar(32) NOT NULL,
        track_id bigint NOT NULL,
        site_id uuid NOT NULL,
        camera_id uuid NOT NULL,
        camera_external_id varchar(128) NOT NULL,
        stream_session_id uuid NOT NULL,
        region_id uuid NOT NULL,
        geometry_version bigint NOT NULL,
        zone_id uuid NOT NULL,
        captured_at timestamptz NOT NULL,
        requested_purpose varchar(32) NOT NULL,
        request_revision integer NOT NULL,
        binding_hash char(64) NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        CONSTRAINT fk_mf06_request_event FOREIGN KEY(event_id) REFERENCES ai_observation_event(event_id) ON DELETE RESTRICT,
        CONSTRAINT fk_mf06_request_site FOREIGN KEY(site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_mf06_request_zone_site FOREIGN KEY(zone_id,site_id) REFERENCES zone(id,site_id) ON DELETE RESTRICT,
        CONSTRAINT uq_mf06_request_binding UNIQUE NULLS NOT DISTINCT(event_id,person_observation_index,zone_observation_index,requested_purpose,request_revision),
        CONSTRAINT chk_mf06_request_hashes CHECK (payload_hash ~ '^[0-9a-f]{64}$' AND binding_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_mf06_request_indices CHECK (zone_observation_index BETWEEN 0 AND 255 AND (person_observation_index IS NULL OR (person_observation_index BETWEEN 0 AND 255 AND person_observation_index <> zone_observation_index))),
        CONSTRAINT chk_mf06_request_binding CHECK ((subject_binding_status IN ('BOUND','PERSON_BOX_UNAVAILABLE') AND person_observation_index IS NOT NULL) OR (subject_binding_status IN ('PERSON_NOT_FOUND','AMBIGUOUS_PERSON_TRACK') AND person_observation_index IS NULL)),
        CONSTRAINT chk_mf06_request_numbers CHECK (track_id BETWEEN 0 AND 9007199254740991 AND geometry_version BETWEEN 1 AND 9007199254740991 AND request_revision BETWEEN 1 AND 2147483647),
        CONSTRAINT chk_mf06_request_purpose CHECK (requested_purpose IN ('INITIAL_OBSERVATION_ASSESSMENT','RETROSPECTIVE_REVIEW')),
        CONSTRAINT chk_mf06_request_camera_external CHECK (char_length(camera_external_id) BETWEEN 1 AND 128),
        CONSTRAINT chk_mf06_request_times CHECK (isfinite(captured_at) AND isfinite(requested_at))
      );
CREATE TABLE zone_entry_assessment_job (
        request_id uuid NOT NULL CONSTRAINT pk_mf06_job PRIMARY KEY,
        status varchar(16) NOT NULL,
        attempt_count integer NOT NULL,
        head_revision integer NOT NULL,
        lease_token uuid,
        lease_expires_at timestamptz,
        next_attempt_at timestamptz NOT NULL,
        deadline_at timestamptz NOT NULL,
        last_error_code varchar(64),
        created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
        CONSTRAINT fk_mf06_job_request FOREIGN KEY(request_id) REFERENCES zone_entry_assessment_request(request_id) ON DELETE RESTRICT,
        CONSTRAINT chk_mf06_job_status CHECK (status IN ('PENDING','CLAIMED','SUCCEEDED','FAILED','CANCELLED')),
        CONSTRAINT chk_mf06_job_counters CHECK (attempt_count >= 0 AND head_revision >= 1),
        CONSTRAINT chk_mf06_job_lease CHECK ((status='CLAIMED' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'CLAIMED' AND lease_token IS NULL AND lease_expires_at IS NULL)),
        CONSTRAINT chk_mf06_job_times CHECK (isfinite(created_at) AND isfinite(updated_at) AND isfinite(next_attempt_at) AND isfinite(deadline_at) AND deadline_at > created_at AND (lease_expires_at IS NULL OR (isfinite(lease_expires_at) AND lease_expires_at <= deadline_at))),
        CONSTRAINT chk_mf06_job_error_code CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
      );

CREATE INDEX idx_mf06_request_site_time ON zone_entry_assessment_request(site_id,captured_at,request_id);
CREATE INDEX idx_mf06_request_event_zone ON zone_entry_assessment_request(event_id,zone_observation_index);
CREATE INDEX idx_mf06_job_pending ON zone_entry_assessment_job(next_attempt_at,request_id) WHERE status = 'PENDING';
CREATE INDEX idx_mf06_job_claimed ON zone_entry_assessment_job(lease_expires_at,request_id) WHERE status = 'CLAIMED';
CREATE FUNCTION mf06_request_person_box_valid(box jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO ${trustedPath} AS $$
DECLARE coordinate text;
BEGIN
  IF jsonb_typeof(box) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF box->>'coordinateSpace' IS DISTINCT FROM 'NORMALIZED_0_1' OR
     EXISTS(SELECT 1 FROM jsonb_object_keys(box) AS key WHERE key NOT IN ('x1','y1','x2','y2','coordinateSpace')) THEN
    RETURN false;
  END IF;
  FOREACH coordinate IN ARRAY ARRAY['x1','y1','x2','y2'] LOOP
    IF jsonb_typeof(box->coordinate) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (box->>coordinate)::numeric < 0 OR (box->>coordinate)::numeric > 1 THEN RETURN false; END IF;
  END LOOP;
  RETURN (box->>'x1')::numeric < (box->>'x2')::numeric AND (box->>'y1')::numeric < (box->>'y2')::numeric;
END $$;

CREATE FUNCTION mf06_request_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
DECLARE
  parent ai_observation_event%ROWTYPE;
  observations jsonb;
  observed jsonb;
  zone_observation jsonb;
  person_count integer;
  person_index integer;
  expected_status varchar(32);
  raw_capture timestamptz;
  capture_text text;
  offset_text text;
BEGIN
  -- SHARE also conflicts with non-key raw-payload updates; KEY SHARE does not.
  SELECT * INTO parent FROM ai_observation_event WHERE event_id=NEW.event_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MF06 request source event is missing' USING ERRCODE='23503';
  END IF;
  IF parent.resolved_camera_id IS NULL OR parent.resolved_camera_id IS DISTINCT FROM NEW.camera_id OR
     parent.processing_status NOT IN ('PROCESSED','SKIPPED_NO_CANDIDATE') OR
     parent.payload_hash IS DISTINCT FROM NEW.payload_hash OR
     parent.camera_external_id IS DISTINCT FROM NEW.camera_external_id OR
     parent.stream_session_id IS DISTINCT FROM NEW.stream_session_id OR
     parent.captured_at IS DISTINCT FROM NEW.captured_at THEN
    RAISE EXCEPTION 'MF06 request source metadata is inconsistent' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(parent.raw_payload) IS DISTINCT FROM 'object' OR
     jsonb_typeof(parent.raw_payload->'eventId') IS DISTINCT FROM 'string' OR
     jsonb_typeof(parent.raw_payload->'streamSessionId') IS DISTINCT FROM 'string' OR
     jsonb_typeof(parent.raw_payload->'capturedAt') IS DISTINCT FROM 'string' OR
     jsonb_typeof(parent.raw_payload->'cameraExternalId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'MF06 request source payload is invalid' USING ERRCODE='23514';
  END IF;
  capture_text := parent.raw_payload->>'capturedAt';
  IF capture_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt]([01][0-9]|2[0-3]):[0-5][0-9]:([0-5][0-9]|60)([.][0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' THEN
    RAISE EXCEPTION 'MF06 request capture timestamp is invalid' USING ERRCODE='23514';
  END IF;
  -- Match parseNormalizedCapturedAt: retain raw evidence but normalize :60 to :59.
  IF substring(capture_text FROM 18 FOR 2)='60' THEN
    capture_text := overlay(capture_text placing '59' FROM 18 FOR 2);
  END IF;
  -- JS Date truncates sub-millisecond precision; truncate before PostgreSQL
  -- parsing so its microsecond rounding cannot advance a .999999999 instant.
  IF position('.' IN capture_text)>0 THEN
    capture_text := regexp_replace(capture_text,'[.][0-9]+','.' || left(substring(capture_text FROM '[.]([0-9]+)'),3));
  END IF;
  -- The canonical offset range extends beyond PostgreSQL's timezone parser.
  -- Parse the wall clock in UTC and apply signed minutes explicitly.
  IF right(lower(capture_text),1)='z' THEN
    raw_capture := capture_text::timestamptz;
  ELSE
    offset_text := right(capture_text,6);
    raw_capture := (left(capture_text,length(capture_text)-6) || 'Z')::timestamptz -
      make_interval(mins => (CASE WHEN left(offset_text,1)='+' THEN 1 ELSE -1 END) *
        (substring(offset_text FROM 2 FOR 2)::integer*60 + substring(offset_text FROM 5 FOR 2)::integer));
  END IF;
  IF NOT isfinite(raw_capture) OR
     (parent.raw_payload->>'eventId')::uuid IS DISTINCT FROM parent.event_id OR
     (parent.raw_payload->>'streamSessionId')::uuid IS DISTINCT FROM parent.stream_session_id OR
     parent.raw_payload->>'cameraExternalId' IS DISTINCT FROM parent.camera_external_id OR
     date_trunc('milliseconds',raw_capture) IS DISTINCT FROM parent.captured_at THEN
    RAISE EXCEPTION 'MF06 request source payload metadata is inconsistent' USING ERRCODE='23514';
  END IF;
  observations := parent.raw_payload->'observations';
  IF jsonb_typeof(observations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'MF06 request source observations are invalid' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(observations) > 256 OR NEW.zone_observation_index < 0 OR
     NEW.zone_observation_index >= jsonb_array_length(observations) THEN
    RAISE EXCEPTION 'MF06 request Zone observation is unavailable' USING ERRCODE='23514';
  END IF;
  FOR observed IN SELECT value FROM jsonb_array_elements(observations) LOOP
    IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR
       jsonb_typeof(observed->'type') IS DISTINCT FROM 'string' OR
       observed->>'type' NOT IN ('PERSON','PPE','ZONE_ENTRY','IDENTITY_CANDIDATE') OR
       jsonb_typeof(observed->'trackId') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'MF06 request source observation is invalid' USING ERRCODE='23514';
    END IF;
    IF (observed->>'trackId')::numeric <> trunc((observed->>'trackId')::numeric) OR
       (observed->>'trackId')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN
      RAISE EXCEPTION 'MF06 request source Track ID is invalid' USING ERRCODE='23514';
    END IF;
  END LOOP;
  zone_observation := observations->NEW.zone_observation_index;
  IF zone_observation->>'type' IS DISTINCT FROM 'ZONE_ENTRY' OR
     (zone_observation->>'trackId')::numeric IS DISTINCT FROM NEW.track_id::numeric OR
     jsonb_typeof(zone_observation->'regionId') IS DISTINCT FROM 'string' OR
     jsonb_typeof(zone_observation->'geometryVersion') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'MF06 request Zone binding is inconsistent' USING ERRCODE='23514';
  END IF;
  IF (zone_observation->>'regionId')::uuid IS DISTINCT FROM NEW.region_id OR
     (zone_observation->>'geometryVersion')::numeric IS DISTINCT FROM NEW.geometry_version::numeric THEN
    RAISE EXCEPTION 'MF06 request geometry binding is inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT count(*), min(ordinality-1)::integer INTO person_count,person_index
    FROM jsonb_array_elements(observations) WITH ORDINALITY AS entries(value,ordinality)
    WHERE value->>'type'='PERSON' AND (value->>'trackId')::numeric=NEW.track_id;
  IF person_count=0 THEN expected_status := 'PERSON_NOT_FOUND';
  ELSIF person_count>1 THEN expected_status := 'AMBIGUOUS_PERSON_TRACK';
  ELSIF mf06_request_person_box_valid((observations->person_index)->'boundingBox') THEN expected_status := 'BOUND';
  ELSE expected_status := 'PERSON_BOX_UNAVAILABLE'; END IF;
  IF person_count<>1 THEN person_index := NULL; END IF;
  IF NEW.subject_binding_status IS DISTINCT FROM expected_status OR NEW.person_observation_index IS DISTINCT FROM person_index THEN
    RAISE EXCEPTION 'MF06 request PERSON binding is inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'MF06 request source values are invalid' USING ERRCODE='23514';
END $$;
CREATE TRIGGER trg_mf06_request_insert BEFORE INSERT ON zone_entry_assessment_request
  FOR EACH ROW EXECUTE FUNCTION mf06_request_insert_guard();

CREATE FUNCTION mf06_request_immutable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
  RAISE EXCEPTION 'MF06 assessment requests are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER trg_mf06_request_immutable BEFORE UPDATE OR DELETE ON zone_entry_assessment_request
  FOR EACH ROW EXECUTE FUNCTION mf06_request_immutable_guard();

CREATE FUNCTION mf06_storage_truncate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
DECLARE populated boolean;
BEGIN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO populated;
  IF populated THEN RAISE EXCEPTION 'MF06 assessment storage cannot be truncated' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_mf06_request_no_truncate BEFORE TRUNCATE ON zone_entry_assessment_request
  FOR EACH STATEMENT EXECUTE FUNCTION mf06_storage_truncate_guard();

CREATE FUNCTION mf06_request_parent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
  IF (NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash OR
      NEW.raw_payload IS DISTINCT FROM OLD.raw_payload OR NEW.camera_external_id IS DISTINCT FROM OLD.camera_external_id OR
      NEW.stream_session_id IS DISTINCT FROM OLD.stream_session_id OR NEW.captured_at IS DISTINCT FROM OLD.captured_at) AND
     EXISTS(SELECT 1 FROM zone_entry_assessment_request WHERE event_id=OLD.event_id) THEN
    RAISE EXCEPTION 'MF06 assessment source binding is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mf06_request_parent_update BEFORE UPDATE ON ai_observation_event
  FOR EACH ROW EXECUTE FUNCTION mf06_request_parent_guard();

CREATE FUNCTION mf06_job_head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MF06 job heads cannot be deleted' USING ERRCODE='23514'; END IF;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NEW.attempt_count < OLD.attempt_count OR NEW.head_revision::bigint <> OLD.head_revision::bigint+1 THEN
    RAISE EXCEPTION 'MF06 job head revision or immutable fields are invalid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_mf06_job_head_update BEFORE UPDATE OR DELETE ON zone_entry_assessment_job
  FOR EACH ROW EXECUTE FUNCTION mf06_job_head_guard();
CREATE TRIGGER trg_mf06_job_no_truncate BEFORE TRUNCATE ON zone_entry_assessment_job
  FOR EACH STATEMENT EXECUTE FUNCTION mf06_storage_truncate_guard();

    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const temporary = await runner.query(`SELECT 1 FROM pg_catalog.pg_class
      WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname IN
      ('ai_observation_event','site','zone','mf06_assessment_request','mf06_assessment_job','zone_entry_assessment_request','zone_entry_assessment_job')`);
    if (temporary.length)
      throw new Error('Temporary relations cannot shadow MF06 migration objects');

    const parents =
      await runner.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname IN ('ai_observation_event','site','zone','zone_entry_assessment_request','zone_entry_assessment_job')`);
    if (parents.length !== 5) throw new Error('Downgrade storage must belong to the target schema');

    // One statement stays atomic even when called outside MigrationExecutor.
    await runner.query(`DO $$ BEGIN
      LOCK TABLE zone_entry_assessment_job, zone_entry_assessment_request, ai_observation_event, zone IN ACCESS EXCLUSIVE MODE;
      IF EXISTS(SELECT 1 FROM zone_entry_assessment_request) OR EXISTS(SELECT 1 FROM zone_entry_assessment_job) THEN
        RAISE EXCEPTION 'Refusing to revert populated MF06 request/job storage' USING ERRCODE='23514';
      END IF;
      DROP TRIGGER trg_mf06_request_parent_update ON ai_observation_event;
      DROP TABLE zone_entry_assessment_job;
      DROP TABLE zone_entry_assessment_request;
      ALTER TABLE zone DROP CONSTRAINT uq_mf06_request_zone_scope;
      DROP FUNCTION mf06_request_parent_guard();
      DROP FUNCTION mf06_job_head_guard();
      DROP FUNCTION mf06_storage_truncate_guard();
      DROP FUNCTION mf06_request_immutable_guard();
      DROP FUNCTION mf06_request_insert_guard();
      DROP FUNCTION mf06_request_person_box_valid(jsonb);
    END $$;`);
  }
}
