/** Internal SQL aliases only; retain the underlying pending request for audit/review. */
export function coveredPendingLeaveSql(alias: 'request' | 'a') {
  return `(${alias}.status='PENDING_MANAGER' AND EXISTS (
    SELECT 1 FROM absence_request approved
    LEFT JOIN attendance_day leave_day
      ON leave_day.schedule_id=approved.worker_schedule_id
      AND leave_day.site_id=approved.site_id AND leave_day.worker_id=approved.worker_id
    WHERE approved.site_id=${alias}.site_id AND approved.worker_id=${alias}.worker_id
      AND approved.worker_schedule_id=${alias}.worker_schedule_id
      AND approved.shift_id=${alias}.shift_id
      AND approved.expected_schedule_version_id=${alias}.expected_schedule_version_id
      AND approved.status='APPROVED'
      AND COALESCE(approved.starts_at,leave_day.starts_at)<=COALESCE(${alias}.starts_at,leave_day.starts_at)
      AND COALESCE(approved.ends_at,leave_day.ends_at)>=COALESCE(${alias}.ends_at,leave_day.ends_at)
  ))`;
}
