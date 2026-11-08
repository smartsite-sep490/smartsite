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

interface StoredTrackedReceipt {
  eventId: string;
  payloadHash: string;
  bindingHash: string;
  routeEpoch: string;
}

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
    return this.check(
      manager,
      context,
      { secret },
      cameraExternalId,
      allowedCameraIds,
      claimedCapture,
      clockToleranceMs,
    );
  }

  /** Internal recovery of prior producer authentication from a persisted TRACKED receipt. */
  async recheckStoredTracked(
    manager: EntityManager,
    context: WorkerEventDeliveryContext,
    receipt: StoredTrackedReceipt,
    cameraExternalId: string,
    allowedCameraIds: readonly string[],
    claimedCapture: Date,
    clockToleranceMs: number,
  ) {
    return this.check(
      manager,
      context,
      receipt,
      cameraExternalId,
      allowedCameraIds,
      claimedCapture,
      clockToleranceMs,
    );
  }

  private async check(
    manager: EntityManager,
    context: WorkerEventDeliveryContext,
    authentication: { secret: string } | StoredTrackedReceipt,
    cameraExternalId: string,
    allowedCameraIds: readonly string[],
    claimedCapture: Date | undefined,
    clockToleranceMs: number,
  ) {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Event admission requires transaction');
    if (
      'secret' in authentication &&
      (typeof authentication.secret !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(authentication.secret))
    )
      reject(401);
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
      generation.streamSessionId !== context.streamSessionId ||
      generation.revokedAt
    )
      reject(401);
    const authenticated =
      'secret' in authentication
        ? timingSafeEqual(
            createHash('sha256').update(authentication.secret).digest(),
            Buffer.from(generation.credentialSha256, 'hex'),
          )
        : await this.hasStoredTrackedReceipt(manager, context, generation, authentication);
    if (!authenticated) reject(401);
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

  private async hasStoredTrackedReceipt(
    manager: EntityManager,
    context: WorkerEventDeliveryContext,
    generation: CameraWorkerGenerationEntity,
    witness: StoredTrackedReceipt,
  ) {
    const rows = await manager.query(
      `SELECT 1 FROM ai_observation_event
      WHERE event_id=$1::uuid AND resolved_camera_id=$2 AND tracking_generation_id=$3
        AND stream_session_id=$4 AND tracking_site_id=$5 AND safety_route_mode='EPISODE_TRACKED'
        AND safety_route_epoch=$6 AND payload_hash=$7 AND admission_context->>'bindingHash'=$8
        AND tracking_transport_ack->>'kind'='RAW_STORED'
        AND tracking_transport_ack->>'eventId'=($1::uuid)::text
        AND tracking_transport_ack->>'payloadHash'=$7
        AND tracking_transport_ack->>'bindingHash'=$8`,
      [
        witness.eventId,
        context.cameraId,
        generation.id,
        context.streamSessionId,
        generation.siteId,
        witness.routeEpoch,
        witness.payloadHash,
        witness.bindingHash,
      ],
    );
    return rows.length === 1;
  }
}
