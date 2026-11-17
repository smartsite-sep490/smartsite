import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { readC02AcceptedSubject } from '../identification/c02-accepted-subject.js';
import { loadMf06RequestAdmission } from './mf06-event-admission.js';
import { selectMf06FrameReference } from './mf06-frame-reference.js';

type Accepted = NonNullable<Awaited<ReturnType<typeof readC02AcceptedSubject>>>;

export function hashMf06RetrospectiveBinding(
  initialBindingHash: string,
  episodeId: string,
  version: number,
  frameSha256: string,
  accepted: Accepted,
) {
  return computeCanonicalPayloadHash({
    algorithm: 'MF06_RETROSPECTIVE_C02_V1',
    initialBindingHash,
    episodeId,
    version,
    frameSha256,
    ...accepted,
  });
}

export async function readMf06RetrospectiveContext(
  manager: EntityManager,
  request: ZoneEntryAssessmentRequestEntity,
  event: AiObservationEventEntity,
): Promise<Accepted | null> {
  const schema = manager.connection.driver.schema;
  if (!schema || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || request.personObservationIndex === null)
    return null;
  const [links] = await manager.query<{ initialId: string | null; acceptanceId: string | null }[]>(
    `SELECT to_jsonb(r)->>'initial_request_id' AS "initialId",
            to_jsonb(r)->>'c02_acceptance_id' AS "acceptanceId"
       FROM "${schema}".zone_entry_assessment_request r WHERE request_id=$1 AND site_id=$2`,
    [request.requestId, request.siteId],
  );
  if (!links?.initialId || !links.acceptanceId) return null;
  const initial = await manager.getRepository(ZoneEntryAssessmentRequestEntity).findOneBy({
    requestId: links.initialId,
    siteId: request.siteId,
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  });
  if (
    !initial ||
    initial.eventId !== request.eventId ||
    initial.payloadHash !== request.payloadHash ||
    initial.personObservationIndex !== request.personObservationIndex ||
    initial.zoneObservationIndex !== request.zoneObservationIndex ||
    !(await loadMf06RequestAdmission(manager, event, initial)) ||
    event.admissionContext?.classification !== 'LIVE'
  )
    return null;

  const frame = selectMf06FrameReference(event.rawPayload, {
    eventId: request.eventId,
    streamSessionId: request.streamSessionId,
    payloadHash: request.payloadHash,
  });
  if (!frame) return null;
  const [action] = await manager.query<{ requestId: string; episodeId: string; version: number }[]>(
    `SELECT a.request_id AS "requestId", r.episode_id AS "episodeId", a.request_version AS version
       FROM "${schema}".safety_identification_action a
       JOIN "${schema}".safety_identification_request r ON (r.id,r.site_id)=(a.request_id,a.site_id)
       WHERE a.command_id=$1 AND a.site_id=$2 AND a.kind='ACCEPT'`,
    [links.acceptanceId, request.siteId],
  );
  if (!action) return null;
  const accepted = await readC02AcceptedSubject(manager, {
    ...action,
    siteId: request.siteId,
    eventId: request.eventId,
    personObservationIndex: request.personObservationIndex,
    frameSha256: frame.sha256,
  });
  if (!accepted || accepted.acceptanceId !== links.acceptanceId) return null;
  return hashMf06RetrospectiveBinding(
    initial.bindingHash,
    action.episodeId,
    action.version,
    frame.sha256,
    accepted,
  ) === request.bindingHash
    ? accepted
    : null;
}
