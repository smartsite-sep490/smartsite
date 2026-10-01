import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GateAccessLogs1790985600000 implements MigrationInterface {
  name = 'GateAccessLogs1790985600000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE worker_site_zone_assignment ADD COLUMN gate_id VARCHAR(64),
        ADD CONSTRAINT chk_assignment_gate_id CHECK (gate_id IS NULL OR gate_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
      CREATE TABLE gate_access_log (
        id UUID PRIMARY KEY,
        site_id UUID NOT NULL CONSTRAINT fk_gate_access_log_site REFERENCES site(id) ON DELETE RESTRICT,
        gate_id VARCHAR(64) NOT NULL,
        operator_user_id UUID NOT NULL CONSTRAINT fk_gate_access_log_operator REFERENCES app_user(id) ON DELETE RESTRICT,
        worker_id UUID CONSTRAINT fk_gate_access_log_worker REFERENCES worker(id) ON DELETE RESTRICT,
        user_id UUID CONSTRAINT fk_gate_access_log_user REFERENCES app_user(id) ON DELETE RESTRICT,
        direction VARCHAR(3) NOT NULL CONSTRAINT chk_gate_access_log_direction CHECK (direction IN ('IN','OUT')),
        decision JSONB NOT NULL,
        worker_name VARCHAR(255), worker_external_id VARCHAR(128),
        contractor_name VARCHAR(255), username VARCHAR(64),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_gate_access_log_site_gate_time ON gate_access_log(site_id,gate_id,created_at,id);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE gate_access_log;
      ALTER TABLE worker_site_zone_assignment DROP CONSTRAINT chk_assignment_gate_id, DROP COLUMN gate_id;`);
  }
}
