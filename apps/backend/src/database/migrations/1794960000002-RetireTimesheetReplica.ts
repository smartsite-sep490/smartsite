import type { MigrationInterface, QueryRunner } from 'typeorm';
import { lockCleanupTables } from './erd-cleanup-scope.js';

export class RetireTimesheetReplica1794960000002 implements MigrationInterface {
  name = 'RetireTimesheetReplica1794960000002';
  async up(runner: QueryRunner): Promise<void> {
    const table = await lockCleanupTables(runner, ['timesheet', 'attendance_day']);
    const [row] = (await runner.query(`SELECT count(*)::text AS count
      FROM ${table('timesheet')} t LEFT JOIN ${table('attendance_day')} d ON d.id=t.attendance_day_id
      WHERE d.id IS NULL OR t.site_id IS DISTINCT FROM d.site_id OR t.worker_id IS DISTINCT FROM d.worker_id
        OR t.period_start IS DISTINCT FROM d.work_date OR t.period_end IS DISTINCT FROM d.work_date
        OR t.total_minutes IS DISTINCT FROM COALESCE(d.confirmed_minutes,0)
        OR t.status IS DISTINCT FROM CASE WHEN d.confirmed_minutes IS NULL THEN 'DRAFT' ELSE 'APPROVED' END
        OR (d.status='CONFIRMED') IS DISTINCT FROM (d.confirmed_minutes IS NOT NULL)
        OR t.approved_by_user_id IS NOT NULL OR t.approved_at IS NOT NULL`)) as { count: string }[];
    if (row!.count !== '0')
      throw new Error(`Timesheet reconciliation required for ${row!.count} rows`);
    await runner.query(`DROP TABLE ${table('timesheet')}`);
  }
  async down(): Promise<void> {
    throw new Error('Retired timesheet replicas cannot be reconstructed; restore a backup');
  }
}
