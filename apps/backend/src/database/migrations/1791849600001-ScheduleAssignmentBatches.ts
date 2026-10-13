import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ScheduleAssignmentBatches1791849600001 implements MigrationInterface {
  name = 'ScheduleAssignmentBatches1791849600001';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE schedule_assignment_batch (
      id uuid CONSTRAINT pk_schedule_assignment_batch PRIMARY KEY,
      site_id uuid NOT NULL CONSTRAINT fk_schedule_batch_site REFERENCES site(id) ON DELETE RESTRICT,
      contractor_id uuid NOT NULL CONSTRAINT fk_schedule_batch_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
      created_by uuid NOT NULL CONSTRAINT fk_schedule_batch_creator REFERENCES app_user(id) ON DELETE RESTRICT,
      version integer NOT NULL DEFAULT 1,
      input jsonb NOT NULL, preview jsonb NOT NULL, schedule_ids jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if ((await runner.query('SELECT 1 FROM schedule_assignment_batch LIMIT 1')).length)
      throw new Error('Cannot remove schedule assignment history');
    await runner.query('DROP TABLE schedule_assignment_batch');
  }
}
