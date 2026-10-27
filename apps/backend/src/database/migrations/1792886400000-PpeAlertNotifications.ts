import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PpeAlertNotifications1792886400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE user_notification
        ALTER COLUMN contractor_id DROP NOT NULL,
        DROP CONSTRAINT chk_notification_request_type,
        DROP CONSTRAINT chk_notification_event,
        ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE','CHECKLIST','DOCUMENT','SAFETY_ALERT')),
        ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED','PPE_ALERT_CREATED')),
        ADD CONSTRAINT chk_notification_ppe_target CHECK(((request_type<>'SAFETY_ALERT' AND event<>'PPE_ALERT_CREATED' AND contractor_id IS NOT NULL) OR
 (request_type='SAFETY_ALERT' AND event='PPE_ALERT_CREATED' AND recipient_role='SAFETY_OFFICER'
 AND contractor_id IS NULL AND worker_id IS NULL
 AND jsonb_typeof(content)='object' AND content ?& ARRAY['siteName','title','message','safetyAlert']
 AND content - ARRAY['siteName','title','message','safetyAlert'] = '{}'::jsonb
 AND jsonb_typeof(content->'siteName')='string' AND length(content->>'siteName')>0
 AND jsonb_typeof(content->'title')='string' AND length(content->>'title')>0
 AND jsonb_typeof(content->'message')='string' AND length(content->>'message')>0
 AND jsonb_typeof(content->'safetyAlert')='object'
 AND (content->'safetyAlert') ?& ARRAY['cameraId','cameraName','zoneId','zoneName','candidateSubtype']
 AND (content->'safetyAlert') - ARRAY['cameraId','cameraName','zoneId','zoneName','candidateSubtype'] = '{}'::jsonb
 AND jsonb_typeof(content->'safetyAlert'->'cameraId')='string'
 AND COALESCE(content->'safetyAlert'->>'cameraId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND jsonb_typeof(content->'safetyAlert'->'cameraName')='string'
 AND length(content->'safetyAlert'->>'cameraName') BETWEEN 1 AND 255
 AND jsonb_typeof(content->'safetyAlert'->'candidateSubtype')='string'
 AND content->'safetyAlert'->>'candidateSubtype' IN ('PPE_HARD_HAT_MISSING','PPE_SAFETY_VEST_MISSING')
 AND ((jsonb_typeof(content->'safetyAlert'->'zoneId')='null' AND jsonb_typeof(content->'safetyAlert'->'zoneName')='null')
 OR (jsonb_typeof(content->'safetyAlert'->'zoneId')='string'
 AND COALESCE(content->'safetyAlert'->>'zoneId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND jsonb_typeof(content->'safetyAlert'->'zoneName')='string'
 AND length(content->'safetyAlert'->>'zoneName') BETWEEN 1 AND 255)))) IS TRUE);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const [used] = await runner.query(
      "SELECT EXISTS(SELECT 1 FROM user_notification WHERE request_type='SAFETY_ALERT' OR event='PPE_ALERT_CREATED') AS present",
    );
    if (used.present) throw new Error('PPE notification history must be retained before rollback');
    await runner.query(`
      ALTER TABLE user_notification
        DROP CONSTRAINT chk_notification_ppe_target,
        DROP CONSTRAINT chk_notification_request_type,
        DROP CONSTRAINT chk_notification_event,
        ALTER COLUMN contractor_id SET NOT NULL,
        ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE','CHECKLIST','DOCUMENT')),
        ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED'));
    `);
  }
}
