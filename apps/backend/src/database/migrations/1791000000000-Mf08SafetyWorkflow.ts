import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Mf08SafetyWorkflow1791000000000 implements MigrationInterface {
  name = 'Mf08SafetyWorkflow1791000000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE incident (
        id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES site(id),
        zone_id uuid REFERENCES zone(id), title varchar(200) NOT NULL CHECK(length(trim(title))>0),
        description text NOT NULL CHECK(length(trim(description))>0),
        severity varchar(16) NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
        status varchar(16) NOT NULL CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','VERIFIED','CLOSED','REOPENED')),
        occurred_at timestamptz NOT NULL, reported_by uuid NOT NULL REFERENCES app_user(id),
        closed_by uuid REFERENCES app_user(id), closed_at timestamptz,
        version integer NOT NULL DEFAULT 1 CHECK(version>=1),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_incident_closure CHECK (
          (status='CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL) OR
          (status<>'CLOSED' AND closed_by IS NULL AND closed_at IS NULL))
      );
      ALTER TABLE safety_alert ADD COLUMN incident_id uuid REFERENCES incident(id);
      CREATE INDEX idx_alert_incident ON safety_alert(incident_id) WHERE incident_id IS NOT NULL;
      CREATE INDEX idx_incident_site_order ON incident(site_id,created_at DESC,id DESC);
      CREATE TABLE safety_evidence (
        id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES site(id), storage_key varchar(64) NOT NULL UNIQUE,
        media_type varchar(32) NOT NULL CHECK(media_type='image/jpeg'),
        sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
        size integer NOT NULL CHECK(size BETWEEN 1 AND 1048576),
        uploaded_by uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE corrective_action (
        id uuid PRIMARY KEY, incident_id uuid NOT NULL REFERENCES incident(id),
        assigned_to uuid NOT NULL REFERENCES app_user(id), assigned_by uuid NOT NULL REFERENCES app_user(id),
        description text NOT NULL CHECK(length(trim(description))>0), due_at timestamptz,
        status varchar(16) NOT NULL CHECK(status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','VERIFIED','CLOSED')),
        version integer NOT NULL DEFAULT 1 CHECK(version>=1),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_action_incident ON corrective_action(incident_id,id);
      CREATE INDEX idx_action_assignee ON corrective_action(assigned_to,incident_id);
      CREATE TABLE corrective_action_submission (
        id uuid PRIMARY KEY, corrective_action_id uuid NOT NULL REFERENCES corrective_action(id),
        submitted_by uuid NOT NULL REFERENCES app_user(id),
        result_description text NOT NULL CHECK(length(trim(result_description))>0),
        evidence_id uuid REFERENCES safety_evidence(id), submitted_at timestamptz NOT NULL,
        status varchar(16) NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        reviewed_by uuid REFERENCES app_user(id), reviewed_at timestamptz, review_note text,
        CONSTRAINT chk_submission_review CHECK (
          (status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR
          (status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_by<>submitted_by AND
           reviewed_at IS NOT NULL AND review_note IS NOT NULL AND length(trim(review_note))>0))
      );
      CREATE UNIQUE INDEX uq_action_pending_submission ON corrective_action_submission(corrective_action_id) WHERE status='PENDING';
      CREATE TABLE safety_task (
        id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES site(id), zone_id uuid REFERENCES zone(id),
        kind varchar(32) NOT NULL CHECK(kind IN ('ZONE_INSPECTION','ALERT_VERIFICATION','SAFETY_FOLLOW_UP','SAFETY_PATROL')),
        source_alert_id uuid REFERENCES safety_alert(id), source_incident_id uuid REFERENCES incident(id),
        assigned_to uuid NOT NULL REFERENCES app_user(id), assigned_by uuid NOT NULL REFERENCES app_user(id),
        description text NOT NULL CHECK(length(trim(description))>0), due_at timestamptz,
        status varchar(16) NOT NULL CHECK(status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','VERIFIED','CANCELLED')),
        result_summary text, result_evidence_id uuid REFERENCES safety_evidence(id), completed_at timestamptz,
        verified_by uuid REFERENCES app_user(id), verified_at timestamptz,
        version integer NOT NULL DEFAULT 1 CHECK(version>=1),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_task_completed CHECK (
          status NOT IN ('COMPLETED','VERIFIED') OR (completed_at IS NOT NULL AND result_summary IS NOT NULL AND length(trim(result_summary))>0)),
        CONSTRAINT chk_task_verification CHECK (
          (status='VERIFIED' AND verified_by IS NOT NULL AND verified_by<>assigned_to AND verified_at IS NOT NULL) OR
          (status<>'VERIFIED' AND verified_by IS NULL AND verified_at IS NULL))
      );
      CREATE INDEX idx_task_site_order ON safety_task(site_id,created_at DESC,id DESC);
      CREATE INDEX idx_task_assignee ON safety_task(site_id,assigned_to,status);
      CREATE TABLE safety_workflow_audit (
        id uuid PRIMARY KEY, command_id uuid NOT NULL UNIQUE,
        actor_id uuid NOT NULL REFERENCES app_user(id), site_id uuid NOT NULL REFERENCES site(id),
        resource_type varchar(16) NOT NULL CHECK(resource_type IN ('INCIDENT','SAFETY_TASK')),
        resource_id uuid NOT NULL, action varchar(32) NOT NULL, reason text,
        input_hash varchar(64) NOT NULL, changes jsonb NOT NULL, result jsonb NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_workflow_audit_resource ON safety_workflow_audit(site_id,resource_type,resource_id,occurred_at,id);
      CREATE FUNCTION mf08_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_TABLE_NAME = 'safety_workflow_audit' OR TG_OP = 'DELETE' OR OLD.status <> 'PENDING' THEN
          RAISE EXCEPTION 'MF08 history is immutable';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.corrective_action_id IS DISTINCT FROM OLD.corrective_action_id
          OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by OR NEW.result_description IS DISTINCT FROM OLD.result_description
          OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
          OR NEW.status = 'PENDING' THEN RAISE EXCEPTION 'Only a pending submission decision may be written'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER immutable_workflow_audit BEFORE UPDATE OR DELETE ON safety_workflow_audit FOR EACH ROW EXECUTE FUNCTION mf08_immutable_history();
      CREATE TRIGGER immutable_submission BEFORE UPDATE OR DELETE ON corrective_action_submission FOR EACH ROW EXECUTE FUNCTION mf08_immutable_history();
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DROP TABLE safety_workflow_audit, safety_task, corrective_action_submission, corrective_action, safety_evidence;
      DROP FUNCTION mf08_immutable_history();
      ALTER TABLE safety_alert DROP COLUMN incident_id;
      DROP TABLE incident;
    `);
  }
}
