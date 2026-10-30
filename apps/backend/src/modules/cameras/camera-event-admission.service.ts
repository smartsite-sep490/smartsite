import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { WorkerEventDeliveryContext } from '@smartsite/contracts';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import {
  CameraWorkerGenerationEntity,
  CameraConfigurationApplicationReceiptEntity,
} from '../../database/entities/camera-worker-generation.entity.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { readHistoricalIssuedCameraBundleInTransaction } from './camera-configuration-bundle-reader.js';

function reject(status: number): never {
  throw new PublicHttpException(status, {
    code: status === 401 ? 'UNAUTHORIZED' : 'CONFLICT',
    message: 'Worker event context is unavailable',
  });
}

@Injectable()
export class CameraEventAdmissionService {
  /** Producer authentication and issued state, never proof of physical capture time. */
  async admit(
    manager: EntityManager,
    context: WorkerEventDeliveryContext,
    secret: string,
    cameraExternalId: string,
    allowedCameraIds: readonly string[],
    claimedCapture: Date | undefined,
    clockToleranceMs: number,
  ) {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Event admission requires transaction');
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) reject(401);
    if (!allowedCameraIds.includes(context.cameraId)) reject(401);
    const camera = await manager
      .getRepository(CameraEntity)
      .findOne({ where: { id: context.cameraId }, lock: { mode: 'pessimistic_write' } });
    if (!camera || camera.externalId !== cameraExternalId) reject(401);
    const generation = await manager
      .getRepository(CameraWorkerGenerationEntity)
      .createQueryBuilder('generation')
      .addSelect('generation.credentialSha256')
      .where('generation.id=:id AND generation.cameraId=:cameraId AND generation.siteId=:siteId', {
        id: context.workerGenerationId,
        cameraId: camera.id,
        siteId: camera.siteId,
      })
      .getOne();
    if (
      !generation ||
      !/^[a-f0-9]{64}$/.test(generation.credentialSha256) ||
      !timingSafeEqual(
        createHash('sha256').update(secret).digest(),
        Buffer.from(generation.credentialSha256, 'hex'),
      ) ||
      generation.streamSessionId !== context.streamSessionId ||
      generation.revokedAt
    )
      reject(401);
    const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) reject(409);
    const receipt = await manager
      .getRepository(CameraConfigurationApplicationReceiptEntity)
      .findOneBy({
        commandId: context.receiptCommandId,
        cameraId: camera.id,
        siteId: camera.siteId,
        workerGenerationId: generation.id,
        streamSessionId: context.streamSessionId,
        configurationVersion: String(context.configurationVersion),
        viewRevision: String(context.viewRevision),
        bundleSha256: context.bundleSha256,
        outcome: 'LOADED',
      });
    if (!receipt || receipt.receivedAt > now) reject(409);
    const bundle = await readHistoricalIssuedCameraBundleInTransaction(manager, {
      ...context,
      siteId: camera.siteId,
      cameraExternalId,
    });
    const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
      cameraId: camera.id,
      siteId: camera.siteId,
      revision: String(context.viewRevision),
    });
    if (!bundle || !view || view.sourceKind !== context.sourceKind) reject(409);
    const latest = await manager
      .getRepository(CameraConfigurationApplicationReceiptEntity)
      .findOne({
        where: { workerGenerationId: generation.id, cameraId: camera.id },
        order: { configurationVersion: 'DESC', receiptOrder: 'DESC' },
      });
    const live =
      claimedCapture instanceof Date &&
      Number.isFinite(claimedCapture.getTime()) &&
      Number.isSafeInteger(clockToleranceMs) &&
      clockToleranceMs >= 0 &&
      claimedCapture.getTime() >=
        Math.max(generation.issuedAt.getTime(), Date.parse(bundle.issuedAt)) - clockToleranceMs &&
      claimedCapture.getTime() <= now.getTime() + clockToleranceMs &&
      context.sourceKind === 'LIVE' &&
      camera.status === CameraStatus.ACTIVE &&
      generation.isCurrent &&
      !generation.supersededAt &&
      now >= generation.issuedAt &&
      now < generation.expiresAt &&
      view.isCurrent &&
      camera.configurationVersion === context.configurationVersion &&
      latest?.outcome === 'LOADED' &&
      latest.configurationVersion === String(context.configurationVersion) &&
      latest.bundleSha256 === context.bundleSha256 &&
      latest.viewRevision === String(context.viewRevision) &&
      now.getTime() - receipt.receivedAt.getTime() <= 60000;
    return {
      camera,
      bundle,
      classification: live ? ('LIVE' as const) : ('REVIEW_ONLY' as const),
      admittedAt: now.toISOString(),
    };
  }
}
