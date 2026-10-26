import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraWorkerGenerationEntity } from '../../database/entities/camera-worker-generation.entity.js';

function allowedCamera(cameraId: string, allowedCameraIds: readonly string[]): string {
  const normalized = uuid(cameraId).toLowerCase();
  if (!allowedCameraIds.some((id) => id.toLowerCase() === normalized)) missing();
  return normalized;
}

async function lockCamera(manager: EntityManager, cameraId: string): Promise<CameraEntity> {
  const camera = await manager.getRepository(CameraEntity).findOne({
    where: { id: cameraId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!camera) missing();
  return camera;
}

async function databaseTime(manager: EntityManager): Promise<Date> {
  // Transaction-start NOW can predate a lock wait and falsely extend an expired lease.
  const [{ now }] = await manager.query('SELECT clock_timestamp() AS now');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Worker generation time is unavailable',
    });
  return now;
}

/** Internal operator command; never expose through shared-token or business-user enrollment. */
export async function provisionCameraWorkerGeneration(
  source: DataSource,
  cameraId: string,
  allowedCameraIds: readonly string[],
  leaseMs: number,
) {
  cameraId = allowedCamera(cameraId, allowedCameraIds);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 86400000) invalid();
  return source.transaction(async (manager) => {
    const camera = await lockCamera(manager, cameraId);
    if (camera.status !== CameraStatus.ACTIVE) conflict('Camera is inactive');
    const now = await databaseTime(manager);
    const generations = manager.getRepository(CameraWorkerGenerationEntity);
    const secret = randomBytes(32).toString('base64url');
    const generation = generations.create({
      id: randomUUID(),
      cameraId,
      siteId: camera.siteId,
      streamSessionId: randomUUID(),
      credentialSha256: createHash('sha256').update(secret).digest('hex'),
      isCurrent: true,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + leaseMs),
      supersededAt: null,
      revokedAt: null,
    });
    await generations.update(
      { cameraId, isCurrent: true },
      { isCurrent: false, supersededAt: now },
    );
    await generations.insert(generation);
    return {
      workerGenerationId: generation.id,
      streamSessionId: generation.streamSessionId,
      secret,
      expiresAt: generation.expiresAt.toISOString(),
    };
  });
}

/** A repeated revocation preserves its original timestamp and never reactivates a generation. */
export async function revokeCameraWorkerGeneration(
  source: DataSource,
  cameraId: string,
  allowedCameraIds: readonly string[],
  generationId: string,
): Promise<void> {
  cameraId = allowedCamera(cameraId, allowedCameraIds);
  generationId = uuid(generationId).toLowerCase();
  await source.transaction(async (manager) => {
    const camera = await lockCamera(manager, cameraId);
    const generations = manager.getRepository(CameraWorkerGenerationEntity);
    const generation = await generations.findOneBy({
      id: generationId,
      cameraId,
      siteId: camera.siteId,
    });
    if (!generation) missing();
    if (generation.revokedAt) return;
    const now = await databaseTime(manager);
    await generations.update({ id: generationId }, { isCurrent: false, revokedAt: now });
  });
}
