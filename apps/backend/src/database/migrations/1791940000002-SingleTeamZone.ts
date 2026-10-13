import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SingleTeamZone1791940000002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Fail without deleting history if legacy teams have multiple assignments.
    await runner.query(
      'CREATE UNIQUE INDEX uq_team_single_zone ON team_zone_permission(team_id) WHERE revoked_at IS NULL',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX uq_team_single_zone');
  }
}
