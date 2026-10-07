import type { MigrationInterface, QueryRunner } from 'typeorm';
export class SafetyHandoverNotifications1791590400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE corrective_action
      ADD superseded_at timestamptz,
      ADD superseded_by uuid CONSTRAINT action_superseded_by_fkey REFERENCES app_user(id),
      ADD superseded_reason text,
      ADD CONSTRAINT action_supersession_check CHECK (
        (superseded_at IS NULL AND superseded_by IS NULL AND superseded_reason IS NULL) OR
        (superseded_at IS NOT NULL AND superseded_by IS NOT NULL AND superseded_reason IS NOT NULL AND length(trim(superseded_reason))>0))`);
    await q.query(`ALTER TABLE user_notification
      DROP CONSTRAINT chk_notification_request_type,
      DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY')),
      ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER')),
      ADD CONSTRAINT chk_notification_safety_target CHECK (
        (request_type<>'SAFETY' AND event<>'SAFETY_HANDOVER') OR
        (request_type='SAFETY' AND event='SAFETY_HANDOVER' AND recipient_role='CONTRACTOR_REPRESENTATIVE'
          AND jsonb_typeof(content->'incidentId')='string' AND jsonb_typeof(content->'actionId')='string'
          AND COALESCE(content->>'incidentId','')<>'' AND COALESCE(content->>'actionId','')<>''
          AND (content->>'incidentId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          AND (content->>'actionId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM corrective_action WHERE superseded_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM user_notification WHERE request_type='SAFETY') THEN
      RAISE EXCEPTION 'Preserve handover history before downgrade'; END IF; END $$`);
    await q.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_safety_target,
      DROP CONSTRAINT chk_notification_request_type, DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP')),
      ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED'))`);
    await q.query(`ALTER TABLE corrective_action DROP CONSTRAINT action_supersession_check,
      DROP superseded_at, DROP superseded_by, DROP superseded_reason`);
  }
}
