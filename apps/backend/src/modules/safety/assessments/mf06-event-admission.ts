import {
  computeCanonicalPayloadHash,
  computeWorkerEventBindingHash,
  parseWorkerEventDeliveryContext,
} from '@smartsite/contracts';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { readConsistentMf06RawEvent } from './mf06-observation-event.js';
import { snapshotMf06Json } from './mf06-json-snapshot.js';
import type { EntityManager } from 'typeorm';
import { AiObservationEventEntity as RawEvent } from '../../../database/entities/ai-observation-event.entity.js';
import type { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../cameras/camera-configuration-bundle-reader.js';
import { CameraConfigurationApplicationReceiptEntity } from '../../../database/entities/camera-worker-generation.entity.js';
import { CameraViewRevisionEntity } from '../../../database/entities/camera-configuration-reference.entity.js';
import { selectZoneEntrySubject } from '../identity/observation-identity-subject.js';
import type { ZoneEntrySubjectSelection } from '../identity/observation-identity.types.js';

/** V1 subject hash stays byte-for-byte unchanged for legacy requests. */
export function computeMf06InitialBinding(
  eventId: string,
  selected: Extract<ZoneEntrySubjectSelection, { zoneEligible: true }>,
  admission: AiObservationEventEntity['admissionContext'] = null,
) {
  return computeCanonicalPayloadHash({
    algorithm: 'MF06_OBSERVATION_SUBJECT_BINDING_V1',
    eventId,
    zoneObservationIndex: selected.zoneObservationIndex,
    personObservationIndex: selected.personObservationIndex,
    subjectBindingStatus: selected.subjectBindingStatus,
    trackId: selected.trackId,
    regionId: selected.regionId,
    geometryVersion: selected.geometryVersion,
    ...(selected.subjectBindingStatus === 'BOUND' && selected.personBoundingBox
      ? { personBoundingBox: selected.personBoundingBox }
      : {}),
    ...(admission ? { executionAdmission: admission } : {}),
  });
}

/** Stored technical binding integrity only; callers must separately verify issued scope. */
export function snapshotMf06Admission(event: AiObservationEventEntity, input: unknown) {
  if (input === undefined || input === null) return null;
  try {
    const value = snapshotMf06Json(input) as NonNullable<
      AiObservationEventEntity['admissionContext']
    >;
    const context = parseWorkerEventDeliveryContext(value?.context);
    if (
      !value ||
      Object.keys(value).sort().join(',') !==
        'admittedAt,bindingHash,classification,context,schemaVersion' ||
      value.schemaVersion !== '1.0.0' ||
      !context ||
      (event.resolvedCameraId !== null && context.cameraId !== event.resolvedCameraId) ||
      context.streamSessionId !== event.streamSessionId ||
      !['LIVE', 'REVIEW_ONLY'].includes(value.classification) ||
      (value.classification === 'LIVE' && context.sourceKind !== 'LIVE') ||
      typeof value.admittedAt !== 'string' ||
      new Date(value.admittedAt).toISOString() !== value.admittedAt ||
      !readConsistentMf06RawEvent(event) ||
      computeWorkerEventBindingHash(event.payloadHash, context) !== value.bindingHash
    )
      throw new Error('Invalid admission');
    Object.freeze(value.context);
    return Object.freeze(value);
  } catch {
    throw new Error('MF06_INVALID_ADMISSION');
  }
}

/** Explicit projection works on both pre-admission and migrated schemas; omitted ORM fields are never legacy evidence. */
export async function loadMf06EventAdmission(
  manager: EntityManager,
  event: AiObservationEventEntity,
  siteId: string,
) {
  const row = await manager
    .getRepository(RawEvent)
    .createQueryBuilder('event')
    .select(`to_jsonb("event")->'admission_context'`, 'admission_context')
    .where('event.event_id=:eventId', { eventId: event.eventId })
    .getRawOne();
  if (!row || !Object.hasOwn(row, 'admission_context') || row.admission_context === undefined)
    return undefined;
  try {
    const admission = snapshotMf06Admission(event, row.admission_context);
    event.admissionContext = admission;
    if (!admission) return { admission: null, bundle: null };
    const context = admission.context;
    const receipt = await manager
      .getRepository(CameraConfigurationApplicationReceiptEntity)
      .findOneBy({
        commandId: context.receiptCommandId,
        cameraId: context.cameraId,
        siteId,
        workerGenerationId: context.workerGenerationId,
        streamSessionId: context.streamSessionId,
        configurationVersion: String(context.configurationVersion),
        viewRevision: String(context.viewRevision),
        bundleSha256: context.bundleSha256,
        outcome: 'LOADED',
      });
    if (!receipt) return undefined;
    const bundle = await readHistoricalIssuedCameraBundleInTransaction(manager, {
      ...context,
      siteId,
      cameraExternalId: event.cameraExternalId,
    });
    const view = await manager.getRepository(CameraViewRevisionEntity).findOneBy({
      cameraId: context.cameraId,
      siteId,
      revision: String(context.viewRevision),
    });
    if (!bundle || !view || view.sourceKind !== context.sourceKind) return undefined;
    return { admission, bundle };
  } catch (error) {
    // Invalid persisted input is unavailable. SQL/connection failures must reach the
    // caller's transaction handler rather than leave a failed transaction usable.
    if (error instanceof Error && error.message === 'MF06_INVALID_ADMISSION') return undefined;
    throw error;
  }
}

export async function loadMf06RequestAdmission(
  manager: EntityManager,
  event: AiObservationEventEntity,
  request: ZoneEntryAssessmentRequestEntity,
) {
  const loaded = await loadMf06EventAdmission(manager, event, request.siteId);
  if (!loaded) return false;
  if (request.requestedPurpose === 'INITIAL_OBSERVATION_ASSESSMENT') {
    const selected = selectZoneEntrySubject(event.rawPayload, request.zoneObservationIndex);
    if (
      !selected.zoneEligible ||
      computeMf06InitialBinding(event.eventId, selected, loaded.admission) !== request.bindingHash
    )
      return false;
  } else if (loaded.admission) {
    // Bound retrospective requests need their own explicit immutable pinning contract.
    return false;
  }
  if (!loaded.admission) return true;
  if (
    loaded.admission.classification === 'REVIEW_ONLY' &&
    request.requestedPurpose === 'INITIAL_OBSERVATION_ASSESSMENT'
  )
    return false;
  return (
    loaded.admission.context.cameraId === request.cameraId &&
    loaded.bundle!.regions.some(
      (region) =>
        region.regionId === request.regionId &&
        region.geometryVersion === request.geometryVersion &&
        region.zoneId === request.zoneId,
    )
  );
}
