import { translate as tr } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import type { AttendanceWorkerReport } from '@smartsite/api-client';
function cell(value: string | number | null) {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
export function attendanceCsv(rows: AttendanceWorkerReport[]) {
  const header = [
    tr('attendance.csvWorkerCode'),
    tr('attendance.csvWorkerName'),
    tr('attendance.csvTodayStatus'),
    tr('attendance.csvConfirmedMinutes'),
    tr('attendance.csvRegularMinutes'),
    tr('attendance.csvOvertimeMinutes'),
    tr('attendance.csvProvisionalMinutes'),
    tr('attendance.csvPresentDays'),
    tr('attendance.csvRequiredDays'),
    tr('attendance.csvPresenceRate'),
  ];
  return (
    '\uFEFF' +
    [
      header.map(cell).join(','),
      ...rows.map((w) =>
        [
          w.workerCode,
          w.workerName,
          localizedLabel(w.todayStatus),
          w.totalMinutes,
          w.regularMinutes,
          w.overtimeMinutes,
          w.provisionalMinutes,
          w.presentDays,
          w.requiredDays,
          w.attendanceRate,
        ]
          .map(cell)
          .join(','),
      ),
    ].join('\r\n')
  );
}
