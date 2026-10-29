import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Candidate only: registration and runtime cutover require separate reviewed delivery. */
export class SafetyEpisodes1794355200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Episode migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`CREATE TABLE safety_episode (
      id uuid PRIMARY KEY,
      site_id uuid NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
      camera_id uuid NOT NULL REFERENCES camera(id) ON DELETE RESTRICT,
      event_id uuid NOT NULL REFERENCES ai_observation_event(event_id) ON DELETE RESTRICT,
      person_observation_index smallint NOT NULL CHECK(person_observation_index BETWEEN 0 AND 255),
      payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
      first_observed_at timestamptz NOT NULL,
      last_observed_at timestamptz NOT NULL,
      content_revision integer NOT NULL DEFAULT 1 CHECK(content_revision BETWEEN 1 AND 2147483647),
      collection_state varchar(16) NOT NULL DEFAULT 'COLLECTING' CHECK(collection_state IN ('COLLECTING','SEALED')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT uq_safety_episode_id_site UNIQUE(id,site_id),
      CONSTRAINT uq_safety_episode_event_subject UNIQUE(event_id,person_observation_index),
      CONSTRAINT chk_safety_episode_interval CHECK(last_observed_at>=first_observed_at)
    )`);
    await runner.query(
      `CREATE INDEX idx_safety_episode_site_first ON safety_episode(site_id,first_observed_at DESC,id DESC)`,
    );
    await runner.query(`CREATE INDEX idx_safety_episode_camera ON safety_episode(camera_id)`);
    await runner.query(`CREATE TABLE safety_episode_recipient (
      id uuid PRIMARY KEY,
      episode_id uuid NOT NULL,
      site_id uuid NOT NULL,
      recipient_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
      seen_revision integer NOT NULL DEFAULT 0 CHECK(seen_revision>=0),
      first_delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT fk_safety_episode_recipient_scope FOREIGN KEY(episode_id,site_id)
        REFERENCES safety_episode(id,site_id) ON DELETE RESTRICT,
      CONSTRAINT uq_safety_episode_recipient UNIQUE(recipient_user_id,episode_id)
    )`);
    await runner.query(
      `CREATE INDEX idx_safety_episode_recipient_episode ON safety_episode_recipient(episode_id,site_id)`,
    );
    await runner.query(
      `CREATE INDEX idx_safety_episode_recipient_list ON safety_episode_recipient(recipient_user_id,first_delivered_at DESC,id DESC)`,
    );
    await runner.query(`ALTER TABLE safety_alert ADD COLUMN episode_id uuid NULL,
      ADD CONSTRAINT fk_safety_alert_episode_scope FOREIGN KEY(episode_id,site_id)
        REFERENCES safety_episode(id,site_id) ON DELETE RESTRICT`);
    await runner.query(
      `CREATE INDEX idx_safety_alert_episode ON safety_alert(episode_id) WHERE episode_id IS NOT NULL`,
    );
    await runner.query(`CREATE FUNCTION guard_safety_episode_context() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE source_event record; person jsonb; matching_people integer;
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF ROW(NEW.id,NEW.site_id,NEW.camera_id,NEW.event_id,NEW.person_observation_index,NEW.payload_hash,NEW.first_observed_at,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.site_id,OLD.camera_id,OLD.event_id,OLD.person_observation_index,OLD.payload_hash,OLD.first_observed_at,OLD.created_at)
          OR NEW.content_revision<OLD.content_revision OR NEW.last_observed_at<OLD.last_observed_at
          OR (OLD.collection_state='SEALED' AND NEW.collection_state<>'SEALED') THEN
          RAISE EXCEPTION 'Episode context is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END IF;
      SELECT e.payload_hash,e.raw_payload,e.captured_at INTO source_event
        FROM ai_observation_event e JOIN camera c ON c.id=e.resolved_camera_id
        WHERE e.event_id=NEW.event_id AND c.id=NEW.camera_id AND c.site_id=NEW.site_id FOR SHARE OF e,c;
      IF NOT FOUND OR source_event.payload_hash<>NEW.payload_hash
        OR source_event.captured_at<>NEW.first_observed_at
        OR jsonb_typeof(source_event.raw_payload->'observations') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Episode source scope mismatch' USING ERRCODE='23514';
      END IF;
      person := source_event.raw_payload->'observations'->NEW.person_observation_index::integer;
      IF person->>'type' IS DISTINCT FROM 'PERSON' OR person->>'trackId' IS NULL THEN
        RAISE EXCEPTION 'Episode subject unavailable' USING ERRCODE='23514';
      END IF;
      SELECT count(*) INTO matching_people FROM jsonb_array_elements(source_event.raw_payload->'observations') x
        WHERE x->>'type'='PERSON' AND x->'trackId'=person->'trackId';
      IF matching_people<>1 THEN
        RAISE EXCEPTION 'Episode subject ambiguous' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`);
    await runner.query(`CREATE TRIGGER trg_safety_episode_context BEFORE INSERT OR UPDATE ON safety_episode
      FOR EACH ROW EXECUTE FUNCTION guard_safety_episode_context()`);
    await runner.query(`CREATE FUNCTION guard_safety_episode_seen_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE current_revision integer;
    BEGIN
      IF TG_OP='UPDATE' AND (
        ROW(NEW.id,NEW.episode_id,NEW.site_id,NEW.recipient_user_id,NEW.first_delivered_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.episode_id,OLD.site_id,OLD.recipient_user_id,OLD.first_delivered_at)
        OR NEW.seen_revision<OLD.seen_revision) THEN
        RAISE EXCEPTION 'Episode recipient context or seen revision is immutable' USING ERRCODE='23514';
      END IF;
      SELECT content_revision INTO current_revision FROM safety_episode
        WHERE id=NEW.episode_id AND site_id=NEW.site_id FOR SHARE;
      IF NOT FOUND OR NEW.seen_revision>current_revision THEN
        RAISE EXCEPTION 'Episode seen revision exceeds current revision' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$`);
    await runner.query(`CREATE TRIGGER trg_safety_episode_seen_revision BEFORE INSERT OR UPDATE ON safety_episode_recipient
      FOR EACH ROW EXECUTE FUNCTION guard_safety_episode_seen_revision()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Episode migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE safety_episode,safety_episode_recipient,safety_alert IN ACCESS EXCLUSIVE MODE',
    );
    const [used] = await runner.query(`SELECT EXISTS(SELECT 1 FROM safety_episode)
      OR EXISTS(SELECT 1 FROM safety_episode_recipient)
      OR EXISTS(SELECT 1 FROM safety_alert WHERE episode_id IS NOT NULL) AS present`);
    if (used.present) throw new Error('Episode history must be preserved before rollback');
    await runner.query(
      'ALTER TABLE safety_alert DROP CONSTRAINT fk_safety_alert_episode_scope, DROP COLUMN episode_id',
    );
    await runner.query('DROP TABLE safety_episode_recipient');
    await runner.query('DROP TABLE safety_episode');
    await runner.query('DROP FUNCTION guard_safety_episode_seen_revision()');
    await runner.query('DROP FUNCTION guard_safety_episode_context()');
  }
}
