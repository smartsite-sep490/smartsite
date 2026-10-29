import { createHash, timingSafeEqual } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  parseCameraConfigurationAcknowledgementPayload,
} from '@smartsite/contracts';
import { conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraConfigurationBundleEntity } from '../../database/entities/camera-configuration-bundle.entity.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import {
  CameraWorkerGenerationEntity,
  CameraConfigurationApplicationReceiptEntity,
} from '../../database/entities/camera-worker-generation.entity.js';

function unauthorized(): never {
  throw new PublicHttpException(401, {
    code: 'UNAUTHORIZED',
    message: 'Worker credential is invalid',
  });
}

/** Persists a worker claim; this response never declares current application readiness. */
export async function recordCameraConfigurationAcknowledgement(
  source: DataSource,
  cameraId: string,
  secret: string,
  input: unknown,
) {
  cameraId = uuid(cameraId).toLowerCase();
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) unauthorized();
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    invalid();
  }
  if (typeof serialized !== 'string') invalid();
  const parsed = parseCameraConfigurationAcknowledgementPayload(serialized);
  if (!parsed.isValid || !parsed.value) invalid();
  const ack = parsed.value;
  try {
    return await source.transaction(async (manager) => {
      const camera = await manager
        .getRepository(CameraEntity)
        .findOne({ where: { id: cameraId }, lock: { mode: 'pessimistic_write' } });
      if (!camera) missing();
      const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        throw new Error('Unavailable clock');
      const generation = await manager
        .getRepository(CameraWorkerGenerationEntity)
        .createQueryBuilder('generation')
        .addSelect('generation.credentialSha256')
        .where(
          'generation.id=:id AND generation.cameraId=:cameraId AND generation.siteId=:siteId',
          { id: ack.workerGenerationId, cameraId, siteId: camera.siteId },
        )
        .getOne();
      if (!generation || !/^[a-f0-9]{64}$/.test(generation.credentialSha256)) unauthorized();
      if (
        !timingSafeEqual(
          createHash('sha256').update(secret).digest(),
          Buffer.from(generation.credentialSha256, 'hex'),
        )
      )
        unauthorized();
      if (
        !generation.isCurrent ||
        generation.revokedAt ||
        generation.supersededAt ||
        now < generation.issuedAt ||
        now >= generation.expiresAt ||
        ack.streamSessionId !== generation.streamSessionId
      )
        conflict('Worker generation is no longer current');
      if (camera.status !== CameraStatus.ACTIVE) conflict('Camera is inactive');
      const receipts = manager.getRepository(CameraConfigurationApplicationReceiptEntity);
      const payloadSha256 = computeCanonicalPayloadHash({ cameraId, ...ack });
      const previous = await receipts.findOneBy({ commandId: ack.commandId });
      const response = (
        receipt: CameraConfigurationApplicationReceiptEntity,
        replayed: boolean,
      ) => ({
        commandId: receipt.commandId,
        configurationVersion: Number(receipt.configurationVersion),
        outcome: receipt.outcome,
        receivedAt: receipt.receivedAt.toISOString(),
        replayed,
      });
      if (previous) {
        if (
          previous.cameraId !== cameraId ||
          previous.workerGenerationId !== generation.id ||
          previous.payloadSha256 !== payloadSha256
        )
          conflict('Acknowledgement command was reused');
        return response(previous, true);
      }
      const bundle = await manager.getRepository(CameraConfigurationBundleEntity).findOneBy({
        cameraId,
        siteId: camera.siteId,
        configurationVersion: String(ack.configurationVersion),
      });
      if (
        !bundle ||
        bundle.bundleSha256 !== ack.bundleSha256 ||
        Number(bundle.viewRevision) !== ack.viewRevision ||
        ack.configurationVersion > camera.configurationVersion
      )
        conflict('Acknowledgement does not match an issued bundle');
      const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
        cameraId,
        siteId: camera.siteId,
        revision: String(ack.viewRevision),
        isCurrent: true,
      });
      if (!view) conflict('Camera view requires revalidation');
      const latest = await receipts.findOne({
        where: { workerGenerationId: generation.id, cameraId },
        order: { configurationVersion: 'DESC', receiptOrder: 'DESC' },
      });
      if (latest && BigInt(latest.configurationVersion) > BigInt(ack.configurationVersion))
        conflict('Acknowledgement version regressed');
      const receipt = receipts.create({
        commandId: ack.commandId,
        cameraId,
        siteId: camera.siteId,
        workerGenerationId: generation.id,
        streamSessionId: ack.streamSessionId,
        configurationVersion: String(ack.configurationVersion),
        viewRevision: String(ack.viewRevision),
        bundleSha256: ack.bundleSha256,
        outcome: ack.outcome,
        reasonCode: ack.reasonCode ?? null,
        payloadSha256,
        receivedAt: now,
      });
      await receipts.insert(receipt);
      return response(receipt, false);
    });
  } catch (error) {
    if (error instanceof PublicHttpException) throw error;
    if ((error as { driverError?: { code?: string } })?.driverError?.code === '23505')
      conflict('Acknowledgement command was reused');
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Camera acknowledgement is unavailable',
    });
  }
}
