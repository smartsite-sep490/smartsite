import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf05Mf06Foundation1789689600000 implements MigrationInterface {
  name = 'Mf05Mf06Foundation1789689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create Enums
    await queryRunner.query(`
      CREATE TYPE camera_status AS ENUM ('ACTIVE', 'INACTIVE');
      CREATE TYPE zone_type AS ENUM ('STANDARD', 'RESTRICTED', 'HAZARDOUS');
      CREATE TYPE zone_restriction_policy AS ENUM ('NONE', 'PROHIBITED_FOR_ALL', 'AUTHORIZATION_REQUIRED');
      CREATE TYPE event_processing_status AS ENUM ('PROCESSED', 'SKIPPED_CLOCK_SKEW', 'SKIPPED_NO_CANDIDATE', 'SKIPPED_UNKNOWN_CAMERA');
      CREATE TYPE alert_type AS ENUM ('PPE_VIOLATION', 'RESTRICTED_ZONE_INTRUSION');
      CREATE TYPE alert_status AS ENUM ('PENDING_REVIEW', 'NEEDS_MORE_EVIDENCE', 'CONFIRMED', 'DISMISSED', 'CLOSED');
    `);

    // 2. Table: site
    await queryRunner.query(`
      CREATE TABLE site (
        id UUID NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_site_id PRIMARY KEY (id),
        CONSTRAINT uq_site_code UNIQUE (code)
      );
    `);

    // 3. Table: camera
    await queryRunner.query(`
      CREATE TABLE camera (
        id UUID NOT NULL,
        site_id UUID NOT NULL,
        external_id VARCHAR(128) NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        status camera_status NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_camera_id PRIMARY KEY (id),
        CONSTRAINT fk_camera_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT uq_camera_external_id UNIQUE (external_id),
        CONSTRAINT uq_camera_site_code UNIQUE (site_id, code)
      );
    `);

    // 4. Table: zone
    await queryRunner.query(`
      CREATE TABLE zone (
        id UUID NOT NULL,
        site_id UUID NOT NULL,
        code VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        type zone_type NOT NULL,
        restriction_policy zone_restriction_policy NOT NULL,
        required_ppe TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_zone_id PRIMARY KEY (id),
        CONSTRAINT fk_zone_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT uq_zone_site_code UNIQUE (site_id, code)
      );
    `);

    // 5. Table: camera_observation_region
    await queryRunner.query(`
      CREATE TABLE camera_observation_region (
        id UUID NOT NULL,
        camera_id UUID NOT NULL,
        zone_id UUID NOT NULL,
        polygon JSONB NOT NULL,
        coordinate_space VARCHAR(32) NOT NULL DEFAULT 'NORMALIZED_0_1',
        version INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_camera_observation_region_id PRIMARY KEY (id),
        CONSTRAINT fk_region_camera FOREIGN KEY (camera_id) REFERENCES camera(id) ON DELETE RESTRICT,
        CONSTRAINT fk_region_zone FOREIGN KEY (zone_id) REFERENCES zone(id) ON DELETE RESTRICT,
        CONSTRAINT chk_region_coordinate_space CHECK (coordinate_space = 'NORMALIZED_0_1'),
        CONSTRAINT chk_region_version CHECK (version >= 1)
      );
      CREATE INDEX idx_region_camera_active ON camera_observation_region (camera_id, is_active);
    `);

    // 6. Table: ai_observation_event
    await queryRunner.query(`
      CREATE TABLE ai_observation_event (
        event_id UUID NOT NULL,
        payload_hash CHAR(64) NOT NULL,
        camera_external_id VARCHAR(128) NOT NULL,
        resolved_camera_id UUID,
        stream_session_id UUID NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        raw_payload JSONB NOT NULL,
        processing_status event_processing_status NOT NULL,
        processing_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_ai_observation_event_event_id PRIMARY KEY (event_id),
        CONSTRAINT fk_event_resolved_camera FOREIGN KEY (resolved_camera_id) REFERENCES camera(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_event_camera_session_captured ON ai_observation_event (camera_external_id, stream_session_id, captured_at);
    `);

    // 7. Table: safety_alert
    await queryRunner.query(`
      CREATE TABLE safety_alert (
        id UUID NOT NULL,
        site_id UUID NOT NULL,
        zone_id UUID,
        candidate_worker_id VARCHAR(128),
        identity_similarity_score NUMERIC(5, 4),
        identity_quality_score NUMERIC(5, 4),
        alert_type alert_type NOT NULL,
        candidate_subtype VARCHAR(64) NOT NULL,
        grouping_key VARCHAR(255) NOT NULL,
        status alert_status NOT NULL DEFAULT 'PENDING_REVIEW',
        first_detected_at TIMESTAMPTZ NOT NULL,
        last_detected_at TIMESTAMPTZ NOT NULL,
        detection_count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_safety_alert_id PRIMARY KEY (id),
        CONSTRAINT fk_alert_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_alert_zone FOREIGN KEY (zone_id) REFERENCES zone(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_alert_grouping ON safety_alert (grouping_key, status);
    `);

    // 8. Table: alert_detection_mapping
    await queryRunner.query(`
      CREATE TABLE alert_detection_mapping (
        alert_id UUID NOT NULL,
        event_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_alert_detection_mapping PRIMARY KEY (alert_id, event_id),
        CONSTRAINT fk_mapping_alert FOREIGN KEY (alert_id) REFERENCES safety_alert(id) ON DELETE CASCADE,
        CONSTRAINT fk_mapping_event FOREIGN KEY (event_id) REFERENCES ai_observation_event(event_id) ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order: mapping -> alert/event -> region -> camera/zone -> site
    await queryRunner.query(`DROP TABLE IF EXISTS alert_detection_mapping CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS safety_alert CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS ai_observation_event CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS camera_observation_region CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS zone CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS camera CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS site CASCADE;`);

    // Drop enum types
    await queryRunner.query(`
      DROP TYPE IF EXISTS alert_status;
      DROP TYPE IF EXISTS alert_type;
      DROP TYPE IF EXISTS event_processing_status;
      DROP TYPE IF EXISTS zone_restriction_policy;
      DROP TYPE IF EXISTS zone_type;
      DROP TYPE IF EXISTS camera_status;
    `);
  }
}
