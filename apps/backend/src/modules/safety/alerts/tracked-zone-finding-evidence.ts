import type { DataSource, EntityManager } from 'typeorm';
import type { HistoricalCameraBundle } from '../../cameras/camera-configuration-bundle-reader.js';
import { conflict } from '../../../common/configuration/commands.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { inspectMf06StoredBinding } from '../assessments/mf06-request-context.js';
import { loadMf06RequestAdmission } from '../assessments/mf06-event-admission.js';
import { Mf06AssessmentStore } from '../assessments/mf06-assessment-store.service.js';

export interface TrackedZoneFindingSource {
  siteId: string;
  cameraId: string;
  eventId: string;
  payloadHash: string;
  personIndex: number;
  zoneId: string | null;
  subtype: string;
  bundle: HistoricalCameraBundle;
}

export async function readTrackedZoneFindingIndexes(
  db: DataSource,
  manager: EntityManager,
  input: TrackedZoneFindingSource,
): Promise<number[]> {
  const unavailable = () =>
    conflict('Tracked Zone evidence does not match its recorded assessment');
  const reason =
    input.subtype === 'ZONE_ENTRY_PROHIBITED'
      ? 'POLICY_PROHIBITED'
      : input.subtype === 'ZONE_ENTRY_UNAUTHORIZED'
        ? 'UNAUTHORIZED'
        : null;
  if (
    !reason ||
    !input.zoneId ||
    manager.connection !== db ||
    !manager.queryRunner?.isTransactionActive ||
    manager.queryRunner.isReleased
  )
    unavailable();
  const rows = await manager.query<Array<{ requestId: string; assessmentId: string }>>(
    `SELECT q.request_id AS "requestId", a.assessment_id AS "assessmentId"
     FROM zone_entry_assessment_request q JOIN zone_entry_assessment a
       ON a.request_id=q.request_id AND a.site_id=q.site_id
       AND a.event_id=q.event_id AND a.binding_hash=q.binding_hash
     WHERE q.site_id=$1 AND q.camera_id=$2 AND q.event_id=$3
       AND q.payload_hash=$4 AND q.person_observation_index=$5 AND q.zone_id=$6
       AND q.requested_purpose='INITIAL_OBSERVATION_ASSESSMENT'
       AND a.outcome='DENIED' AND a.provenance='TRUSTED_SERVICE' AND a.reason_code=$7
     ORDER BY q.zone_observation_index LIMIT 257`,
    [
      input.siteId,
      input.cameraId,
      input.eventId,
      input.payloadHash,
      input.personIndex,
      input.zoneId,
      reason,
    ],
  );
  if (!rows.length || rows.length > 256) unavailable();
  const event = await manager
    .getRepository(AiObservationEventEntity)
    .findOneBy({ eventId: input.eventId });
  if (!event || event.payloadHash !== input.payloadHash) return unavailable();
  const indexes = new Set<number>();
  const store = new Mf06AssessmentStore(db);
  for (const row of rows) {
    const request = await manager
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneBy({ requestId: row.requestId });
    if (
      !request ||
      request.siteId !== input.siteId ||
      request.cameraId !== input.cameraId ||
      request.zoneId !== input.zoneId ||
      request.personObservationIndex !== input.personIndex ||
      request.requestedPurpose !== 'INITIAL_OBSERVATION_ASSESSMENT'
    )
      return unavailable();
    const inspected = inspectMf06StoredBinding(request, event);
    if (
      inspected.status !== 'MATCHED' ||
      !inspected.subject ||
      !input.bundle.regions.some(
        (region) =>
          region.regionId === request.regionId.toLowerCase() &&
          region.geometryVersion === request.geometryVersion &&
          region.zoneId === input.zoneId,
      ) ||
      !(await loadMf06RequestAdmission(manager, event, request))
    )
      return unavailable();
    // Read the original sealed authority artifact; never reevaluate today's permissions.
    const recorded = await store.readRecordedInTransaction(manager, input.siteId, row.assessmentId);
    if (
      !recorded ||
      recorded.requestId !== request.requestId ||
      recorded.eventId !== input.eventId ||
      recorded.cameraId !== input.cameraId ||
      recorded.zoneId !== input.zoneId ||
      recorded.bindingHash !== request.bindingHash ||
      recorded.outcome !== 'DENIED' ||
      recorded.provenance !== 'TRUSTED_SERVICE' ||
      recorded.reasonCode !== reason
    )
      return unavailable();
    indexes.add(request.zoneObservationIndex);
  }
  return [...indexes].sort((a, b) => a - b);
}
