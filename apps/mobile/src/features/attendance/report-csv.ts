import type { AttendanceWorkerReport } from '@smartsite/api-client';
function cell(value: string | number | null) {
  const text = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
}
export function attendanceCsv(rows: AttendanceWorkerReport[]) {
  const header = [
    'Mã công nhân',
    'Họ tên',
    'Trạng thái hôm nay',
    'Tổng phút đã xác nhận',
    'Phút thường',
    'Phút tăng ca',
    'Phút tạm tính',
    'Ngày có mặt',
    'Ngày yêu cầu',
    'Tỷ lệ có mặt',
  ];
  return (
    '\uFEFF' +
    [
      header.map(cell).join(','),
      ...rows.map((w) =>
        [
          w.workerCode,
          w.workerName,
          w.todayStatus,
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
