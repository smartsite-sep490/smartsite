import type { UserNotificationResponse } from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import type { UserNotificationEntity } from '../../../database/entities/user-notification.entity.js';

// Correlate by the scoped day, never by work date alone (a Worker can have two shifts).
export const notificationGroupingScope = `NOT (
  n.request_type='ATTENDANCE' AND (
    (n.event='MISSING_ATTENDANCE' AND EXISTS (
      SELECT 1 FROM user_notification specific
      WHERE specific.recipient_user_id=n.recipient_user_id AND specific.recipient_role=n.recipient_role AND specific.site_id=n.site_id
        AND specific.contractor_id=n.contractor_id AND specific.request_type='ATTENDANCE'
        AND specific.event='MISSING_CHECKOUT'
        AND COALESCE(specific.content->>'dayId',specific.request_id::text)=COALESCE(n.content->>'dayId',n.request_id::text)
    )) OR (n.event IN ('MISSING_ATTENDANCE','MISSING_CHECKOUT') AND n.recipient_role='CONTRACTOR_REPRESENTATIVE' AND EXISTS (
      SELECT 1 FROM attendance_session session
      JOIN worker w ON w.id=session.worker_id AND w.site_id=n.site_id AND w.contractor_id=n.contractor_id
      JOIN attendance_correction correction ON correction.attendance_session_id=session.id AND correction.status='PENDING'
      JOIN user_notification request_notice ON request_notice.request_id=correction.id
        AND request_notice.recipient_user_id=n.recipient_user_id AND request_notice.recipient_role=n.recipient_role AND request_notice.site_id=n.site_id
        AND request_notice.contractor_id=n.contractor_id AND request_notice.request_type='ATTENDANCE'
        AND request_notice.event='TIME_REQUESTED' AND request_notice.deleted_at IS NULL
      WHERE session.site_id=n.site_id AND session.day_id::text=COALESCE(n.content->>'dayId',n.request_id::text)
    )) OR (n.event='TIME_REQUESTED' AND EXISTS (
      SELECT 1 FROM attendance_correction correction
      JOIN attendance_session session ON session.id=correction.attendance_session_id AND session.site_id=n.site_id
      JOIN worker w ON w.id=session.worker_id AND w.site_id=n.site_id AND w.contractor_id=n.contractor_id
      JOIN user_notification issue ON issue.recipient_user_id=n.recipient_user_id AND issue.recipient_role=n.recipient_role AND issue.site_id=n.site_id
        AND issue.contractor_id=n.contractor_id AND issue.request_type='ATTENDANCE'
        AND issue.event IN ('MISSING_ATTENDANCE','MISSING_CHECKOUT')
        AND COALESCE(issue.content->>'dayId',issue.request_id::text)=session.day_id::text
      WHERE correction.id=n.request_id AND correction.status<>'PENDING'
    ))
  )
)`;

export interface AttendanceNoticeContext {
  notification_id: string;
  display_name: string;
  missing_evidence: boolean;
  request_status: string | null;
  pending_correction_id: string | null;
  latest_correction_status: string | null;
}

export function processingStatus(
  event: string,
  role: string,
  context: AttendanceNoticeContext,
): UserNotificationResponse['processingStatus'] {
  if (event === 'TIME_REQUESTED') {
    if (['PENDING', 'PENDING_MANAGER'].includes(context.request_status ?? ''))
      return 'PENDING_REVIEW';
    if (['APPROVED', 'REJECTED', 'CANCELLED', 'CONFLICTED'].includes(context.request_status ?? ''))
      return 'RESOLVED';
    return undefined;
  }
  if (!['MISSING_ATTENDANCE', 'MISSING_CHECKOUT'].includes(event)) return undefined;
  if (!context.missing_evidence) return 'RESOLVED';
  if (context.pending_correction_id) return 'PENDING_REVIEW';
  if (role === 'CONTRACTOR_REPRESENTATIVE') return 'WAITING_WORKER';
  return context.latest_correction_status === 'REJECTED' ? 'NEEDS_RESUBMISSION' : 'ACTION_REQUIRED';
}

/** Only IDs already authorized by the notification query may enter this reader. */
export async function attendanceNoticeContexts(
  manager: EntityManager,
  notices: UserNotificationEntity[],
): Promise<Map<string, AttendanceNoticeContext>> {
  const ids = notices.filter((n) => n.requestType === 'ATTENDANCE').map((n) => n.id);
  if (!ids.length) return new Map();
  const rows: AttendanceNoticeContext[] = await manager.query(
    `
    SELECT n.id AS notification_id,w.display_name,
      (d.anomalies ?| ARRAY['MISSING_IN','MISSING_OUT','ZONE_GATE_MISSING']
        OR EXISTS(SELECT 1 FROM attendance_session s WHERE s.day_id=d.id AND s.site_id=d.site_id
          AND s.worker_id=d.worker_id AND s.status<>'IGNORED' AND (s.effective_in_at IS NULL OR s.effective_out_at IS NULL))
        OR (d.status<>'CONFIRMED' AND NOT EXISTS(SELECT 1 FROM attendance_session s WHERE s.day_id=d.id
          AND s.site_id=d.site_id AND s.worker_id=d.worker_id AND s.status<>'IGNORED'
          AND s.effective_in_at IS NOT NULL AND s.effective_out_at IS NOT NULL))) AS missing_evidence,
      COALESCE(direct_correction.status,ot.status,leave_request.status) AS request_status,
      pending.id AS pending_correction_id,latest.status AS latest_correction_status
    FROM user_notification n
    JOIN attendance_day d ON d.id::text=COALESCE(n.content->>'dayId',n.request_id::text) AND d.site_id=n.site_id
    JOIN worker w ON w.id=d.worker_id AND w.site_id=n.site_id AND w.contractor_id=n.contractor_id
      AND (n.worker_id IS NULL OR n.worker_id=w.id)
    LEFT JOIN attendance_session direct_session ON direct_session.day_id=d.id AND direct_session.site_id=d.site_id
      AND direct_session.worker_id=w.id
      AND EXISTS(SELECT 1 FROM attendance_correction c WHERE c.id=n.request_id AND c.attendance_session_id=direct_session.id)
    LEFT JOIN attendance_correction direct_correction ON direct_correction.id=n.request_id AND direct_correction.attendance_session_id=direct_session.id
    LEFT JOIN overtime_request ot ON ot.id=n.request_id AND ot.site_id=n.site_id AND ot.worker_id=w.id AND ot.schedule_id=d.schedule_id
    LEFT JOIN absence_request leave_request ON leave_request.id=n.request_id AND leave_request.site_id=n.site_id
      AND leave_request.worker_id=w.id AND leave_request.worker_schedule_id=d.schedule_id
    LEFT JOIN LATERAL (SELECT c.id FROM attendance_correction c JOIN attendance_session s ON s.id=c.attendance_session_id
      WHERE s.day_id=d.id AND s.site_id=d.site_id AND s.worker_id=w.id AND c.status='PENDING'
      ORDER BY c.created_at DESC,c.id DESC LIMIT 1) pending ON TRUE
    LEFT JOIN LATERAL (SELECT c.status FROM attendance_correction c JOIN attendance_session s ON s.id=c.attendance_session_id
      WHERE s.day_id=d.id AND s.site_id=d.site_id AND s.worker_id=w.id
      ORDER BY c.created_at DESC,c.id DESC LIMIT 1) latest ON TRUE
    WHERE n.id=ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.notification_id, r]));
}
