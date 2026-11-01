import type { MigrationInterface, QueryRunner } from 'typeorm';

const rawColumns = [
  'tracking_scope_sha256',
  'tracking_generation_id',
  'tracking_site_id',
  'tracking_frame_id',
  'tracking_source_sequence',
  'tracking_part_index',
  'tracking_part_count',
  'tracking_frame_state',
  'tracking_pending_until',
  'tracking_frame_result',
  'tracking_transport_ack',
] as const;

/** Unregistered prototype. Storage is not a qualified profile, admission or notification route. */
export class TrackedSubjectStorage1795046400003 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Tracked storage requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE ai_observation_event IN ACCESS EXCLUSIVE MODE');
    await runner.query(`ALTER TABLE ai_observation_event
      ADD COLUMN tracking_scope_sha256 char(64), ADD COLUMN tracking_generation_id uuid,
      ADD COLUMN tracking_site_id uuid, ADD COLUMN tracking_frame_id uuid,
      ADD COLUMN tracking_source_sequence numeric(20,0), ADD COLUMN tracking_part_index smallint,
      ADD COLUMN tracking_part_count smallint, ADD COLUMN tracking_frame_state varchar(24),
      ADD COLUMN tracking_pending_until timestamptz, ADD COLUMN tracking_frame_result jsonb,
      ADD COLUMN tracking_transport_ack jsonb,
      ADD CONSTRAINT uq_ai_event_tracking_scope UNIQUE(event_id,tracking_scope_sha256,tracking_site_id,resolved_camera_id),
      ADD CONSTRAINT fk_ai_event_tracking_generation FOREIGN KEY(tracking_generation_id,resolved_camera_id,tracking_site_id,stream_session_id)
        REFERENCES camera_worker_generation(id,camera_id,site_id,stream_session_id) ON DELETE RESTRICT,
      ADD CONSTRAINT chk_ai_event_tracking_fields CHECK(
        (num_nonnulls(${rawColumns.join(',')})=0) OR (
          num_nonnulls(tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,
            tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,
            tracking_pending_until,tracking_transport_ack)=10
          AND resolved_camera_id IS NOT NULL AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$'
          AND tracking_source_sequence BETWEEN 0 AND 18446744073709551615
          AND tracking_part_count BETWEEN 1 AND 1024
          AND tracking_part_index>=0 AND tracking_part_index<tracking_part_count
          AND isfinite(tracking_pending_until)
          AND jsonb_typeof(tracking_transport_ack)='object'
          AND octet_length(tracking_transport_ack::text)<=1048576
          AND (tracking_frame_result IS NULL OR
            (jsonb_typeof(tracking_frame_result)='object' AND octet_length(tracking_frame_result::text)<=1048576))
          AND ((tracking_part_index>0 AND tracking_frame_state IN ('PART_STAGED','PART_EXPIRED') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('PENDING_PARTS','PENDING_PREDECESSOR') AND tracking_frame_result IS NULL)
            OR (tracking_part_index=0 AND tracking_frame_state IN ('SEALED','REVIEW_ONLY') AND tracking_frame_result IS NOT NULL))
          AND (raw_payload->>'schemaVersion'='1.5.0'
            AND lower(raw_payload->>'eventId')=event_id::text
            AND lower(raw_payload->>'streamSessionId')=stream_session_id::text
            AND raw_payload#>>'{framePartition,frameId}'=tracking_frame_id::text
            AND raw_payload#>>'{framePartition,sequenceNumber}'=tracking_source_sequence::text
            AND raw_payload#>>'{framePartition,partIndex}'=tracking_part_index::text
            AND raw_payload#>>'{framePartition,partCount}'=tracking_part_count::text) IS TRUE
        ) IS TRUE)`);
    await runner.query(`CREATE UNIQUE INDEX uq_ai_tracking_frame_part ON ai_observation_event
      (resolved_camera_id,tracking_generation_id,stream_session_id,tracking_frame_id,tracking_part_index)
      WHERE tracking_scope_sha256 IS NOT NULL`);
    await runner.query(`CREATE UNIQUE INDEX uq_ai_tracking_coordinator_sequence ON ai_observation_event
      (resolved_camera_id,tracking_generation_id,stream_session_id,tracking_source_sequence)
      WHERE tracking_part_index=0`);
    await runner.query(`CREATE INDEX idx_ai_tracking_frame_parts ON ai_observation_event
      (resolved_camera_id,tracking_generation_id,stream_session_id,tracking_source_sequence,tracking_part_index)
      WHERE tracking_scope_sha256 IS NOT NULL`);
    await runner.query(`CREATE INDEX idx_ai_tracking_watermark ON ai_observation_event
      (resolved_camera_id,tracking_generation_id,stream_session_id,tracking_source_sequence DESC,event_id DESC)
      WHERE tracking_part_index=0 AND tracking_frame_state='SEALED'`);
    await runner.query(`CREATE INDEX idx_ai_tracking_pending ON ai_observation_event
      (tracking_pending_until,resolved_camera_id,tracking_generation_id,stream_session_id,tracking_frame_id)
      WHERE tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')`);

    await runner.query(`CREATE TABLE ai_subject_segment (
      segment_id uuid PRIMARY KEY, scope_sha256 char(64) NOT NULL,
      site_id uuid NOT NULL, camera_id uuid NOT NULL, generation_id uuid NOT NULL,
      stream_session_id uuid NOT NULL, configuration_version bigint NOT NULL, view_revision bigint NOT NULL,
      bundle_sha256 char(64) NOT NULL, profile_sha256 char(64) NOT NULL, source_kind varchar(8) NOT NULL,
      first_event_id uuid, first_person_observation_index smallint,
      head_event_id uuid, head_person_observation_index smallint,
      head_source_sequence numeric(20,0), head_captured_at timestamptz,
      state varchar(8) NOT NULL, retired_at timestamptz, retirement_reason varchar(64),
      retirement_event_id uuid REFERENCES ai_observation_event(event_id) ON DELETE RESTRICT,
      retirement_provenance jsonb,
      CONSTRAINT uq_ai_subject_segment_scope UNIQUE(segment_id,scope_sha256,site_id,camera_id),
      CONSTRAINT fk_ai_segment_generation FOREIGN KEY(generation_id,camera_id,site_id,stream_session_id)
        REFERENCES camera_worker_generation(id,camera_id,site_id,stream_session_id) ON DELETE RESTRICT,
      CONSTRAINT fk_ai_segment_bundle FOREIGN KEY(camera_id,configuration_version,site_id,view_revision,bundle_sha256)
        REFERENCES camera_configuration_bundle(camera_id,configuration_version,site_id,view_revision,bundle_sha256) ON DELETE RESTRICT,
      CONSTRAINT fk_ai_segment_first FOREIGN KEY(first_event_id,scope_sha256,site_id,camera_id)
        REFERENCES ai_observation_event(event_id,tracking_scope_sha256,tracking_site_id,resolved_camera_id) ON DELETE RESTRICT,
      CONSTRAINT fk_ai_segment_head FOREIGN KEY(head_event_id,scope_sha256,site_id,camera_id)
        REFERENCES ai_observation_event(event_id,tracking_scope_sha256,tracking_site_id,resolved_camera_id) ON DELETE RESTRICT,
      CONSTRAINT chk_ai_segment_hashes CHECK(scope_sha256 ~ '^[a-f0-9]{64}$' AND bundle_sha256 ~ '^[a-f0-9]{64}$' AND profile_sha256 ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_ai_segment_source CHECK(source_kind IN ('LIVE','REPLAY')),
      CONSTRAINT chk_ai_segment_versions CHECK(configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_ai_segment_references CHECK(
        ((first_event_id IS NULL AND first_person_observation_index IS NULL AND
          num_nonnulls(head_event_id,head_person_observation_index,head_source_sequence,head_captured_at)=0)
        OR (first_event_id IS NOT NULL AND first_person_observation_index BETWEEN 0 AND 255
          AND num_nonnulls(head_event_id,head_person_observation_index,head_source_sequence,head_captured_at)=4
          AND head_person_observation_index BETWEEN 0 AND 255 AND isfinite(head_captured_at)
          AND head_source_sequence BETWEEN 0 AND 18446744073709551615)) IS TRUE),
      CONSTRAINT chk_ai_segment_lifecycle CHECK(
        ((state='ACTIVE' AND first_event_id IS NOT NULL AND num_nonnulls(retired_at,retirement_reason,retirement_event_id,retirement_provenance)=0)
        OR (state='RETIRED' AND retired_at IS NOT NULL AND isfinite(retired_at)
          AND retirement_reason ~ '^[A-Z_]{1,64}$' AND jsonb_typeof(retirement_provenance)='object'
          AND octet_length(retirement_provenance::text)<=1048576)) IS TRUE)
    )`);
    await runner.query(`CREATE INDEX idx_ai_segment_active_scope ON ai_subject_segment
      (camera_id,generation_id,stream_session_id,scope_sha256,segment_id) WHERE state='ACTIVE'`);
    await runner.query(`CREATE INDEX idx_ai_segment_active_capture ON ai_subject_segment
      (head_captured_at,segment_id) WHERE state='ACTIVE'`);
    await runner.query(
      `CREATE INDEX idx_ai_segment_first_event ON ai_subject_segment(first_event_id)`,
    );
    await runner.query(
      `CREATE INDEX idx_ai_segment_head_event ON ai_subject_segment(head_event_id)`,
    );
    await runner.query(
      `CREATE INDEX idx_ai_segment_retirement_event ON ai_subject_segment(retirement_event_id)`,
    );

    await runner.query(`CREATE FUNCTION guard_ai_tracking_raw() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN
        IF OLD.tracking_scope_sha256 IS NOT NULL THEN
          RAISE EXCEPTION 'Tracked raw history must be retained' USING ERRCODE='23514';
        END IF;
        RETURN OLD;
      END IF;
      IF OLD.tracking_scope_sha256 IS NOT NULL THEN
        IF OLD.tracking_frame_state='PART_STAGED' AND NEW.tracking_frame_state='PART_EXPIRED'
          AND EXISTS(SELECT 1 FROM ai_observation_event c
            WHERE c.resolved_camera_id=OLD.resolved_camera_id AND c.tracking_generation_id=OLD.tracking_generation_id
              AND c.stream_session_id=OLD.stream_session_id AND c.tracking_frame_id=OLD.tracking_frame_id
              AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED') THEN
          RAISE EXCEPTION 'A sealed frame member cannot expire' USING ERRCODE='23514';
        END IF;
        IF ROW(NEW.event_id,NEW.payload_hash,NEW.raw_payload,NEW.admission_context,NEW.resolved_camera_id,NEW.stream_session_id,NEW.captured_at,
          NEW.tracking_scope_sha256,NEW.tracking_generation_id,NEW.tracking_site_id,NEW.tracking_frame_id,NEW.tracking_source_sequence,
          NEW.tracking_part_index,NEW.tracking_part_count,NEW.tracking_pending_until,NEW.tracking_transport_ack)
          IS DISTINCT FROM ROW(OLD.event_id,OLD.payload_hash,OLD.raw_payload,OLD.admission_context,OLD.resolved_camera_id,OLD.stream_session_id,OLD.captured_at,
          OLD.tracking_scope_sha256,OLD.tracking_generation_id,OLD.tracking_site_id,OLD.tracking_frame_id,OLD.tracking_source_sequence,
          OLD.tracking_part_index,OLD.tracking_part_count,OLD.tracking_pending_until,OLD.tracking_transport_ack)
          OR (OLD.tracking_frame_state IN ('SEALED','REVIEW_ONLY','PART_EXPIRED') AND
            ROW(NEW.tracking_frame_state,NEW.tracking_frame_result) IS DISTINCT FROM ROW(OLD.tracking_frame_state,OLD.tracking_frame_result))
          OR NOT (NEW.tracking_frame_state=OLD.tracking_frame_state
            OR (OLD.tracking_frame_state='PART_STAGED' AND NEW.tracking_frame_state='PART_EXPIRED')
            OR (OLD.tracking_frame_state='PENDING_PARTS' AND NEW.tracking_frame_state IN ('PENDING_PREDECESSOR','SEALED','REVIEW_ONLY'))
            OR (OLD.tracking_frame_state='PENDING_PREDECESSOR' AND NEW.tracking_frame_state IN ('SEALED','REVIEW_ONLY'))) THEN
          RAISE EXCEPTION 'Tracked raw context or terminal outcome is immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
    await runner.query(`CREATE TRIGGER trg_ai_tracking_raw BEFORE UPDATE OR DELETE ON ai_observation_event
      FOR EACH ROW EXECUTE FUNCTION guard_ai_tracking_raw()`);
    await runner.query(`CREATE FUNCTION guard_ai_subject_segment() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE first_row record; head_row record; claim jsonb; claim_count bigint; sources_sealed boolean;
    BEGIN
      IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Segment technical history must be retained' USING ERRCODE='23514';
      END IF;
      IF TG_OP='UPDATE' THEN
        IF ROW(NEW.segment_id,NEW.scope_sha256,NEW.site_id,NEW.camera_id,NEW.generation_id,NEW.stream_session_id,
            NEW.configuration_version,NEW.view_revision,NEW.bundle_sha256,NEW.profile_sha256,NEW.source_kind,
            NEW.first_event_id,NEW.first_person_observation_index)
          IS DISTINCT FROM ROW(OLD.segment_id,OLD.scope_sha256,OLD.site_id,OLD.camera_id,OLD.generation_id,OLD.stream_session_id,
            OLD.configuration_version,OLD.view_revision,OLD.bundle_sha256,OLD.profile_sha256,OLD.source_kind,
            OLD.first_event_id,OLD.first_person_observation_index)
          OR (OLD.state='RETIRED' AND NEW IS DISTINCT FROM OLD)
          OR NEW.head_source_sequence<OLD.head_source_sequence OR NEW.head_captured_at<OLD.head_captured_at
          OR (NEW.head_source_sequence=OLD.head_source_sequence AND
            ROW(NEW.head_event_id,NEW.head_person_observation_index,NEW.head_captured_at)
            IS DISTINCT FROM ROW(OLD.head_event_id,OLD.head_person_observation_index,OLD.head_captured_at)) THEN
          RAISE EXCEPTION 'Segment scope, chronology or retirement is immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      IF NEW.first_event_id IS NOT NULL THEN
        SELECT * INTO first_row FROM ai_observation_event WHERE event_id=NEW.first_event_id FOR SHARE;
        SELECT * INTO head_row FROM ai_observation_event WHERE event_id=NEW.head_event_id FOR SHARE;
        SELECT count(*)=2 INTO sources_sealed
        FROM (VALUES (NEW.first_event_id),(NEW.head_event_id)) refs(id)
        JOIN ai_observation_event p ON p.event_id=refs.id
        JOIN ai_observation_event c ON c.resolved_camera_id=p.resolved_camera_id
          AND c.tracking_generation_id=p.tracking_generation_id AND c.stream_session_id=p.stream_session_id
          AND c.tracking_site_id=p.tracking_site_id AND c.tracking_scope_sha256=p.tracking_scope_sha256
          AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_source_sequence=p.tracking_source_sequence
          AND c.tracking_part_count=p.tracking_part_count AND c.captured_at=p.captured_at
          AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED'
          AND c.raw_payload#>>'{continuity,profileSha256}'=NEW.profile_sha256
        WHERE p.tracking_frame_state IN ('PART_STAGED','SEALED');
        IF first_row.tracking_scope_sha256 IS DISTINCT FROM NEW.scope_sha256 OR head_row.tracking_scope_sha256 IS DISTINCT FROM NEW.scope_sha256
          OR first_row.tracking_generation_id IS DISTINCT FROM NEW.generation_id OR head_row.tracking_generation_id IS DISTINCT FROM NEW.generation_id
          OR first_row.stream_session_id IS DISTINCT FROM NEW.stream_session_id OR head_row.stream_session_id IS DISTINCT FROM NEW.stream_session_id
          OR sources_sealed IS DISTINCT FROM true
          OR head_row.tracking_source_sequence IS DISTINCT FROM NEW.head_source_sequence OR head_row.captured_at IS DISTINCT FROM NEW.head_captured_at
          OR (first_row.raw_payload->'observations'->NEW.first_person_observation_index::int)->>'type' IS DISTINCT FROM 'PERSON'
          OR (head_row.raw_payload->'observations'->NEW.head_person_observation_index::int)->>'type' IS DISTINCT FROM 'PERSON'
          OR first_row.raw_payload#>>'{continuity,profileSha256}' IS DISTINCT FROM NEW.profile_sha256
          OR head_row.raw_payload#>>'{continuity,profileSha256}' IS DISTINCT FROM NEW.profile_sha256 THEN
          RAISE EXCEPTION 'Segment source must be an exact sealed PERSON' USING ERRCODE='23514';
        END IF;
        SELECT count(*),jsonb_agg(x)->0 INTO claim_count,claim FROM jsonb_array_elements(head_row.raw_payload#>'{continuity,subjects}') x
          WHERE x->>'personObservationIndex'=NEW.head_person_observation_index::text;
        IF claim_count<>1 OR claim->>'segmentId' IS DISTINCT FROM NEW.segment_id::text OR (TG_OP='INSERT' AND
          (NEW.first_event_id<>NEW.head_event_id OR NEW.first_person_observation_index<>NEW.head_person_observation_index OR claim#>>'{link,kind}' IS DISTINCT FROM 'START'))
          OR (TG_OP='UPDATE' AND NEW.head_source_sequence>OLD.head_source_sequence AND
            (claim#>>'{link,kind}' IS DISTINCT FROM 'CONTINUE'
             OR claim#>>'{link,previousEventId}' IS DISTINCT FROM OLD.head_event_id::text
             OR claim#>>'{link,previousPersonObservationIndex}' IS DISTINCT FROM OLD.head_person_observation_index::text)) THEN
          RAISE EXCEPTION 'Segment must reference its exact previous PERSON head' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END $$`);
    await runner.query(`CREATE TRIGGER trg_ai_subject_segment BEFORE INSERT OR UPDATE OR DELETE ON ai_subject_segment
      FOR EACH ROW EXECUTE FUNCTION guard_ai_subject_segment()`);

    await runner.query(`ALTER TABLE safety_episode
      ADD COLUMN subject_kind varchar(16) NOT NULL DEFAULT 'EVENT_LOCAL',
      ADD COLUMN tracking_segment_id uuid, ADD COLUMN tracking_scope_sha256 char(64),
      ADD CONSTRAINT chk_safety_episode_subject_kind CHECK (
        (subject_kind='EVENT_LOCAL' AND tracking_segment_id IS NULL AND tracking_scope_sha256 IS NULL)
        OR (subject_kind='TRACKED' AND tracking_segment_id IS NOT NULL AND tracking_scope_sha256 IS NOT NULL
          AND tracking_scope_sha256 ~ '^[a-f0-9]{64}$')),
      ADD CONSTRAINT fk_safety_episode_tracked_scope FOREIGN KEY
        (tracking_segment_id,tracking_scope_sha256,site_id,camera_id)
        REFERENCES ai_subject_segment(segment_id,scope_sha256,site_id,camera_id) ON DELETE RESTRICT`);
    await runner.query(`CREATE UNIQUE INDEX uq_safety_episode_tracking_segment ON safety_episode(tracking_segment_id)
      WHERE subject_kind='TRACKED'`);
    await runner.query(`CREATE FUNCTION guard_safety_episode_tracking() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_event record; claims bigint;
    BEGIN
      IF TG_OP='DELETE' THEN
        IF OLD.subject_kind='TRACKED' THEN
          RAISE EXCEPTION 'Tracked episode history must be retained' USING ERRCODE='23514';
        END IF;
        RETURN OLD;
      END IF;
      IF TG_OP='UPDATE' THEN
        IF ROW(NEW.subject_kind,NEW.tracking_segment_id,NEW.tracking_scope_sha256)
          IS DISTINCT FROM ROW(OLD.subject_kind,OLD.tracking_segment_id,OLD.tracking_scope_sha256) THEN
          RAISE EXCEPTION 'Episode subject discriminator is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END IF;
      SELECT * INTO source_event FROM ai_observation_event WHERE event_id=NEW.event_id FOR SHARE;
      IF NEW.subject_kind='EVENT_LOCAL' THEN
        IF source_event.tracking_scope_sha256 IS NOT NULL THEN
          RAISE EXCEPTION 'Tracked subjects cannot use event-local projection' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END IF;
      IF source_event.tracking_scope_sha256 IS DISTINCT FROM NEW.tracking_scope_sha256
        OR source_event.tracking_site_id IS DISTINCT FROM NEW.site_id
        OR source_event.resolved_camera_id IS DISTINCT FROM NEW.camera_id
        OR NOT EXISTS(SELECT 1 FROM ai_observation_event c
          WHERE c.resolved_camera_id=source_event.resolved_camera_id AND c.tracking_site_id=NEW.site_id
          AND c.tracking_generation_id=source_event.tracking_generation_id
          AND c.stream_session_id=source_event.stream_session_id AND c.tracking_scope_sha256=NEW.tracking_scope_sha256
          AND c.tracking_frame_id=source_event.tracking_frame_id AND c.tracking_source_sequence=source_event.tracking_source_sequence
          AND c.tracking_part_count=source_event.tracking_part_count AND c.captured_at=source_event.captured_at
          AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED') THEN
        RAISE EXCEPTION 'Tracked episode needs an original sealed subject' USING ERRCODE='23514';
      END IF;
      SELECT count(*) INTO claims FROM jsonb_array_elements(source_event.raw_payload#>'{continuity,subjects}') x
        WHERE x->>'personObservationIndex'=NEW.person_observation_index::text;
      IF claims<>1 THEN
        RAISE EXCEPTION 'Tracked episode original PERSON mismatch' USING ERRCODE='23514';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_event.raw_payload#>'{continuity,subjects}') x
        WHERE x->>'personObservationIndex'=NEW.person_observation_index::text AND x->>'segmentId'=NEW.tracking_segment_id::text) THEN
        RAISE EXCEPTION 'Tracked episode segment mismatch' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`);
    await runner.query(`CREATE TRIGGER trg_safety_episode_tracking BEFORE INSERT OR UPDATE OR DELETE ON safety_episode
      FOR EACH ROW EXECUTE FUNCTION guard_safety_episode_tracking()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Tracked storage requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE safety_episode,ai_subject_segment,ai_observation_event IN ACCESS EXCLUSIVE MODE',
    );
    const [{ has_history }] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM ai_subject_segment) OR
      EXISTS(SELECT 1 FROM safety_episode WHERE subject_kind='TRACKED') OR
      EXISTS(SELECT 1 FROM ai_observation_event WHERE tracking_scope_sha256 IS NOT NULL) AS has_history`);
    if (has_history) throw new Error('Tracked technical history must be retained');
    await runner.query('DROP TRIGGER trg_safety_episode_tracking ON safety_episode');
    await runner.query('DROP FUNCTION guard_safety_episode_tracking()');
    await runner.query(`ALTER TABLE safety_episode DROP CONSTRAINT fk_safety_episode_tracked_scope,
      DROP COLUMN subject_kind,DROP COLUMN tracking_segment_id,DROP COLUMN tracking_scope_sha256`);
    await runner.query('DROP TABLE ai_subject_segment');
    await runner.query('DROP FUNCTION guard_ai_subject_segment()');
    await runner.query('DROP TRIGGER trg_ai_tracking_raw ON ai_observation_event');
    await runner.query('DROP FUNCTION guard_ai_tracking_raw()');
    await runner.query(`ALTER TABLE ai_observation_event DROP CONSTRAINT fk_ai_event_tracking_generation,
      DROP CONSTRAINT uq_ai_event_tracking_scope,
      ${rawColumns.map((name) => `DROP COLUMN ${name}`).join(',')}`);
  }
}
