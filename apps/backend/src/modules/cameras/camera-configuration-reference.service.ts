import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { parseCameraConfigurationImageReference } from '@smartsite/contracts/camera-configuration-image';
import { conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import {
  CameraConfigurationReferenceEntity,
  CameraViewRevisionEntity,
} from '../../database/entities/camera-configuration-reference.entity.js';
import { CameraConfigurationImageService } from './camera-configuration-image.service.js';

function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Camera configuration reference is unavailable',
  });
}

/** Persists authoring provenance only; never confirms camera pose or applies geometry. */
@Injectable()
export class CameraConfigurationReferenceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly images: CameraConfigurationImageService,
  ) {}

  async read(token: string, requestedSite: string, requestedCamera: string, signal?: AbortSignal) {
    const siteId = uuid(requestedSite).toLowerCase(),
      cameraId = uuid(requestedCamera).toLowerCase();
    const image = await this.images.read(token, siteId, cameraId, signal);
    try {
      const reference = await this.dataSource.transaction(async (manager) => {
        const actorId = await this.images.authorize(token, siteId, manager);
        const camera = await manager
          .getRepository(CameraEntity)
          .createQueryBuilder('camera')
          .setLock('pessimistic_write')
          .where('camera.id=:cameraId AND camera.siteId=:siteId', { cameraId, siteId })
          .getOne();
        if (
          !camera ||
          image.siteId.toLowerCase() !== siteId ||
          image.cameraId.toLowerCase() !== cameraId
        )
          missing();
        if (
          signal?.aborted ||
          camera.status !== CameraStatus.ACTIVE ||
          camera.externalId !== image.frame.cameraExternalId
        )
          unavailable();
        if (camera.configurationVersion !== image.configurationVersion)
          conflict('Configuration version changed');
        const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) unavailable();
        const views = manager.getRepository(CameraViewRevisionEntity);
        let view = await views
          .createQueryBuilder('view')
          .setLock('pessimistic_write')
          .where('view.cameraId=:cameraId AND view.isCurrent=true', { cameraId })
          .getOne();
        const sessionId = image.frame.sessionId.toLowerCase();
        if (
          !view ||
          view.siteId !== siteId ||
          view.sessionId !== sessionId ||
          view.sourceKind !== image.sourceKind ||
          view.width !== image.frame.width ||
          view.height !== image.frame.height
        ) {
          const [{ maximum }] = await manager.query(
            'SELECT COALESCE(MAX(revision),0)::text AS maximum FROM camera_view_revision WHERE camera_id=$1',
            [cameraId],
          );
          const previous = Number(maximum);
          if (
            !Number.isSafeInteger(previous) ||
            previous < 0 ||
            previous >= Number.MAX_SAFE_INTEGER
          )
            conflict('View revision exhausted');
          if (view) {
            if (now < view.createdAt) unavailable();
            await views.update(
              { cameraId, revision: view.revision },
              { isCurrent: false, retiredAt: now },
            );
          }
          view = views.create({
            cameraId,
            revision: String(previous + 1),
            siteId,
            sessionId,
            sourceKind: image.sourceKind,
            width: image.frame.width,
            height: image.frame.height,
            viewValidity: 'UNCONFIRMED',
            isCurrent: true,
            createdAt: now,
            retiredAt: null,
          });
          await views.insert(view);
        }
        const value = parseCameraConfigurationImageReference({
          schemaVersion: '1.0.0',
          purpose: 'REGION_CONFIGURATION',
          sourceKind: image.sourceKind,
          referenceId: randomUUID(),
          siteId,
          cameraId,
          sessionId,
          imageSha256: image.frame.imageSha256,
          width: image.frame.width,
          height: image.frame.height,
          capturedAt: image.frame.capturedAt,
          issuedAt: now.toISOString(),
          expiresAt: image.referenceExpiresAt,
          configurationVersion: camera.configurationVersion,
          viewRevision: Number(view.revision),
        });
        await manager.getRepository(CameraConfigurationReferenceEntity).insert({
          id: value.referenceId,
          cameraId,
          siteId,
          viewRevision: view.revision,
          sessionId,
          sourceKind: value.sourceKind,
          width: value.width,
          height: value.height,
          imageSha256: value.imageSha256,
          configurationVersion: String(value.configurationVersion),
          capturedAt: new Date(value.capturedAt),
          issuedAt: now,
          expiresAt: new Date(value.expiresAt),
          issuedByUserId: actorId,
        });
        if (signal?.aborted) unavailable();
        return value;
      });
      await this.images.authorize(token, siteId);
      if (signal?.aborted) unavailable();
      return { image, reference, viewValidity: 'UNCONFIRMED' as const };
    } catch (error) {
      await this.images.authorize(token, siteId);
      if (error instanceof PublicHttpException) throw error;
      return unavailable();
    }
  }
}
