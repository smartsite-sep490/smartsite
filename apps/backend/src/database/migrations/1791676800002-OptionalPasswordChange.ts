import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Supplied/reset passwords are usable immediately; changing them is optional. */
export class OptionalPasswordChange1791676800002 implements MigrationInterface {
  name = 'OptionalPasswordChange1791676800002';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE app_user ALTER COLUMN must_change_password SET DEFAULT FALSE');
    await runner.query(
      'UPDATE app_user SET must_change_password = FALSE WHERE must_change_password = TRUE',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    // Do not invent password requirements for existing accounts on rollback.
    await runner.query('ALTER TABLE app_user ALTER COLUMN must_change_password SET DEFAULT TRUE');
  }
}
