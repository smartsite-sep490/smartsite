import type { DataSource } from 'typeorm';
import type { CameraObservationZones } from '@smartsite/contracts';
import { conflict, missing, page, uuid } from '../../common/configuration/commands.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import type { ZoneConfigurationService } from '../zones/zone-configuration.service.js';

/** Read one consistent configuration snapshot without requiring a running camera or AI. */
export async function readCameraObservationZones(
  dataSource: DataSource,
  zones: ZoneConfigurationService,
  requestedSite: string,
  requestedCamera: string,
  offset: number,
  limit: number,
): Promise<CameraObservationZones> {
  const siteId = uuid(requestedSite).toLowerCase();
  const cameraId = uuid(requestedCamera).toLowerCase();
  const paging = page(offset, limit);
  return dataSource.transaction('REPEATABLE READ', async (manager) => {
    const camera = await manager.getRepository(CameraEntity).findOneBy({ siteId, id: cameraId });
    if (!camera) missing();
    const regions = await manager.getRepository(CameraObservationRegionEntity).find({
      where: { cameraId, isActive: true },
      select: { id: true, zoneId: true },
      order: { id: 'ASC' },
      take: 65,
    });
    if (regions.length > 64) conflict('Stored camera observation context exceeds its limit');
    const ids = [...new Set(regions.map((region) => region.zoneId))];
    const references = await zones.observationReferences(manager, siteId, ids);
    const found = new Set(references.map((zone) => zone.id));
    const items = references.sort((a, b) => a.id.localeCompare(b.id));
    return {
      siteId,
      cameraId,
      configurationVersion: camera.configurationVersion,
      items: items.slice(paging.offset, paging.offset + paging.limit),
      total: items.length,
      unresolvedRegionCount: regions.filter((region) => !found.has(region.zoneId)).length,
    };
  });
}
