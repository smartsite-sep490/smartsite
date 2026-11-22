import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Security Gate Desk may capture FACE evidence directly from the browser. */
export class SecurityBrowserWebcam1795564800000 implements MigrationInterface {
  name = 'SecurityBrowserWebcam1795564800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE access_attempt DROP CONSTRAINT ck_attempt_face_source');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Never discard webcam history to restore the registered-source-only constraint.
    await queryRunner.query(
      `ALTER TABLE access_attempt ADD CONSTRAINT ck_attempt_face_source CHECK(method <> 'FACE' OR source_camera_id IS NOT NULL)`,
    );
  }
}
