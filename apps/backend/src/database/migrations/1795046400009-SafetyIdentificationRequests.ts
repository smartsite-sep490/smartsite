import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Explicit identification profile only; operational rollout requires its own qualification. */
export class SafetyIdentificationRequests1795046400009 implements MigrationInterface {
  name = 'SafetyIdentificationRequests1795046400009';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`CREATE TABLE safety_identification_request (
      id uuid PRIMARY KEY,
      site_id uuid NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
      episode_id uuid NOT NULL,
      assigned_to uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
      requested_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
      status varchar(16) NOT NULL DEFAULT 'OPEN'
        CHECK(status IN ('OPEN','RESPONDED','CLOSED','CANCELLED')),
      version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 2147483647),
      reason varchar(2000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
      due_at timestamptz CHECK(due_at IS NULL OR isfinite(due_at)),
      current_result_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT fk_safety_identification_episode FOREIGN KEY(episode_id,site_id)
        REFERENCES safety_episode(id,site_id) ON DELETE RESTRICT,
      CONSTRAINT uq_safety_identification_request_site UNIQUE(id,site_id),
      CONSTRAINT chk_safety_identification_timestamps CHECK(
        isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at),
      CONSTRAINT chk_safety_identification_response CHECK(
        status NOT IN ('RESPONDED','CLOSED') OR current_result_id IS NOT NULL)
    )`);
    await runner.query(`CREATE UNIQUE INDEX uq_safety_identification_active_subject
      ON safety_identification_request(episode_id)
      WHERE status IN ('OPEN','RESPONDED')`);
    await runner.query(`CREATE INDEX idx_safety_identification_assignee
      ON safety_identification_request(assigned_to,site_id,created_at DESC,id DESC)`);
    await runner.query(`CREATE INDEX idx_safety_identification_site
      ON safety_identification_request(site_id,created_at DESC,id DESC)`);
    await runner.query(`CREATE TABLE safety_identification_action (
      command_id uuid PRIMARY KEY,
      request_id uuid NOT NULL,
      site_id uuid NOT NULL,
      actor_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
      request_version integer NOT NULL CHECK(request_version BETWEEN 1 AND 2147483647),
      kind varchar(16) NOT NULL CHECK(kind IN ('CREATE','RESPOND','ACCEPT','RETURN','REASSIGN','CANCEL')),
      request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
      payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16384),
      result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
      CONSTRAINT fk_safety_identification_action_request FOREIGN KEY(request_id,site_id)
        REFERENCES safety_identification_request(id,site_id) ON DELETE RESTRICT,
      CONSTRAINT uq_safety_identification_action_version UNIQUE(request_id,request_version),
      CONSTRAINT uq_safety_identification_action_scope UNIQUE(command_id,request_id,site_id)
    )`);
    await runner.query(`ALTER TABLE safety_identification_request
      ADD CONSTRAINT fk_safety_identification_result FOREIGN KEY(current_result_id,id,site_id)
        REFERENCES safety_identification_action(command_id,request_id,site_id)
        DEFERRABLE INITIALLY DEFERRED`);
    await runner.query(`CREATE FUNCTION guard_safety_identification_action() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Identification history is append-only' USING ERRCODE='23514';
      END $$`);
    await runner.query(`CREATE TRIGGER trg_safety_identification_action_immutable
      BEFORE UPDATE OR DELETE ON safety_identification_action
      FOR EACH ROW EXECUTE FUNCTION guard_safety_identification_action()`);
    await runner.query(`CREATE FUNCTION guard_safety_identification_context() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN
          RAISE EXCEPTION 'Identification context is retained' USING ERRCODE='23514';
        END IF;
        IF ROW(NEW.id,NEW.site_id,NEW.episode_id,NEW.requested_by,NEW.reason,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.site_id,OLD.episode_id,OLD.requested_by,OLD.reason,OLD.created_at)
          OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at
          OR OLD.status IN ('CLOSED','CANCELLED')
          OR NOT (
            (OLD.status='OPEN' AND NEW.status IN ('OPEN','RESPONDED','CANCELLED'))
            OR (OLD.status='RESPONDED' AND NEW.status IN ('OPEN','CLOSED','CANCELLED'))
          )
          THEN RAISE EXCEPTION 'Invalid identification transition' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER trg_safety_identification_context
      BEFORE UPDATE OR DELETE ON safety_identification_request
      FOR EACH ROW EXECUTE FUNCTION guard_safety_identification_context()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM safety_identification_request)
        OR EXISTS(SELECT 1 FROM safety_identification_action) THEN
        RAISE EXCEPTION 'Identification history must be retained' USING ERRCODE='23514';
      END IF;
    END $$`);
    await runner.query(
      'ALTER TABLE safety_identification_request DROP CONSTRAINT fk_safety_identification_result',
    );
    await runner.query('DROP TABLE safety_identification_action');
    await runner.query('DROP TABLE safety_identification_request');
    await runner.query('DROP FUNCTION guard_safety_identification_action()');
    await runner.query('DROP FUNCTION guard_safety_identification_context()');
  }
}
