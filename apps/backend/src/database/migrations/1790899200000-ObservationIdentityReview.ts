import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ObservationIdentityReview1790899200000 implements MigrationInterface {
  name = 'ObservationIdentityReview1790899200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE observation_identity_resolution (
        id uuid NOT NULL, event_id uuid NOT NULL, person_observation_index smallint NOT NULL,
        site_id uuid NOT NULL, payload_hash char(64) NOT NULL, subject_ref jsonb NOT NULL,
        revision integer NOT NULL DEFAULT 0, current_decision_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_identity_resolution_id PRIMARY KEY (id),
        CONSTRAINT uq_identity_resolution_event_subject UNIQUE (event_id, person_observation_index),
        CONSTRAINT uq_identity_resolution_id_site UNIQUE (id, site_id),
        CONSTRAINT chk_identity_resolution_index CHECK (person_observation_index BETWEEN 0 AND 255),
        CONSTRAINT chk_identity_resolution_hash CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_identity_resolution_ref CHECK (jsonb_typeof(subject_ref) = 'object'),
        CONSTRAINT chk_identity_resolution_head CHECK (
          (revision = 0 AND current_decision_id IS NULL) OR
          (revision BETWEEN 1 AND 2147483647 AND current_decision_id IS NOT NULL)),
        CONSTRAINT fk_identity_resolution_event FOREIGN KEY (event_id) REFERENCES ai_observation_event(event_id) ON DELETE RESTRICT,
        CONSTRAINT fk_identity_resolution_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE observation_identity_decision (
        id uuid NOT NULL, resolution_id uuid NOT NULL, site_id uuid NOT NULL,
        actor_user_id uuid NOT NULL, revision integer NOT NULL, expected_revision integer NOT NULL,
        command_hash char(64) NOT NULL, action varchar(8) NOT NULL, worker_id uuid,
        evidence_index smallint, evidence_sha256 char(64), reason varchar(1000) NOT NULL,
        scope varchar(32) NOT NULL DEFAULT 'EXACT_OBSERVATION',
        verification_method varchar(16) NOT NULL DEFAULT 'MANUAL', recorded_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_identity_decision_id PRIMARY KEY (id),
        CONSTRAINT uq_identity_decision_revision UNIQUE (resolution_id, revision),
        CONSTRAINT uq_identity_decision_head_pointer UNIQUE (resolution_id, id, revision),
        CONSTRAINT chk_identity_decision_revision CHECK (expected_revision BETWEEN 0 AND 2147483646 AND revision = expected_revision + 1),
        CONSTRAINT chk_identity_decision_hash CHECK (command_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_identity_decision_reason CHECK (char_length(reason) BETWEEN 5 AND 1000 AND reason = btrim(reason)),
        CONSTRAINT chk_identity_decision_scope CHECK (scope = 'EXACT_OBSERVATION' AND verification_method = 'MANUAL'),
        CONSTRAINT chk_identity_decision_action CHECK (
          (action = 'RESOLVE' AND worker_id IS NOT NULL AND evidence_index IS NOT NULL AND evidence_index BETWEEN 0 AND 255 AND evidence_sha256 IS NOT NULL AND evidence_sha256 ~ '^[0-9a-f]{64}$') OR
          (action = 'CLEAR' AND worker_id IS NULL AND evidence_index IS NULL AND evidence_sha256 IS NULL)),
        CONSTRAINT fk_identity_decision_resolution FOREIGN KEY (resolution_id, site_id) REFERENCES observation_identity_resolution(id, site_id) ON DELETE RESTRICT,
        CONSTRAINT fk_identity_decision_actor FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_identity_decision_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      ALTER TABLE observation_identity_resolution ADD CONSTRAINT fk_identity_resolution_current
      FOREIGN KEY (id, current_decision_id, revision)
      REFERENCES observation_identity_decision(resolution_id, id, revision) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE FUNCTION reject_observation_identity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Observation identity decisions are append-only' USING ERRCODE = '23514';
      END $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_identity_decision_append_only BEFORE UPDATE OR DELETE
      ON observation_identity_decision FOR EACH ROW EXECUTE FUNCTION reject_observation_identity_audit_mutation()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // A single statement locks and checks before any DDL; populated audit is never discarded.
    await queryRunner.query(`
      DO $$ BEGIN
        LOCK TABLE observation_identity_resolution, observation_identity_decision IN ACCESS EXCLUSIVE MODE;
        IF EXISTS (SELECT 1 FROM observation_identity_resolution) OR EXISTS (SELECT 1 FROM observation_identity_decision) THEN
          RAISE EXCEPTION 'Refusing to revert populated observation identity audit';
        END IF;
        ALTER TABLE observation_identity_resolution DROP CONSTRAINT fk_identity_resolution_current;
        DROP TABLE observation_identity_decision;
        DROP FUNCTION reject_observation_identity_audit_mutation();
        DROP TABLE observation_identity_resolution;
      END $$
    `);
  }
}
