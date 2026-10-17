import { expect, it } from 'vitest';
import type { AttendanceWorkerReport } from '@smartsite/api-client';
import { attendanceCsv } from './report-csv';
it('exports confirmed and provisional totals separately and neutralizes spreadsheet formulas in names', () => {
  const csv = attendanceCsv([
    {
      workerCode: 'W1',
      workerName: '=HYPERLINK("example")',
      todayStatus: 'PRESENT',
      totalMinutes: 480,
      regularMinutes: 480,
      overtimeMinutes: 0,
      provisionalMinutes: 120,
      presentDays: 1,
      requiredDays: 2,
      attendanceRate: 50,
    } as AttendanceWorkerReport,
  ]);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""example"")"');
  expect(csv).toContain('"480","480","0","120"');
});
