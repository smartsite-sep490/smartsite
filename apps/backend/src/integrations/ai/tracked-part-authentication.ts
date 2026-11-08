import {
  computeCanonicalPayloadHash,
  computeWorkerEventBindingHash,
  parseWorkerEventDeliveryContext,
  validateTrackedObservationEvent,
} from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { parseNormalizedCapturedAt } from '../../common/parse-normalized-captured-at.js';
import { CameraViewRevisionEntity } from '../../database/entities/camera-configuration-reference.entity.js';
import { CameraEventAdmissionService } from '../../modules/cameras/camera-event-admission.service.js';

/** Server-owned injection only. Synthetic test policy does not qualify a real producer/profile. */
export interface TrackedPartProfilePolicy {
  readonly routeEpoch: string;
  readonly profileSha256: string;
  readonly allowedCameraIds: readonly string[];
  readonly clockToleranceMs: number;
}
interface EventIdentity {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  frameDimensions: { width: number; height: number };
  continuity: { profileSha256: string };
}
function reject(status: 400 | 409 | 503): never {
  throw new PublicHttpException(status, {
    code:
      status === 400
        ? 'VALIDATION_FAILED'
        : status === 409
          ? 'CONFLICT'
          : 'AI_INGESTION_UNAVAILABLE',
    message: 'Tracked part admission is unavailable',
  });
}
function freezeJson(value: unknown): unknown {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Unregistered prototype. Authenticates one original part; does not store/seal a frame or deliver.
 * Both producer intake and stored recovery recheck the issued generation and receipt.
 */
export class TrackedPartAuthenticator {
  private readonly policy?: TrackedPartProfilePolicy;

  constructor(
    private readonly admission: CameraEventAdmissionService,
    policy?: TrackedPartProfilePolicy,
  ) {
    if (policy) {
      if (
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(policy.routeEpoch) ||
        !/^[a-f0-9]{64}$/.test(policy.profileSha256) ||
        !policy.allowedCameraIds.length ||
        !Number.isSafeInteger(policy.clockToleranceMs) ||
        policy.clockToleranceMs < 0
      )
        throw new Error('Invalid server tracking profile policy');
      this.policy = Object.freeze({
        ...policy,
        allowedCameraIds: Object.freeze([...policy.allowedCameraIds]),
      });
    }
  }

  async authenticate(
    manager: EntityManager,
    rawPayload: unknown,
    rawContext: unknown,
    secret: string,
  ) {
    return this.bind(manager, rawPayload, rawContext, { secret });
  }

  async recheckStored(
    manager: EntityManager,
    rawPayload: unknown,
    rawContext: unknown,
    storedEventId: string,
  ) {
    return this.bind(manager, rawPayload, rawContext, { storedEventId });
  }

  private async bind(
    manager: EntityManager,
    rawPayload: unknown,
    rawContext: unknown,
    authentication: { secret: string } | { storedEventId: string },
  ) {
    if (!manager.queryRunner?.isTransactionActive)
      throw new Error('Tracked authentication requires a transaction');
    if (!this.policy) reject(503);
    // Clone before any await: callers cannot swap the payload while the issued-state lookup runs.
    let payload: unknown;
    try {
      payload = structuredClone(rawPayload);
    } catch {
      reject(400);
    }
    const context = parseWorkerEventDeliveryContext(rawContext);
    if (!context || !validateTrackedObservationEvent(payload).isValid) reject(400);
    const event = payload as EventIdentity;
    if (event.streamSessionId.toLowerCase() !== context.streamSessionId.toLowerCase()) reject(400);
    if (event.continuity.profileSha256 !== this.policy.profileSha256) reject(503);
    const capturedAt = parseNormalizedCapturedAt(event.capturedAt);
    if (!capturedAt) reject(400);
    const payloadHash = computeCanonicalPayloadHash(payload);
    const eventId = event.eventId.toLowerCase();
    const bindingHash = computeWorkerEventBindingHash(payloadHash, context);
    const policy = this.policy;
    const cameraScope = [
      event.cameraExternalId,
      policy.allowedCameraIds,
      capturedAt,
      policy.clockToleranceMs,
    ] as const;
    if ('storedEventId' in authentication && authentication.storedEventId !== eventId) reject(503);
    const admission =
      'secret' in authentication
        ? await this.admission.admit(manager, context, authentication.secret, ...cameraScope)
        : await this.admission.recheckStoredTracked(
            manager,
            context,
            { eventId, payloadHash, bindingHash, routeEpoch: policy.routeEpoch },
            ...cameraScope,
          );
    const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
      cameraId: admission.camera.id,
      siteId: admission.camera.siteId,
      revision: String(context.viewRevision),
    });
    if (
      !view ||
      view.width !== event.frameDimensions.width ||
      view.height !== event.frameDimensions.height
    )
      reject(409);
    // Receipt is deliberately absent here, but remains authenticated above and in original binding.
    const scopeSha256 = computeCanonicalPayloadHash({
      siteId: admission.camera.siteId.toLowerCase(),
      cameraId: admission.camera.id.toLowerCase(),
      workerGenerationId: context.workerGenerationId.toLowerCase(),
      streamSessionId: context.streamSessionId.toLowerCase(),
      configurationVersion: context.configurationVersion,
      viewRevision: context.viewRevision,
      bundleSha256: context.bundleSha256,
      profileSha256: this.policy.profileSha256,
      sourceKind: context.sourceKind,
    });
    return Object.freeze({
      routeEpoch: this.policy.routeEpoch,
      eventId,
      payloadHash,
      payload: freezeJson(payload),
      context: Object.freeze(context),
      bindingHash,
      scopeSha256,
      siteId: admission.camera.siteId,
      cameraId: admission.camera.id,
      classification: admission.classification,
      admittedAt: admission.admittedAt,
    });
  }
}
