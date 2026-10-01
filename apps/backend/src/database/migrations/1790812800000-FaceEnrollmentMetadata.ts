import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FaceEnrollmentMetadata1790812800000 implements MigrationInterface {
  name = 'FaceEnrollmentMetadata1790812800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE face_profile (
        id UUID NOT NULL,
        worker_id UUID NOT NULL,
        profile_reference_hash CHAR(64) NOT NULL,
        model_version VARCHAR(128) NOT NULL,
        status VARCHAR(32) NOT NULL,
        consent_version VARCHAR(64) NOT NULL,
        consented_at TIMESTAMPTZ NOT NULL,
        created_by_user_id UUID NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_by_user_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_face_profile_id PRIMARY KEY (id),
        CONSTRAINT fk_face_profile_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_face_profile_creator FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_face_profile_revoker FOREIGN KEY (revoked_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_face_profile_status CHECK (status IN ('ACTIVE', 'REVOKED', 'NEEDS_REENROLL'))
      );
      CREATE UNIQUE INDEX uq_face_profile_worker ON face_profile (worker_id);
      CREATE UNIQUE INDEX uq_face_profile_reference_hash ON face_profile (profile_reference_hash);
      CREATE TABLE face_enrollment_session (
        id UUID NOT NULL,
        worker_id UUID NOT NULL,
        actor_user_id UUID NOT NULL,
        consent_version VARCHAR(64) NOT NULL,
        consented_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(32) NOT NULL,
        accepted_sample_count SMALLINT NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_face_enrollment_session_id PRIMARY KEY (id),
        CONSTRAINT fk_face_enrollment_session_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_face_enrollment_session_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_face_enrollment_session_status CHECK (status IN ('PENDING', 'COLLECTING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        CONSTRAINT chk_face_enrollment_session_sample_count CHECK (accepted_sample_count BETWEEN 0 AND 3)
      );
      CREATE INDEX idx_face_enrollment_session_worker_started ON face_enrollment_session (worker_id, started_at);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE face_enrollment_session');
    await queryRunner.query('DROP TABLE face_profile');
  }
}
