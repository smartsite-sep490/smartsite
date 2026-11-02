import type { MigrationInterface, QueryRunner } from 'typeorm';
import { lockCleanupTables } from './erd-cleanup-scope.js';

export class RetireLegacyAttendance1794960000001 implements MigrationInterface {
  name = 'RetireLegacyAttendance1794960000001';
  async up(runner: QueryRunner): Promise<void> {
    const names = [
      'attendance_correction_request',
      'attendance_anomaly',
      'attendance_pair',
      'attendance_schedule_conflict',
    ];
    const table = await lockCleanupTables(runner, names);
    for (const name of names) {
      const [row] = (await runner.query(`SELECT count(*)::text AS count FROM ${table(name)}`)) as {
        count: string;
      }[];
      if (row!.count !== '0')
        throw new Error(
          `Legacy attendance data requires reconciliation: ${name} has ${row!.count} rows`,
        );
    }
    for (const name of names) await runner.query(`DROP TABLE ${table(name)}`);
  }
  async down(): Promise<void> {
    throw new Error('Retired attendance storage cannot be reconstructed; restore a backup');
  }
}
