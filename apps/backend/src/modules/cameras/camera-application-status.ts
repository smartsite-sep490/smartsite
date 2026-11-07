import type { DataSource } from 'typeorm';
import {
  parseCameraApplicationStatus,
  type CameraApplicationStatus,
} from '@smartsite/contracts/camera-application-status';
import { missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import {
  CameraWorkerGenerationEntity,
  CameraConfigurationApplicationReceiptEntity,
} from '../../database/entities/camera-worker-generation.entity.js';
import { readIssuedCameraBundleInTransaction } from './camera-configuration-bundle-reader.js';

/** A saved version, worker application and physical pose remain separate facts. */
export async function readCameraApplicationStatus(
  source: DataSource,
  siteId: string,
  cameraId: string,
  maxAgeMs: number,
): Promise<CameraApplicationStatus> {
  siteId = uuid(siteId).toLowerCase();
  cameraId = uuid(cameraId).toLowerCase();
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 3600000)
    throw new RangeError('Invalid receipt freshness budget');
  try {
    return await source.transaction('REPEATABLE READ', async (manager) => {
      const camera = await manager.getRepository(CameraEntity).findOneBy({ id: cameraId, siteId });
      if (!camera) missing();
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        throw new Error('Unavailable clock');
      const view = await manager
        .getRepository(CameraViewRevisionEntity)
        .findOneBy({ cameraId, siteId, isCurrent: true });
      const generation = await manager.getRepository(CameraWorkerGenerationEntity).findOne({
        where: { cameraId, siteId },
        order: { isCurrent: 'DESC', issuedAt: 'DESC', id: 'DESC' },
      });
      const receipt = generation
        ? await manager.getRepository(CameraConfigurationApplicationReceiptEntity).findOne({
            where: { cameraId, siteId, workerGenerationId: generation.id },
            order: { configurationVersion: 'DESC', receiptOrder: 'DESC' },
          })
        : null;
      const futureReceipt = receipt !== null && receipt.receivedAt > now;
      const result: CameraApplicationStatus = {
        cameraId,
        siteId,
        desiredRevision: camera.configurationVersion,
        reportedRevision: receipt && !futureReceipt ? Number(receipt.configurationVersion) : null,
        applicationState: 'UNCONFIRMED',
        observedAt: now.toISOString(),
        lastReceiptAt: receipt && !futureReceipt ? receipt.receivedAt.toISOString() : null,
        viewValidity: view ? 'UNCONFIRMED' : 'UNAVAILABLE',
        reasonCode: null,
      };
      let viewValidity = result.viewValidity;
      const set = (state: CameraApplicationStatus['applicationState'], reason: string | null) => {
        const status = parseCameraApplicationStatus({
          ...result,
          viewValidity,
          applicationState: state,
          reasonCode: reason,
        });
        if (!status) throw new Error('Invalid application status');
        return status;
      };
      if (camera.status !== CameraStatus.ACTIVE) return set('STALE', 'CAMERA_INACTIVE');
      if (futureReceipt) return set('STALE', 'APPLICATION_RECEIPT_CLOCK_SKEW');
      if (!generation) return set('UNCONFIRMED', 'NO_WORKER_GENERATION');
      if (
        !generation.isCurrent ||
        generation.revokedAt ||
        generation.supersededAt ||
        now < generation.issuedAt ||
        now >= generation.expiresAt
      )
        return set('STALE', 'WORKER_GENERATION_STALE');
      if (!view) return set('STALE', 'VIEW_UNAVAILABLE');
      let bundle;
      try {
        bundle = await readIssuedCameraBundleInTransaction(manager, cameraId);
      } catch (error) {
        if (error instanceof PublicHttpException && error.getStatus() === 409) {
          viewValidity = 'NEEDS_REVALIDATION';
          return set('PENDING', 'CONFIGURATION_NOT_ISSUED');
        }
        throw error;
      }
      if (!receipt) return set('UNCONFIRMED', 'NO_APPLICATION_RECEIPT');
      if (
        receipt.streamSessionId !== generation.streamSessionId ||
        Number(receipt.viewRevision) !== bundle.viewRevision
      )
        return set('STALE', 'RECEIPT_CONTEXT_STALE');
      if (receipt.receivedAt > now || now.getTime() - receipt.receivedAt.getTime() >= maxAgeMs)
        return set('STALE', 'APPLICATION_RECEIPT_STALE');
      if (Number(receipt.configurationVersion) < camera.configurationVersion)
        return set('PENDING', 'DESIRED_CONFIGURATION_PENDING');
      if (
        Number(receipt.configurationVersion) !== bundle.configurationVersion ||
        receipt.bundleSha256 !== bundle.bundleSha256
      )
        throw new Error('Receipt does not match current issuance');
      return set(
        receipt.outcome === 'LOADED' ? 'LOADED' : 'REJECTED',
        receipt.outcome === 'REJECTED' ? receipt.reasonCode : null,
      );
    });
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Camera application status is unavailable',
    });
  }
}
