import type { DataSource } from 'typeorm';

export type OwnershipQueryExecutor = Pick<DataSource, 'query'>;

export const CAMERA_SOURCE_OWNERSHIP_LOCK_SQL =
  "hashtext(current_schema() || ':source-apply'),hashtext($1)";

/**
 * True when a camera already owns an active or unsuperseded physical worker generation.
 * Matches the ownership boundary used by bootstrapCameraWorkerGeneration().
 */
export async function hasPhysicalWorkerBinding(
  executor: OwnershipQueryExecutor,
  siteId: string,
  cameraId: string,
): Promise<boolean> {
  const rows = (await executor.query(
    `SELECT EXISTS (
       SELECT 1
       FROM camera_worker_generation
       WHERE camera_id = $1
         AND site_id = $2
         AND (is_current = true OR superseded_at IS NULL)
     ) AS bound`,
    [cameraId, siteId],
  )) as Array<{ bound?: boolean }>;
  return rows[0]?.bound === true;
}

/**
 * True when a camera currently holds an active, unexpired browser uplink lease.
 * Tolerates legacy schemas where camera_browser_uplink_frame is not yet installed.
 */
export async function hasActiveBrowserUplinkLease(
  executor: OwnershipQueryExecutor,
  siteId: string,
  cameraId: string,
): Promise<boolean> {
  const [table] = (await executor.query(
    "SELECT to_regclass(format('%I.camera_browser_uplink_frame',current_schema())) IS NOT NULL AS installed",
  )) as Array<{ installed?: boolean }>;
  if (table?.installed !== true) return false;
  const rows = (await executor.query(
    `SELECT EXISTS (
       SELECT 1
       FROM camera_browser_uplink_frame
       WHERE camera_id = $1
         AND site_id = $2
         AND state = 'ACTIVE'
         AND lease_expires_at > clock_timestamp()
     ) AS active`,
    [cameraId, siteId],
  )) as Array<{ active?: boolean }>;
  return rows[0]?.active === true;
}
