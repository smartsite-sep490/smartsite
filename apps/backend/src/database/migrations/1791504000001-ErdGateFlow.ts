import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ErdGateFlow1791504000001 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE access_attempt (
      id uuid CONSTRAINT pk_access_attempt_id PRIMARY KEY,
      site_id uuid NOT NULL CONSTRAINT fk_attempt_site REFERENCES site(id) ON DELETE RESTRICT,
      gate_id varchar(64) NOT NULL,
      operator_id uuid NOT NULL CONSTRAINT fk_attempt_operator REFERENCES app_user(id) ON DELETE RESTRICT,
      direction varchar(3) NOT NULL,method varchar(10) NOT NULL,
      credential_id uuid CONSTRAINT fk_attempt_credential REFERENCES qr_credential(id) ON DELETE RESTRICT,
      worker_id uuid CONSTRAINT fk_attempt_worker REFERENCES worker(id) ON DELETE RESTRICT,
      worker_assignment_id uuid CONSTRAINT fk_attempt_assignment REFERENCES worker_site_zone_assignment(id) ON DELETE RESTRICT,
      visit_id uuid CONSTRAINT fk_attempt_visit REFERENCES visitor_visit(id) ON DELETE RESTRICT,
      identity_status varchar(32) NOT NULL,authorization_status varchar(32) NOT NULL,schedule_status varchar(32) NOT NULL,
      reason_code varchar(100) NOT NULL,assignment_version integer,site_policy_version integer NOT NULL DEFAULT 1,
      status varchar(16) NOT NULL,
      reviewed_by uuid CONSTRAINT fk_attempt_reviewer REFERENCES app_user(id) ON DELETE RESTRICT,
      reviewed_at timestamptz,review_note text,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_attempt_subject CHECK(NOT (worker_id IS NOT NULL AND visit_id IS NOT NULL)),
      CONSTRAINT ck_attempt_identity CHECK(identity_status <> 'MATCHED' OR ((worker_id IS NOT NULL) <> (visit_id IS NOT NULL))),
      CONSTRAINT ck_attempt_unidentified CHECK(identity_status = 'MATCHED' OR (worker_id IS NULL AND worker_assignment_id IS NULL AND visit_id IS NULL)),
      CONSTRAINT ck_attempt_ready CHECK(status NOT IN ('READY','USED') OR (identity_status = 'MATCHED' AND authorization_status = 'ALLOWED')),
      CONSTRAINT ck_attempt_interval CHECK(expires_at>created_at),
      CONSTRAINT ck_attempt_values CHECK(direction IN ('IN','OUT') AND method IN ('FACE','QR','MANUAL') AND identity_status IN ('MATCHED','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','UNAVAILABLE') AND authorization_status IN ('ALLOWED','DENIED','REVIEW_REQUIRED','UNAVAILABLE') AND schedule_status IN ('SCHEDULED','OUTSIDE_SHIFT','NO_SCHEDULE','NOT_APPLICABLE') AND status IN ('PENDING','READY','DENIED','USED','EXPIRED'))
    );
    CREATE INDEX idx_attempt_site_created ON access_attempt(site_id,created_at);
    CREATE TABLE gate_event (
      id uuid CONSTRAINT pk_gate_event_id PRIMARY KEY,
      access_attempt_id uuid NOT NULL CONSTRAINT fk_gate_event_attempt REFERENCES access_attempt(id) ON DELETE RESTRICT,
      site_id uuid NOT NULL CONSTRAINT fk_gate_event_site REFERENCES site(id) ON DELETE RESTRICT,
      worker_id uuid CONSTRAINT fk_gate_event_worker REFERENCES worker(id) ON DELETE RESTRICT,
      visit_id uuid CONSTRAINT fk_gate_event_visit REFERENCES visitor_visit(id) ON DELETE RESTRICT,
      direction varchar(3) NOT NULL,occurred_at timestamptz NOT NULL,gate_name varchar(100) NOT NULL,idempotency_key varchar(150) NOT NULL,
      recorded_by uuid CONSTRAINT fk_gate_event_recorder REFERENCES app_user(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_gate_event_subject CHECK((worker_id IS NOT NULL) <> (visit_id IS NOT NULL)),
      CONSTRAINT ck_gate_event_direction CHECK(direction IN ('IN','OUT'))
    );
    CREATE UNIQUE INDEX uq_gate_event_attempt ON gate_event(access_attempt_id);
    CREATE UNIQUE INDEX uq_gate_event_idempotency ON gate_event(idempotency_key);`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM gate_event) OR EXISTS(SELECT 1 FROM access_attempt) THEN RAISE EXCEPTION 'Access history requires this schema'; END IF; END $$;
      DROP TABLE gate_event; DROP TABLE access_attempt;`);
  }
}
