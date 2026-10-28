import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Expand notification kinds without rewriting Main's applied migration or deleting history. */
export class ExpandedPpeNotificationKinds1793145600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('PPE notification migration requires a transaction');
    await runner.query(`ALTER TABLE user_notification
 DROP CONSTRAINT chk_notification_ppe_target,
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
 AND content->'safetyAlert'->>'candidateSubtype' IN ('PPE_HARD_HAT_MISSING','PPE_SAFETY_VEST_MISSING','PPE_GLOVES_MISSING','PPE_BOOTS_MISSING','PPE_GOGGLES_MISSING')
 AND ((jsonb_typeof(content->'safetyAlert'->'zoneId')='null' AND jsonb_typeof(content->'safetyAlert'->'zoneName')='null')
 OR (jsonb_typeof(content->'safetyAlert'->'zoneId')='string'
 AND COALESCE(content->'safetyAlert'->>'zoneId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND jsonb_typeof(content->'safetyAlert'->'zoneName')='string'
 AND length(content->'safetyAlert'->>'zoneName') BETWEEN 1 AND 255)))) IS TRUE);
`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('PPE notification migration requires a transaction');
    await runner.query(`DO $rollback$
BEGIN
 IF EXISTS(SELECT 1 FROM user_notification WHERE request_type='SAFETY_ALERT' AND content->'safetyAlert'->>'candidateSubtype' IN ('PPE_GLOVES_MISSING','PPE_BOOTS_MISSING','PPE_GOGGLES_MISSING')) THEN
  RAISE EXCEPTION 'Expanded PPE notification history must be retained before rollback';
 END IF;
END
$rollback$;
ALTER TABLE user_notification
 DROP CONSTRAINT chk_notification_ppe_target,
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
}
