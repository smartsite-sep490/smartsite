import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { CameraWorkerGenerationEntity } from '../../database/entities/camera-worker-generation.entity.js';
import { sealRetiredTrackedEpisodes } from '../safety/alerts/tracked-ppe-episode-projection.js';

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

export interface TrustedTrackedTransition {
  commandId: string;
  expectedGenerationId: string;
  reason:
    | 'CONFIGURATION_CHANGED'
    | 'VIEW_CHANGED'
    | 'PROFILE_CHANGED'
    | 'SOURCE_RESTART'
    | 'LEASE_RENEWED';
}

function transitionInput(input: TrustedTrackedTransition | undefined) {
  if (input === undefined) return undefined;
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 3 ||
    !Object.hasOwn(input, 'commandId') ||
    !Object.hasOwn(input, 'expectedGenerationId') ||
    !Object.hasOwn(input, 'reason')
  )
    invalid('Invalid tracked source transition');
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Object.values(fields).some((field) => !Object.hasOwn(field, 'value')))
    invalid('Invalid tracked source transition');
  const { commandId, expectedGenerationId, reason } = {
    commandId: fields.commandId!.value,
    expectedGenerationId: fields.expectedGenerationId!.value,
    reason: fields.reason!.value,
  };
  if (
    typeof reason !== 'string' ||
    ![
      'CONFIGURATION_CHANGED',
      'VIEW_CHANGED',
      'PROFILE_CHANGED',
      'SOURCE_RESTART',
      'LEASE_RENEWED',
    ].includes(reason)
  )
    invalid('Invalid tracked source transition');
  return {
    commandId: uuid(commandId).toLowerCase(),
    expectedGenerationId: uuid(expectedGenerationId).toLowerCase(),
    reason: reason as TrustedTrackedTransition['reason'],
  };
}

/** Camera lock is held. A server decision terminates continuity, never a business finding. */
async function transitionTrackedSource(
  manager: EntityManager,
  camera: CameraEntity,
  input: TrustedTrackedTransition,
  next: CameraWorkerGenerationEntity,
  now: Date,
) {
  const expected = await manager.query<
    Array<{ id: string; route: string | null; eligible: boolean }>
  >(
    `SELECT g.id,g.observation_route_mode AS route,
       (g.superseded_at IS NULL AND (g.is_current OR g.revoked_at IS NOT NULL)
        AND NOT EXISTS(SELECT 1 FROM camera_worker_generation c
          WHERE c.camera_id=g.camera_id AND c.site_id=g.site_id AND c.is_current AND c.id<>g.id)) AS eligible
     FROM camera_worker_generation g WHERE g.id=$3 AND g.camera_id=$1 AND g.site_id=$2 FOR UPDATE OF g`,
    [camera.id, camera.siteId, input.expectedGenerationId],
  );
  if (expected.length !== 1 || !expected[0]!.eligible || expected[0]!.route !== 'EPISODE_TRACKED')
    conflict('Tracked source generation changed');
  const provenance = {
    schemaVersion: '1.0.0',
    kind: 'TRUSTED_GENERATION_TRANSITION',
    commandId: input.commandId,
    fromCurrentGenerationId: input.expectedGenerationId,
    supersedingGenerationId: next.id,
    supersedingStreamSessionId: next.streamSessionId,
    reason: input.reason,
    decidedAt: now.toISOString(),
  };
  // Classify all unfinished old scopes, including parts without a coordinator. Keep raw bytes,
  // original credentials/receipts, sealed results, source watermarks and business cases intact.
  await manager.query(
    `UPDATE ai_observation_event p SET tracking_frame_state=CASE
       WHEN p.tracking_frame_state='PART_STAGED' THEN 'PART_EXPIRED' ELSE 'REVIEW_ONLY' END,
       tracking_frame_result=CASE WHEN p.tracking_part_index=0 THEN
         jsonb_build_object('reason','TRUSTED_SOURCE_TRANSITION',
           'terminalizedAt',$3::text,'transition',$4::jsonb) ELSE NULL END
     WHERE p.resolved_camera_id=$1 AND p.tracking_site_id=$2
       AND p.tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
       AND NOT EXISTS (SELECT 1 FROM ai_observation_event c
         WHERE c.resolved_camera_id=p.resolved_camera_id
           AND c.tracking_generation_id=p.tracking_generation_id
           AND c.stream_session_id=p.stream_session_id AND c.tracking_frame_id=p.tracking_frame_id
           AND c.tracking_part_index=0 AND c.tracking_frame_state IN ('SEALED','REVIEW_ONLY'))`,
    [camera.id, camera.siteId, now.toISOString(), JSON.stringify(provenance)],
  );
  const retired = await manager.query<Array<{ segment_id: string }>>(
    `WITH retired AS (UPDATE ai_subject_segment SET state='RETIRED',retired_at=$3,
       retirement_reason='SOURCE_TRANSITION',retirement_event_id=NULL,
       retirement_provenance=$4::jsonb || jsonb_build_object('terminatedGenerationId',generation_id)
     WHERE camera_id=$1 AND site_id=$2 AND state='ACTIVE' RETURNING segment_id)
     SELECT segment_id FROM retired ORDER BY segment_id`,
    [camera.id, camera.siteId, now, JSON.stringify(provenance)],
  );
  await sealRetiredTrackedEpisodes(
    manager,
    camera.siteId,
    camera.id,
    retired.map((row) => row.segment_id),
  );
  await manager
    .getRepository(CameraWorkerGenerationEntity)
    .update(
      { id: input.expectedGenerationId, cameraId: camera.id, siteId: camera.siteId },
      { isCurrent: false, supersededAt: now },
    );
}

async function requireOrdinaryIssuance(manager: EntityManager, camera: CameraEntity) {
  // Legacy profiles do not install tracked storage. Do not query optional columns there.
  const [storage] = await manager.query<Array<{ installed: boolean }>>(
    "SELECT to_regclass(format('%I.ai_subject_segment',current_schema())) IS NOT NULL AS installed",
  );
  if (!storage)
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Tracked source state is unavailable',
    });
  if (!storage.installed) return;
  const [state] = await manager.query<Array<{ fenced: boolean }>>(
    `SELECT EXISTS(SELECT 1 FROM camera_worker_generation WHERE camera_id=$1 AND site_id=$2
        AND observation_route_mode='EPISODE_TRACKED' AND superseded_at IS NULL)
      OR EXISTS(SELECT 1 FROM ai_subject_segment WHERE camera_id=$1 AND site_id=$2 AND state='ACTIVE')
      OR EXISTS(SELECT 1 FROM ai_observation_event p WHERE resolved_camera_id=$1 AND tracking_site_id=$2
        AND tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
        AND NOT EXISTS(SELECT 1 FROM ai_observation_event c
          WHERE c.resolved_camera_id=p.resolved_camera_id AND c.tracking_generation_id=p.tracking_generation_id
            AND c.stream_session_id=p.stream_session_id AND c.tracking_frame_id=p.tracking_frame_id
            AND c.tracking_part_index=0 AND c.tracking_frame_state IN ('SEALED','REVIEW_ONLY'))) AS fenced`,
    [camera.id, camera.siteId],
  );
  if (!state)
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Tracked source state is unavailable',
    });
  if (state.fenced) conflict('Tracked source transition is required');
}

/** Internal operator command; never expose through shared-token or business-user enrollment. */
export async function provisionCameraWorkerGeneration(
  source: DataSource,
  cameraId: string,
  allowedCameraIds: readonly string[],
  leaseMs: number,
  deliver?: (
    credential: Readonly<{
      workerGenerationId: string;
      streamSessionId: string;
      secret: string;
      expiresAt: string;
    }>,
  ) => Promise<void>,
  requestedTransition?: TrustedTrackedTransition,
  expectedCurrentGenerationId?: string,
) {
  const transition = transitionInput(requestedTransition);
  const expectedCurrent =
    expectedCurrentGenerationId === undefined
      ? undefined
      : uuid(expectedCurrentGenerationId).toLowerCase();
  if (transition && expectedCurrent && transition.expectedGenerationId !== expectedCurrent)
    invalid('Generation owner conditions disagree');
  cameraId = allowedCamera(cameraId, allowedCameraIds);
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 86400000) invalid();
  return source.transaction(async (manager) => {
    const camera = await lockCamera(manager, cameraId);
    if (camera.status !== CameraStatus.ACTIVE) conflict('Camera is inactive');
    if (expectedCurrent) {
      const current = await manager.getRepository(CameraWorkerGenerationEntity).findOne({
        where: { id: expectedCurrent, cameraId, siteId: camera.siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current?.isCurrent || current.revokedAt || current.supersededAt)
        conflict('Worker generation is no longer current');
    }
    if (!transition) await requireOrdinaryIssuance(manager, camera);
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
    if (transition) await transitionTrackedSource(manager, camera, transition, generation, now);
    await generations.update(
      { cameraId, isCurrent: true },
      { isCurrent: false, supersededAt: now },
    );
    await generations.insert(generation);
    const credential = {
      workerGenerationId: generation.id,
      streamSessionId: generation.streamSessionId,
      secret,
      expiresAt: generation.expiresAt.toISOString(),
    };
    // Bounded local delivery must finish before commit; failure preserves the previous generation.
    await deliver?.(credential);
    return credential;
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
