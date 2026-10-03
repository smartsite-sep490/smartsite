import type { MigrationInterface, QueryRunner } from 'typeorm';
export class QrAccess1791417600000 implements MigrationInterface {
  name = 'QrAccess1791417600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE gate_access_log ADD COLUMN method VARCHAR(8) NOT NULL DEFAULT 'FACE'
        CONSTRAINT chk_gate_access_log_method CHECK (method IN ('FACE','QR'));
      CREATE TABLE visitor_visit (
        id UUID PRIMARY KEY, site_id UUID NOT NULL CONSTRAINT fk_visit_site REFERENCES site(id) ON DELETE RESTRICT,
        access_key_hash VARCHAR(64) NOT NULL,
        visitor_name VARCHAR(255) NOT NULL, company VARCHAR(255) NOT NULL,
        contact VARCHAR(255) NOT NULL, host_name VARCHAR(255) NOT NULL,
        purpose VARCHAR(1000) NOT NULL, target_area VARCHAR(255) NOT NULL,
        group_size INTEGER NOT NULL CONSTRAINT chk_visit_group_size CHECK(group_size BETWEEN 1 AND 1000),
        gate_id VARCHAR(64) NOT NULL,
        valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ NOT NULL CONSTRAINT chk_visit_interval CHECK(valid_until > valid_from),
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CONSTRAINT chk_visit_status CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        entered_count INTEGER NOT NULL DEFAULT 0, exited_count INTEGER NOT NULL DEFAULT 0,
        decided_by_user_id UUID CONSTRAINT fk_visit_decider REFERENCES app_user(id) ON DELETE RESTRICT, decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_visit_counts CHECK(entered_count >= 0 AND entered_count <= group_size AND exited_count >= 0 AND exited_count <= entered_count)
      );
      CREATE INDEX idx_visitor_visit_site_status ON visitor_visit(site_id,status,created_at);
      CREATE TABLE qr_fallback_session (
        id UUID PRIMARY KEY, site_id UUID NOT NULL CONSTRAINT fk_fallback_site REFERENCES site(id) ON DELETE RESTRICT, gate_id VARCHAR(64) NOT NULL,
        operator_user_id UUID NOT NULL CONSTRAINT fk_fallback_operator REFERENCES app_user(id) ON DELETE RESTRICT,
        direction VARCHAR(3) NOT NULL CONSTRAINT chk_fallback_direction CHECK(direction IN ('IN','OUT')),
        reason VARCHAR(32) NOT NULL CONSTRAINT chk_fallback_reason CHECK(reason IN ('CAMERA_UNAVAILABLE','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','AI_UNAVAILABLE')),
        expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE qr_credential (
        id UUID PRIMARY KEY, token_hash VARCHAR(64) NOT NULL,
        visit_id UUID CONSTRAINT fk_qr_visit REFERENCES visitor_visit(id) ON DELETE RESTRICT, worker_id UUID CONSTRAINT fk_qr_worker REFERENCES worker(id) ON DELETE RESTRICT,
        fallback_session_id UUID CONSTRAINT fk_qr_fallback REFERENCES qr_fallback_session(id) ON DELETE RESTRICT,
        expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
        request_hash VARCHAR(64), result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_qr_subject CHECK((visit_id IS NOT NULL AND worker_id IS NULL AND fallback_session_id IS NULL)
          OR (visit_id IS NULL AND worker_id IS NOT NULL AND fallback_session_id IS NOT NULL))
      );
      CREATE UNIQUE INDEX uq_qr_credential_token_hash ON qr_credential(token_hash);
      CREATE TABLE visitor_gate_event (
        id UUID PRIMARY KEY, visit_id UUID NOT NULL CONSTRAINT fk_visitor_event_visit REFERENCES visitor_visit(id) ON DELETE RESTRICT,
        operator_user_id UUID NOT NULL CONSTRAINT fk_visitor_event_operator REFERENCES app_user(id) ON DELETE RESTRICT, gate_id VARCHAR(64) NOT NULL,
        direction VARCHAR(3) NOT NULL CONSTRAINT chk_visitor_event_direction CHECK(direction IN ('IN','OUT')),
        count INTEGER NOT NULL CONSTRAINT chk_visitor_event_count CHECK(count > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_visitor_gate_event_visit ON visitor_gate_event(visit_id,created_at);
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE visitor_gate_event; DROP TABLE qr_credential;
      DROP TABLE qr_fallback_session; DROP TABLE visitor_visit; ALTER TABLE gate_access_log DROP COLUMN method;`);
  }
}
