import type { MigrationInterface, QueryRunner } from 'typeorm';
import { lockCleanupTables } from './erd-cleanup-scope.js';

export class RetireGatePermissions1794960000000 implements MigrationInterface {
  name = 'RetireGatePermissions1794960000000';
  async up(runner: QueryRunner): Promise<void> {
    const table = await lockCleanupTables(runner, [
      'worker_gate_permission',
      'worker_site_zone_assignment',
    ]);
    await runner.query(`DROP TABLE ${table('worker_gate_permission')};
      ALTER TABLE ${table('worker_site_zone_assignment')} DROP CONSTRAINT chk_assignment_gate_id, DROP COLUMN gate_id`);
  }
  async down(): Promise<void> {
    throw new Error('Retired gate configuration cannot be reconstructed; restore a backup');
  }
}
