import { uiLocale } from '../../../i18n';

export function attendanceResolution(issues: string[]) {
  const vi = uiLocale().startsWith('vi');
  if (
    issues.some((i) =>
      [
        'ZONE_ASSIGNMENT_UNRESOLVED',
        'ZONE_ATTENDANCE_MISMATCH',
        'NO_SCHEDULE',
        'SCHEDULE_CHANGED',
      ].includes(i),
    )
  )
    return {
      assignment: true,
      message: vi
        ? 'Phân công hoặc khu vực không khớp. Đại diện nhà thầu kiểm tra lại trước khi chốt công.'
        : 'The schedule, team or work Zone does not match. The Contractor Representative must review the assignment before confirming hours.',
    };
  if (issues.some((i) => ['ZONE_GATE_MISSING', 'MISSING_IN', 'MISSING_OUT'].includes(i))) {
    const missing =
      issues.includes('MISSING_OUT') &&
      !issues.includes('MISSING_IN') &&
      !issues.includes('ZONE_GATE_MISSING')
        ? 'OUT'
        : issues.includes('MISSING_OUT')
          ? 'IN/OUT'
          : 'IN';
    return {
      assignment: false,
      message: vi
        ? `Công nhân chưa có lượt ${missing} được xác nhận. Công nhân gửi đơn điều chỉnh; Đại diện nhà thầu kiểm tra và duyệt chốt công.`
        : `A confirmed ${missing} is missing. Submit a correction request; the Contractor Representative reviews the evidence and confirms hours.`,
    };
  }
  if (issues.includes('ZONE_ATTENDANCE_PENDING'))
    return {
      assignment: false,
      message: vi
        ? 'Chưa có điểm danh khu vực từ nhóm trưởng. Đại diện nhà thầu kiểm tra và duyệt chốt công sau khi hết ca.'
        : 'Zone roll call is missing. After the shift, the Contractor Representative reviews the evidence and confirms hours.',
    };
  return null;
}
