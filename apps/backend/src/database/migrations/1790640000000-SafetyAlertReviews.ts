import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SafetyAlertReviews1790640000000 implements MigrationInterface {
  name = 'SafetyAlertReviews1790640000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE safety_alert
        ADD COLUMN revision integer NOT NULL DEFAULT 0,
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
        ADD CONSTRAINT chk_safety_alert_revision CHECK (revision >= 0)
    `);
    await queryRunner.query(`
      CREATE TABLE safety_alert_review (
        id uuid NOT NULL,
        alert_id uuid NOT NULL,
        site_id uuid NOT NULL,
        actor_user_id uuid NOT NULL,
        from_status alert_status NOT NULL,
        to_status alert_status NOT NULL,
        reason varchar(1000) NOT NULL,
        alert_revision integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_safety_alert_review_id PRIMARY KEY (id),
        CONSTRAINT chk_safety_alert_review_reason_length
          CHECK (char_length(reason) BETWEEN 5 AND 1000),
        CONSTRAINT chk_safety_alert_review_revision CHECK (alert_revision >= 1),
        CONSTRAINT fk_safety_alert_review_alert
          FOREIGN KEY (alert_id) REFERENCES safety_alert(id) ON DELETE RESTRICT,
        CONSTRAINT fk_safety_alert_review_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_safety_alert_review_actor
          FOREIGN KEY (actor_user_id) REFERENCES app_user(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_safety_alert_review_alert_created
      ON safety_alert_review (alert_id, created_at ASC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_safety_alert_review_alert_created');
    await queryRunner.query('DROP TABLE safety_alert_review');
    await queryRunner.query('ALTER TABLE safety_alert DROP CONSTRAINT chk_safety_alert_revision');
    await queryRunner.query('ALTER TABLE safety_alert DROP COLUMN updated_at');
    await queryRunner.query('ALTER TABLE safety_alert DROP COLUMN revision');
  }
}
