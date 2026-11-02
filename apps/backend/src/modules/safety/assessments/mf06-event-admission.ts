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
import { inspectTrackedFrameParts } from '../../../integrations/ai/tracked-frame-parts.js';

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
    const raw = readConsistentMf06RawEvent(event);
    if (!raw) return undefined;
    const admission = snapshotMf06Admission(event, row.admission_context);
    event.admissionContext = admission;
    if (
      raw.schemaVersion === '1.5.0' &&
      (!admission || !(await isSealedTrackedOriginal(manager, event, siteId)))
    )
      return undefined;
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
    if (raw.schemaVersion === '1.5.0') {
      const dimensions = raw.frameDimensions as { width: number; height: number };
      if (view.width !== dimensions.width || view.height !== dimensions.height) return undefined;
    }
    return { admission, bundle };
  } catch (error) {
    // Invalid persisted input is unavailable. SQL/connection failures must reach the
    // caller's transaction handler rather than leave a failed transaction usable.
    if (error instanceof Error && error.message === 'MF06_INVALID_ADMISSION') return undefined;
    throw error;
  }
}

/** Read-only historical qualification, not permission or a receipt authorizing new enqueue. */
async function isSealedTrackedOriginal(
  manager: EntityManager,
  original: AiObservationEventEntity,
  siteId: string,
): Promise<boolean> {
  if (!manager.queryRunner?.isTransactionActive || manager.queryRunner.isReleased) return false;
  type Row = AiObservationEventEntity & {
    siteId: string;
    generationId: string;
    frameId: string;
    sequence: string;
    partIndex: number;
    partCount: number;
    state: string;
    scope: string;
    routeMode: string;
    routeEpoch: string;
    result: { kind?: string; scopeSha256?: string; sequenceNumber?: string } | null;
    hasReceipt: boolean;
  };
  const rows = await manager.query<Row[]>(
    `SELECT p.event_id AS "eventId",p.payload_hash AS "payloadHash",p.raw_payload AS "rawPayload",
      p.captured_at AS "capturedAt",p.camera_external_id AS "cameraExternalId",
      p.resolved_camera_id AS "resolvedCameraId",p.stream_session_id AS "streamSessionId",
      p.admission_context AS "admissionContext",p.tracking_site_id AS "siteId",
      p.tracking_generation_id AS "generationId",p.tracking_frame_id AS "frameId",
      p.tracking_source_sequence::text AS sequence,p.tracking_part_index AS "partIndex",
      p.tracking_part_count AS "partCount",p.tracking_frame_state AS state,
      p.tracking_scope_sha256 AS scope,p.safety_route_mode AS "routeMode",p.safety_route_epoch AS "routeEpoch",
      p.tracking_frame_result AS result,(r.command_id IS NOT NULL) AS "hasReceipt"
    FROM ai_observation_event original JOIN ai_observation_event p
      ON p.resolved_camera_id=original.resolved_camera_id
      AND p.tracking_generation_id=original.tracking_generation_id
      AND p.stream_session_id=original.stream_session_id AND p.tracking_frame_id=original.tracking_frame_id
    LEFT JOIN camera_configuration_application_receipt r
      ON r.command_id::text=p.admission_context->'context'->>'receiptCommandId'
      AND r.camera_id=p.resolved_camera_id AND r.site_id=p.tracking_site_id
      AND r.worker_generation_id=p.tracking_generation_id AND r.stream_session_id=p.stream_session_id
      AND r.configuration_version::text=p.admission_context->'context'->>'configurationVersion'
      AND r.view_revision::text=p.admission_context->'context'->>'viewRevision'
      AND r.bundle_sha256=p.admission_context->'context'->>'bundleSha256' AND r.outcome='LOADED'
    WHERE original.event_id=$1 ORDER BY p.tracking_part_index LIMIT 1025`,
    [original.eventId],
  );
  if (!rows.length || rows.length > 1024) return false;
  const coordinator = rows[0]!;
  const saved = rows.find((part) => part.eventId === original.eventId);
  if (
    !saved ||
    saved.payloadHash !== original.payloadHash ||
    coordinator.partIndex !== 0 ||
    coordinator.state !== 'SEALED' ||
    coordinator.partCount !== rows.length ||
    coordinator.result?.kind !== 'ADMITTED_TRACKED_FRAME' ||
    coordinator.result.scopeSha256 !== coordinator.scope ||
    coordinator.result.sequenceNumber !== coordinator.sequence ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(coordinator.routeEpoch)
  )
    return false;
  for (const [index, part] of rows.entries()) {
    const raw = readConsistentMf06RawEvent(part);
    const admission = snapshotMf06Admission(part, part.admissionContext);
    if (!raw || !admission) return false;
    const context = admission.context;
    const partition = raw.framePartition as {
      frameId: string;
      sequenceNumber: string;
      partIndex: number;
      partCount: number;
    };
    const continuity = raw.continuity as { profileSha256: string };
    if (
      raw.schemaVersion !== '1.5.0' ||
      part.partIndex !== index ||
      !part.hasReceipt ||
      admission.classification !== 'LIVE' ||
      context.sourceKind !== 'LIVE' ||
      part.siteId !== siteId ||
      part.routeMode !== 'EPISODE_TRACKED' ||
      part.routeEpoch !== coordinator.routeEpoch ||
      part.scope !== coordinator.scope ||
      part.resolvedCameraId !== context.cameraId ||
      context.cameraId !== original.resolvedCameraId ||
      part.generationId !== context.workerGenerationId ||
      part.generationId !== coordinator.generationId ||
      part.frameId !== coordinator.frameId ||
      part.sequence !== coordinator.sequence ||
      part.partCount !== rows.length ||
      (index === 0 ? part.state !== 'SEALED' : part.state !== 'PART_STAGED') ||
      partition.frameId !== part.frameId ||
      partition.sequenceNumber !== part.sequence ||
      partition.partIndex !== part.partIndex ||
      partition.partCount !== part.partCount ||
      computeCanonicalPayloadHash({
        siteId: siteId.toLowerCase(),
        cameraId: context.cameraId.toLowerCase(),
        workerGenerationId: context.workerGenerationId.toLowerCase(),
        streamSessionId: context.streamSessionId.toLowerCase(),
        configurationVersion: context.configurationVersion,
        viewRevision: context.viewRevision,
        bundleSha256: context.bundleSha256,
        profileSha256: continuity.profileSha256,
        sourceKind: context.sourceKind,
      }) !== part.scope
    )
      return false;
  }
  try {
    return (
      inspectTrackedFrameParts(
        rows.map((part) => ({
          eventId: part.eventId,
          payloadHash: part.payloadHash,
          rawPayload: part.rawPayload,
          scopeSha256: part.scope,
        })),
      ).kind === 'COMPLETE'
    );
  } catch {
    return false;
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
