import { randomUUID } from 'node:crypto';
import { hashMf06RetrospectiveBinding } from './mf06-retrospective-context.js';
import { HttpStatus } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { readC02AcceptedSubject } from '../identification/c02-accepted-subject.js';
import { loadMf06RequestAdmission } from './mf06-event-admission.js';
import { selectMf06FrameReference } from './mf06-frame-reference.js';

export interface Mf06RetrospectiveInput {
  readonly siteId: string;
  readonly episodeId: string;
  readonly initialRequestId: string;
  readonly identificationRequestId: string;
  readonly identificationVersion: number;
  readonly commandId: string;
}

type Mf06RetrospectiveCase = Omit<Mf06RetrospectiveInput, 'commandId' | 'initialRequestId'>;

async function readEligibleSubject(
  manager: EntityManager,
  input: Mf06RetrospectiveCase & { initialRequestId: string },
) {
  const initial = await manager.getRepository(ZoneEntryAssessmentRequestEntity).findOneBy({
    requestId: input.initialRequestId,
    siteId: input.siteId,
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  });
  if (
    !initial ||
    initial.subjectBindingStatus !== 'BOUND' ||
    initial.personObservationIndex === null
  )
    return null;

  const event = await manager
    .getRepository(AiObservationEventEntity)
    .findOneBy({ eventId: initial.eventId });
  if (!event || !(await loadMf06RequestAdmission(manager, event, initial))) return null;
  if (event.admissionContext?.classification !== 'LIVE') return null;
  const frame = selectMf06FrameReference(event.rawPayload, {
    eventId: initial.eventId,
    streamSessionId: initial.streamSessionId,
    payloadHash: initial.payloadHash,
  });
  if (!frame) return null;

  const accepted = await readC02AcceptedSubject(manager, {
    siteId: input.siteId,
    episodeId: input.episodeId,
    requestId: input.identificationRequestId,
    version: input.identificationVersion,
    eventId: initial.eventId,
    personObservationIndex: initial.personObservationIndex,
    frameSha256: frame.sha256,
  });
  return accepted ? { initial, frame, accepted } : null;
}

export async function listMf06RetrospectiveOptions(
  manager: EntityManager,
  input: Mf06RetrospectiveCase,
) {
  const candidates = await manager.query<
    { initialRequestId: string; cameraName: string; zoneName: string; capturedAt: string }[]
  >(
    `SELECT q.request_id AS "initialRequestId", c.name AS "cameraName", z.name AS "zoneName",
       to_char(COALESCE(q.authority_captured_at,mf06_exact_authority_instant(e.raw_payload->>'capturedAt'))
         AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "capturedAt"
     FROM safety_identification_action publication
     JOIN safety_identification_action acceptance
       ON (acceptance.request_id,acceptance.site_id)=(publication.request_id,publication.site_id)
       AND acceptance.kind='ACCEPT' AND acceptance.request_version=$3
     CROSS JOIN LATERAL (
       SELECT DISTINCT source->>'sourceEventId' AS event_id,
                       source->>'personObservationIndex' AS person_index
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(publication.payload->'publishedEvidence')='array'
           THEN publication.payload->'publishedEvidence' ELSE '[]'::jsonb END
       ) source
     ) evidence
     JOIN zone_entry_assessment_request q
       ON q.event_id=CASE WHEN evidence.event_id ~
            '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN evidence.event_id::uuid END
       AND q.person_observation_index::text=evidence.person_index AND q.site_id=publication.site_id
       AND q.requested_purpose='INITIAL_OBSERVATION_ASSESSMENT' AND q.subject_binding_status='BOUND'
     JOIN ai_observation_event e ON e.event_id=q.event_id
     JOIN camera c ON (c.id,c.site_id)=(q.camera_id,q.site_id)
     JOIN zone z ON (z.id,z.site_id)=(q.zone_id,q.site_id)
     WHERE publication.site_id=$1 AND publication.request_id=$2 AND publication.kind='CREATE'
       AND NOT EXISTS (SELECT 1 FROM zone_entry_assessment_request scheduled
         WHERE scheduled.initial_request_id=q.request_id
           AND scheduled.c02_acceptance_id=acceptance.command_id)
     ORDER BY "capturedAt" DESC NULLS LAST,q.request_id`,
    [input.siteId, input.identificationRequestId, input.identificationVersion],
  );
  const options: typeof candidates = [];
  for (const candidate of candidates) {
    if (
      candidate.capturedAt &&
      (await readEligibleSubject(manager, {
        ...input,
        initialRequestId: candidate.initialRequestId,
      }))
    )
      options.push(candidate);
  }
  return options;
}

/** Invoked within the authenticated Officer transaction and shared MF06 queue capacity lock. */
export async function enqueueMf06Retrospective(
  manager: EntityManager,
  input: Mf06RetrospectiveInput,
): Promise<readonly string[]> {
  const eligible = await readEligibleSubject(manager, input);
  if (!eligible) return [];
  const { initial, frame, accepted } = eligible;

  const bindingHash = hashMf06RetrospectiveBinding(
    initial.bindingHash,
    input.episodeId,
    input.identificationVersion,
    frame.sha256,
    accepted,
  );

  const prior = await manager.query<{ request_id: string; binding_hash: string }[]>(
    `SELECT request_id,binding_hash FROM zone_entry_assessment_request
     WHERE retrospective_command_id=$1 OR (initial_request_id=$2 AND c02_acceptance_id=$3)
     ORDER BY (retrospective_command_id=$1) DESC LIMIT 1`,
    [input.commandId, initial.requestId, accepted.acceptanceId],
  );
  if (prior[0]) {
    if (prior[0].binding_hash !== bindingHash)
      throw new PublicHttpException(HttpStatus.CONFLICT, {
        code: 'CONFLICT',
        message: 'MF06 retrospective command already used',
      });
    return [prior[0].request_id];
  }

  const requestId = randomUUID();
  await manager.query(
    `INSERT INTO zone_entry_assessment_request (
       request_id,event_id,payload_hash,person_observation_index,zone_observation_index,
       subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,
       region_id,geometry_version,zone_id,captured_at,requested_purpose,request_revision,binding_hash,
       initial_request_id,c02_acceptance_id,retrospective_command_id)
     SELECT $1,event_id,payload_hash,person_observation_index,zone_observation_index,
       subject_binding_status,track_id,site_id,camera_id,camera_external_id,stream_session_id,
       region_id,geometry_version,zone_id,captured_at,'RETROSPECTIVE_REVIEW',
       (SELECT COALESCE(max(prev.request_revision),0)+1 FROM zone_entry_assessment_request prev
        WHERE prev.event_id=initial.event_id AND prev.person_observation_index=initial.person_observation_index
          AND prev.zone_observation_index=initial.zone_observation_index
          AND prev.requested_purpose='RETROSPECTIVE_REVIEW'),
       $2,request_id,$3,$4 FROM zone_entry_assessment_request initial WHERE initial.request_id=$5`,
    [requestId, bindingHash, accepted.acceptanceId, input.commandId, initial.requestId],
  );
  await manager.query(
    `INSERT INTO zone_entry_assessment_job
       (request_id,status,attempt_count,head_revision,next_attempt_at,deadline_at)
     VALUES($1,'PENDING',0,1,statement_timestamp(),statement_timestamp()+interval '300 seconds')`,
    [requestId],
  );
  return [requestId];
}
