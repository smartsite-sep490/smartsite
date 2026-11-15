/** Advisory staffing notice. Late and emergency requests still require human review. */
export const LEAVE_NOTICE_HOURS = 24;
export type LeaveNoticeType = 'PLANNED' | 'EMERGENCY';

export function leaveNotice(
  shiftStartsAt: Date,
  noticeType: LeaveNoticeType = 'PLANNED',
  submittedAt = new Date(),
) {
  if (!Number.isFinite(+shiftStartsAt) || !Number.isFinite(+submittedAt))
    throw new RangeError('Invalid leave notice time');
  return {
    noticeType,
    shortNotice: +shiftStartsAt - +submittedAt < LEAVE_NOTICE_HOURS * 3600000,
  };
}
