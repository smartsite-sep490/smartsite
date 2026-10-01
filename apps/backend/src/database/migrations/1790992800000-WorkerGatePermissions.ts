import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerGatePermissions1790992800000 implements MigrationInterface {
  name = 'WorkerGatePermissions1790992800000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE worker_gate_permission (
      id UUID CONSTRAINT pk_worker_gate_permission_id PRIMARY KEY,
      worker_id UUID NOT NULL CONSTRAINT fk_worker_gate_permission_worker REFERENCES worker(id) ON DELETE RESTRICT,
      site_id UUID NOT NULL CONSTRAINT fk_worker_gate_permission_site REFERENCES site(id) ON DELETE RESTRICT,
      gate_id VARCHAR(64) NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL, valid_until TIMESTAMPTZ,
      created_by_user_id UUID NOT NULL CONSTRAINT fk_worker_gate_permission_creator REFERENCES app_user(id) ON DELETE RESTRICT,
      revoked_at TIMESTAMPTZ,
      revoked_by_user_id UUID CONSTRAINT fk_worker_gate_permission_revoker REFERENCES app_user(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT chk_worker_gate_permission_interval CHECK (valid_until IS NULL OR valid_until > valid_from),
      CONSTRAINT chk_worker_gate_permission_gate CHECK (gate_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
    );
    CREATE INDEX idx_worker_gate_permission_lookup ON worker_gate_permission(worker_id,site_id,gate_id,revoked_at);
    INSERT INTO worker_gate_permission(id,worker_id,site_id,gate_id,valid_from,valid_until,created_by_user_id,created_at)
      SELECT id,worker_id,site_id,gate_id,valid_from,valid_until,
        COALESCE(site_manager_decided_by_user_id,requested_by_user_id),created_at
      FROM worker_site_zone_assignment WHERE status='APPROVED' AND gate_id IS NOT NULL;`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE worker_gate_permission');
  }
}
