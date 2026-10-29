import {
  parseRegionGeometryConfirmation,
  type RegionGeometryConfirmation,
} from '@smartsite/contracts/camera-region-geometry-confirmation';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';

export type ConfirmedRegionEntity = CameraObservationRegionEntity & {
  geometryConfirmation: RegionGeometryConfirmation;
};

interface ConfirmationRow {
  region_id: string;
  geometry_version: number;
  reference_id: string | null;
  view_revision: string | null;
  confirmed_by_user_id: string | null;
  confirmed_at: Date | null;
  is_current: boolean | null;
}

/** Exact loaded versions, one scoped query per page; authoring TTL is not history validity. */
export async function attachRegionConfirmations(
  source: DataSource,
  siteId: string,
  cameraId: string,
  regions: readonly CameraObservationRegionEntity[],
): Promise<ConfirmedRegionEntity[]> {
  if (!regions.length) return [];
  const rows = await source.query<ConfirmationRow[]>(
    `SELECT h.region_id,h.geometry_version,h.reference_id,h.view_revision,
      h.confirmed_by_user_id,h.confirmed_at,v.is_current
     FROM camera_region_geometry_revision h
     JOIN camera c ON c.id=h.camera_id AND c.site_id=$1
     JOIN unnest($3::uuid[],$4::integer[]) wanted(region_id,geometry_version)
       ON wanted.region_id=h.region_id AND wanted.geometry_version=h.geometry_version
     LEFT JOIN camera_view_revision v
       ON v.camera_id=h.camera_id AND v.revision=h.view_revision AND v.site_id=c.site_id
     WHERE h.camera_id=$2`,
    [siteId, cameraId, regions.map((r) => r.id), regions.map((r) => r.version)],
  );
  const byVersion = new Map(rows.map((r) => [`${r.region_id}:${r.geometry_version}`, r]));
  try {
    return regions.map((region) => {
      const row = byVersion.get(`${region.id}:${region.version}`);
      if (row?.reference_id && typeof row.is_current !== 'boolean')
        throw new Error('Confirmed view is unavailable');
      const confirmation = parseRegionGeometryConfirmation({
        status: !row?.reference_id
          ? 'UNCONFIRMED'
          : row.is_current
            ? 'MANUALLY_CONFIRMED'
            : 'NEEDS_REVALIDATION',
        referenceId: row?.reference_id ?? null,
        viewRevision: row?.view_revision == null ? null : Number(row.view_revision),
        confirmedByUserId: row?.confirmed_by_user_id ?? null,
        confirmedAt: row?.confirmed_at?.toISOString() ?? null,
      });
      return Object.assign(region, { geometryConfirmation: confirmation });
    });
  } catch {
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Region confirmation is unavailable',
    });
  }
}
