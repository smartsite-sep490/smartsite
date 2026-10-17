import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SafetyChecklists1792195200000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE safety_checklist_assignment (
   id uuid PRIMARY KEY,site_id uuid NOT NULL CONSTRAINT fk_checklist_site REFERENCES site(id) ON DELETE RESTRICT,
   contractor_id uuid NOT NULL CONSTRAINT fk_checklist_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
   team_id uuid NOT NULL,zone_id uuid NOT NULL CONSTRAINT fk_checklist_zone REFERENCES zone(id) ON DELETE RESTRICT,
   description varchar(2000) NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
   assigned_to uuid NOT NULL CONSTRAINT fk_checklist_assignee REFERENCES app_user(id) ON DELETE RESTRICT,
   assigned_by uuid NOT NULL CONSTRAINT fk_checklist_creator REFERENCES app_user(id) ON DELETE RESTRICT,
   status varchar(16) NOT NULL DEFAULT 'ASSIGNED',version integer NOT NULL DEFAULT 1,
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
   CONSTRAINT fk_checklist_team_scope FOREIGN KEY(team_id,site_id,contractor_id) REFERENCES contractor_team(id,site_id,contractor_id) ON DELETE RESTRICT,
   CONSTRAINT ck_checklist_status CHECK(status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')),
   CONSTRAINT ck_checklist_version CHECK(version>0),CONSTRAINT ck_checklist_interval CHECK(ends_at>starts_at),
   CONSTRAINT ck_checklist_description CHECK(char_length(trim(description)) BETWEEN 1 AND 2000)
  );
  CREATE INDEX idx_checklist_site_created ON safety_checklist_assignment(site_id,created_at,id);
  CREATE INDEX idx_checklist_assignee ON safety_checklist_assignment(assigned_to,status);
  CREATE TABLE safety_checklist_item (
   id uuid PRIMARY KEY,assignment_id uuid NOT NULL CONSTRAINT fk_checklist_item_assignment REFERENCES safety_checklist_assignment(id) ON DELETE RESTRICT,
   position integer NOT NULL,text varchar(1000) NOT NULL,evidence_required boolean NOT NULL,
   CONSTRAINT uq_checklist_item_scope UNIQUE(id,assignment_id),CONSTRAINT uq_checklist_item_position UNIQUE(assignment_id,position),
   CONSTRAINT ck_checklist_item_text CHECK(char_length(trim(text)) BETWEEN 1 AND 1000),CONSTRAINT ck_checklist_item_position CHECK(position BETWEEN 0 AND 29)
  );
  CREATE TABLE safety_checklist_submission (
   id uuid PRIMARY KEY,assignment_id uuid NOT NULL CONSTRAINT fk_checklist_submission_assignment REFERENCES safety_checklist_assignment(id) ON DELETE RESTRICT,
   submitted_by uuid NOT NULL CONSTRAINT fk_checklist_submitter REFERENCES app_user(id) ON DELETE RESTRICT,
   submitted_at timestamptz NOT NULL DEFAULT now(),status varchar(16) NOT NULL DEFAULT 'PENDING',
   reviewed_by uuid CONSTRAINT fk_checklist_reviewer REFERENCES app_user(id) ON DELETE RESTRICT,reviewed_at timestamptz,review_note varchar(2000),
   CONSTRAINT uq_checklist_submission_scope UNIQUE(id,assignment_id),
   CONSTRAINT ck_checklist_submission_status CHECK(status IN ('PENDING','ACCEPTED','RETURNED')),
   CONSTRAINT ck_checklist_review CHECK((status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR (status IN ('ACCEPTED','RETURNED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND char_length(trim(review_note)) BETWEEN 1 AND 2000 AND reviewed_by<>submitted_by))
  );
  CREATE UNIQUE INDEX uq_checklist_pending ON safety_checklist_submission(assignment_id) WHERE status='PENDING';
  CREATE TABLE safety_checklist_item_result (
   id uuid PRIMARY KEY,assignment_id uuid NOT NULL,submission_id uuid NOT NULL,item_id uuid NOT NULL,answer varchar(16) NOT NULL,note varchar(2000) NOT NULL DEFAULT '',
   CONSTRAINT uq_checklist_result_item UNIQUE(submission_id,item_id),
   CONSTRAINT fk_checklist_result_submission FOREIGN KEY(submission_id,assignment_id) REFERENCES safety_checklist_submission(id,assignment_id) ON DELETE RESTRICT,
   CONSTRAINT fk_checklist_result_item FOREIGN KEY(item_id,assignment_id) REFERENCES safety_checklist_item(id,assignment_id) ON DELETE RESTRICT,
   CONSTRAINT ck_checklist_answer CHECK(answer IN ('PASS','FAIL','NOT_APPLICABLE')),
   CONSTRAINT ck_checklist_result_note CHECK(char_length(note)<=2000 AND (answer='PASS' OR char_length(trim(note))>0))
  );
  CREATE TABLE safety_checklist_result_evidence (
   result_id uuid NOT NULL CONSTRAINT fk_checklist_evidence_result REFERENCES safety_checklist_item_result(id) ON DELETE RESTRICT,
   evidence_id uuid NOT NULL CONSTRAINT fk_checklist_evidence_file REFERENCES safety_evidence(id) ON DELETE RESTRICT,
   PRIMARY KEY(result_id,evidence_id)
  );
  ALTER TABLE incident ADD COLUMN source_checklist_result_id uuid CONSTRAINT fk_incident_checklist_result REFERENCES safety_checklist_item_result(id) ON DELETE RESTRICT;
  CREATE UNIQUE INDEX uq_incident_checklist_result ON incident(source_checklist_result_id) WHERE source_checklist_result_id IS NOT NULL;
  ALTER TABLE safety_evidence DROP CONSTRAINT safety_evidence_media_type_check, DROP CONSTRAINT safety_evidence_size_check;
  ALTER TABLE safety_evidence ADD CONSTRAINT safety_evidence_media_type_check CHECK(media_type IN ('image/jpeg','image/png','application/pdf')), ADD CONSTRAINT safety_evidence_size_check CHECK(size BETWEEN 1 AND 5242880);
  ALTER TABLE safety_workflow_audit DROP CONSTRAINT safety_workflow_audit_resource_type_check;
  ALTER TABLE safety_workflow_audit ADD CONSTRAINT safety_workflow_audit_resource_type_check CHECK(resource_type IN ('INCIDENT','SAFETY_TASK','CHECKLIST'));
  ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type,DROP CONSTRAINT chk_notification_role,DROP CONSTRAINT chk_notification_event;
  ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE','CHECKLIST'));
  ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK((recipient_role='WORKER' AND worker_id IS NOT NULL) OR (recipient_role IN ('CONTRACTOR_REPRESENTATIVE','SAFETY_OFFICER') AND worker_id IS NULL));
  ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED'));
  ALTER TABLE user_notification ADD CONSTRAINT chk_notification_checklist_target CHECK(
    (request_type<>'CHECKLIST' AND event NOT IN ('CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED')) OR
    (request_type='CHECKLIST' AND recipient_role IN ('SAFETY_OFFICER','CONTRACTOR_REPRESENTATIVE') AND event IN ('CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED') AND COALESCE(content->>'checklistId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
  CREATE FUNCTION validate_checklist_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM zone WHERE id=NEW.zone_id AND site_id=NEW.site_id) THEN RAISE EXCEPTION 'Invalid checklist Zone scope' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND (NEW.site_id,NEW.contractor_id,NEW.team_id,NEW.zone_id,NEW.description,NEW.starts_at,NEW.ends_at,NEW.assigned_to,NEW.assigned_by) IS DISTINCT FROM (OLD.site_id,OLD.contractor_id,OLD.team_id,OLD.zone_id,OLD.description,OLD.starts_at,OLD.ends_at,OLD.assigned_to,OLD.assigned_by) THEN RAISE EXCEPTION 'Assigned checklist content is immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END $$;
  CREATE TRIGGER checklist_scope BEFORE INSERT OR UPDATE ON safety_checklist_assignment FOR EACH ROW EXECUTE FUNCTION validate_checklist_scope();
  CREATE FUNCTION preserve_checklist_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Checklist history is immutable' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='safety_checklist_submission' THEN
    IF OLD.status<>'PENDING' OR NEW.status NOT IN ('ACCEPTED','RETURNED') OR (NEW.id,NEW.assignment_id,NEW.submitted_by,NEW.submitted_at) IS DISTINCT FROM (OLD.id,OLD.assignment_id,OLD.submitted_by,OLD.submitted_at) THEN RAISE EXCEPTION 'Checklist review is immutable' USING ERRCODE='23514'; END IF;
   ELSE RAISE EXCEPTION 'Checklist items and results are immutable' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END $$;
  CREATE TRIGGER immutable_checklist_item BEFORE UPDATE OR DELETE ON safety_checklist_item FOR EACH ROW EXECUTE FUNCTION preserve_checklist_history();
  CREATE TRIGGER immutable_checklist_submission BEFORE UPDATE OR DELETE ON safety_checklist_submission FOR EACH ROW EXECUTE FUNCTION preserve_checklist_history();
  CREATE TRIGGER immutable_checklist_result BEFORE UPDATE OR DELETE ON safety_checklist_item_result FOR EACH ROW EXECUTE FUNCTION preserve_checklist_history();
  CREATE TRIGGER immutable_checklist_evidence BEFORE UPDATE OR DELETE ON safety_checklist_result_evidence FOR EACH ROW EXECUTE FUNCTION preserve_checklist_history();`);
  }
  async down(r: QueryRunner): Promise<void> {
    const [row] = (await r.query(
      "SELECT EXISTS(SELECT 1 FROM safety_checklist_assignment) OR EXISTS(SELECT 1 FROM safety_workflow_audit WHERE resource_type='CHECKLIST') OR EXISTS(SELECT 1 FROM user_notification WHERE request_type='CHECKLIST') AS occupied",
    )) as { occupied: boolean }[];
    if (row!.occupied)
      throw new Error('Preserve/export checklist data before reverting this migration');
    await r.query(`ALTER TABLE incident DROP COLUMN source_checklist_result_id;
   DROP TABLE safety_checklist_result_evidence,safety_checklist_item_result,safety_checklist_submission,safety_checklist_item,safety_checklist_assignment;
   DROP FUNCTION validate_checklist_scope(); DROP FUNCTION preserve_checklist_history();
   ALTER TABLE user_notification DROP CONSTRAINT chk_notification_checklist_target;
   ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type,DROP CONSTRAINT chk_notification_role,DROP CONSTRAINT chk_notification_event;
   ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE'));
   ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK((recipient_role='WORKER' AND worker_id IS NOT NULL) OR (recipient_role='CONTRACTOR_REPRESENTATIVE' AND worker_id IS NULL));
   ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED'));
   ALTER TABLE safety_workflow_audit DROP CONSTRAINT safety_workflow_audit_resource_type_check;
   ALTER TABLE safety_workflow_audit ADD CONSTRAINT safety_workflow_audit_resource_type_check CHECK(resource_type IN ('INCIDENT','SAFETY_TASK'));
   ALTER TABLE safety_evidence DROP CONSTRAINT safety_evidence_media_type_check,DROP CONSTRAINT safety_evidence_size_check;
   ALTER TABLE safety_evidence ADD CONSTRAINT safety_evidence_media_type_check CHECK(media_type='image/jpeg'), ADD CONSTRAINT safety_evidence_size_check CHECK(size BETWEEN 1 AND 1048576);`);
  }
}
