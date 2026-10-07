import type { DataSource } from 'typeorm';

/** Remove only the synthetic sites owned by the calling integration test. */
export async function cleanupSiteAccess(source: DataSource, siteIds: string[]) {
  await source.query(
    'UPDATE attendance_session SET applied_correction_id = NULL WHERE site_id = ANY($1)',
    [siteIds],
  );
  await source.query(
    'DELETE FROM attendance_correction WHERE attendance_session_id IN (SELECT id FROM attendance_session WHERE site_id = ANY($1))',
    [siteIds],
  );
  await source.query('DELETE FROM attendance_session WHERE site_id = ANY($1)', [siteIds]);
  await source.query('DELETE FROM attendance_event WHERE site_id = ANY($1)', [siteIds]);
  await source.query('DELETE FROM gate_event WHERE site_id = ANY($1)', [siteIds]);
  await source.query('DELETE FROM access_attempt WHERE site_id = ANY($1)', [siteIds]);
  await source.query(
    'DELETE FROM audit_log WHERE site_id = ANY($1) OR entity_id IN (SELECT s.id FROM face_enrollment_session s JOIN worker w ON w.id = s.worker_id WHERE w.site_id = ANY($1))',
    [siteIds],
  );
  await source.query(
    'DELETE FROM worker_zone_permission WHERE worker_assignment_id IN (SELECT id FROM worker_site_zone_assignment WHERE site_id = ANY($1))',
    [siteIds],
  );
  await source.query(
    'DELETE FROM contractor_zone_permission WHERE site_contractor_id IN (SELECT id FROM contractor_site_participation WHERE site_id = ANY($1))',
    [siteIds],
  );
}
