/** Immutable SQL used by migration 1793318400000 and its entity projection. */
export const ZONE_ALERT_NOTIFICATION_TARGET_V1 = `(request_type='SAFETY_ALERT' AND event='ZONE_ALERT_CREATED'
 AND recipient_role='SAFETY_OFFICER' AND contractor_id IS NULL AND worker_id IS NULL
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
 AND jsonb_typeof(content->'safetyAlert'->'zoneId')='string'
 AND COALESCE(content->'safetyAlert'->>'zoneId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 AND jsonb_typeof(content->'safetyAlert'->'zoneName')='string'
 AND length(content->'safetyAlert'->>'zoneName') BETWEEN 1 AND 255
 AND jsonb_typeof(content->'safetyAlert'->'candidateSubtype')='string'
 AND content->'safetyAlert'->>'candidateSubtype' IN
 ('ZONE_ENTRY_PROHIBITED','ZONE_ENTRY_UNAUTHORIZED','ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE'))`;
