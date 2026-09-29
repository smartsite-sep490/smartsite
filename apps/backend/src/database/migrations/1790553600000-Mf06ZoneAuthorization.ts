import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf06ZoneAuthorization1790553600000 implements MigrationInterface {
  name = 'Mf06ZoneAuthorization1790553600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE worker (
        id UUID NOT NULL,
        site_id UUID NOT NULL,
        external_id VARCHAR(128) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_worker_id PRIMARY KEY (id),
        CONSTRAINT fk_worker_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT uq_worker_site_external_id UNIQUE (site_id, external_id)
      );

      CREATE TABLE zone_access_grant (
        id UUID NOT NULL,
        site_id UUID NOT NULL,
        zone_id UUID NOT NULL,
        worker_id UUID NOT NULL,
        effect VARCHAR(8) NOT NULL,
        valid_from TIMESTAMPTZ NOT NULL,
        valid_until TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_zone_access_grant_id PRIMARY KEY (id),
        CONSTRAINT fk_zone_access_grant_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_zone_access_grant_zone FOREIGN KEY (zone_id) REFERENCES zone(id) ON DELETE RESTRICT,
        CONSTRAINT fk_zone_access_grant_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT chk_zone_access_grant_effect CHECK (effect IN ('ALLOW', 'DENY')),
        CONSTRAINT chk_zone_access_grant_interval CHECK (valid_until IS NULL OR valid_until > valid_from)
      );
      CREATE INDEX idx_zone_access_grant_lookup ON zone_access_grant (zone_id, worker_id, valid_from);

      CREATE TABLE zone_entry_decision (
        id UUID NOT NULL,
        event_id UUID NOT NULL,
        site_id UUID NOT NULL,
        zone_id UUID NOT NULL,
        worker_id UUID,
        candidate_worker_id VARCHAR(128),
        track_id INTEGER NOT NULL,
        status VARCHAR(16) NOT NULL,
        reason_code VARCHAR(64) NOT NULL,
        evaluated_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_zone_entry_decision_id PRIMARY KEY (id),
        CONSTRAINT fk_zone_entry_decision_event FOREIGN KEY (event_id) REFERENCES ai_observation_event(event_id) ON DELETE CASCADE,
        CONSTRAINT fk_zone_entry_decision_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_zone_entry_decision_zone FOREIGN KEY (zone_id) REFERENCES zone(id) ON DELETE RESTRICT,
        CONSTRAINT fk_zone_entry_decision_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE SET NULL,
        CONSTRAINT uq_zone_entry_decision_event_track_zone UNIQUE (event_id, track_id, zone_id),
        CONSTRAINT chk_zone_entry_decision_status CHECK (status IN ('ALLOWED', 'DENIED', 'UNAVAILABLE'))
      );
      CREATE INDEX idx_zone_entry_decision_site_time ON zone_entry_decision (site_id, evaluated_at, id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS zone_entry_decision CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS zone_access_grant CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS worker CASCADE;`);
  }
}
