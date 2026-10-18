import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerDocuments1792540800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE worker_compliance_profile (
      worker_id uuid PRIMARY KEY CONSTRAINT fk_compliance_worker REFERENCES worker(id) ON DELETE RESTRICT,
      national_id varchar(12), phone_number varchar(16), gender varchar(8), address varchar(1000), identity_required boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_compliance_national_id CHECK(national_id IS NULL OR national_id ~ '^[0-9]{12}$'),
      CONSTRAINT chk_compliance_phone CHECK(phone_number IS NULL OR phone_number ~ '^\\+?[0-9]{9,15}$'),
      CONSTRAINT chk_compliance_gender CHECK(gender IS NULL OR gender IN ('MALE','FEMALE','OTHER'))
    );
    CREATE TABLE worker_identity_image(id uuid PRIMARY KEY,worker_id uuid NOT NULL CONSTRAINT fk_identity_image_worker REFERENCES worker(id) ON DELETE RESTRICT,
      side varchar(5) NOT NULL, original_name varchar(255) NOT NULL,file jsonb NOT NULL,uploaded_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_worker_identity_side UNIQUE(worker_id,side),CONSTRAINT chk_worker_identity_side CHECK(side IN ('FRONT','BACK')));
    CREATE TABLE worker_document (
      id uuid PRIMARY KEY, worker_id uuid NOT NULL CONSTRAINT fk_worker_document_worker REFERENCES worker(id) ON DELETE RESTRICT,
      kind varchar(32) NOT NULL, status varchar(16) NOT NULL, original_name varchar(255) NOT NULL,
      file jsonb NOT NULL, ocr jsonb NOT NULL, issued_on date, expires_on date,
      uploaded_by uuid NOT NULL CONSTRAINT fk_worker_document_uploader REFERENCES app_user(id) ON DELETE RESTRICT,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      reviewed_by uuid CONSTRAINT fk_worker_document_reviewer REFERENCES app_user(id) ON DELETE RESTRICT,
      reviewed_at timestamptz, review_note varchar(1000), version integer NOT NULL DEFAULT 1,
      CONSTRAINT chk_worker_document_kind CHECK(kind IN ('SAFETY_CARD','HEALTH_CERTIFICATE','PERSONAL_INSURANCE')),
      CONSTRAINT chk_worker_document_status CHECK(status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED')),
      CONSTRAINT chk_worker_document_dates CHECK(status<>'APPROVED' OR (issued_on IS NOT NULL AND expires_on IS NOT NULL AND expires_on>=issued_on AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)),
      CONSTRAINT chk_worker_document_version CHECK(version>=1)
    );
    CREATE INDEX idx_worker_document_worker ON worker_document(worker_id,uploaded_at);
    CREATE UNIQUE INDEX uq_worker_document_approved ON worker_document(worker_id,kind) WHERE status='APPROVED';
    CREATE UNIQUE INDEX uq_worker_document_pending ON worker_document(worker_id,kind) WHERE status='PENDING';
    DO $$ DECLARE expression text; BEGIN
      SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint WHERE conrelid='user_notification'::regclass AND conname='chk_notification_request_type';
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type;
      EXECUTE format('ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK ((%s) OR request_type=''DOCUMENT'')',expression);
      SELECT pg_get_expr(conbin,conrelid) INTO expression FROM pg_constraint WHERE conrelid='user_notification'::regclass AND conname='chk_notification_event';
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event;
      EXECUTE format('ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK ((%s) OR event IN (''DOCUMENT_SUBMITTED'',''DOCUMENT_APPROVED'',''DOCUMENT_REJECTED'',''DOCUMENT_EXPIRING'',''DOCUMENT_EXPIRED''))',expression);
    END $$;
    ALTER TABLE user_notification ADD CONSTRAINT chk_notification_document_target CHECK(
      (request_type<>'DOCUMENT' AND event NOT IN ('DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED')) OR
      (request_type='DOCUMENT' AND event IN ('DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED') AND COALESCE(content->>'documentWorkerId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM worker_identity_image) OR EXISTS(SELECT 1 FROM worker_document) OR EXISTS(SELECT 1 FROM worker_compliance_profile) OR EXISTS(SELECT 1 FROM user_notification WHERE request_type='DOCUMENT')
      THEN RAISE EXCEPTION 'Worker document history must be retained before rollback'; END IF; END $$;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_document_target;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type;
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE','CHECKLIST'));
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event;
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED'));
      DROP TABLE worker_identity_image; DROP TABLE worker_document; DROP TABLE worker_compliance_profile;`);
  }
}
