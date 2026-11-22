import type { EntityManager } from 'typeorm';

export interface C02AcceptedSubjectScope {
  readonly siteId: string;
  readonly episodeId: string;
  readonly requestId: string;
  readonly version: number;
  readonly eventId: string;
  readonly personObservationIndex: number;
  readonly frameSha256: string;
}

type AcceptedSubject = Readonly<{
  acceptanceId: string;
  proposalId: string;
  workerId: string;
}>;

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Reads an audited identification conclusion for an exact frame subject. Callers authorize the operation. */
export async function readC02AcceptedSubject(
  manager: EntityManager,
  scope: C02AcceptedSubjectScope,
): Promise<AcceptedSubject | null> {
  const { siteId, episodeId, requestId, version, eventId, personObservationIndex, frameSha256 } =
    scope;
  const schema = manager.connection.driver.schema;
  if (
    !schema ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    /^(pg_|information_schema$)/.test(schema) ||
    ![siteId, episodeId, requestId, eventId].every((value) => uuid.test(value)) ||
    !Number.isSafeInteger(version) ||
    version < 3 ||
    version > 2147483647 ||
    !Number.isSafeInteger(personObservationIndex) ||
    personObservationIndex < 0 ||
    !/^[a-f0-9]{64}$/.test(frameSha256)
  )
    return null;

  const rows = await manager.query<AcceptedSubject[]>(
    `SELECT accepted.command_id AS "acceptanceId", proposal.command_id AS "proposalId",
            proposal.result->'result'->>'workerId' AS "workerId"
       FROM "${schema}".safety_identification_request r
       JOIN "${schema}".safety_identification_action accepted
         ON (accepted.request_id,accepted.site_id,accepted.request_version)=(r.id,r.site_id,r.version)
       JOIN "${schema}".safety_identification_action proposal
         ON (proposal.command_id,proposal.request_id,proposal.site_id)=(r.current_result_id,r.id,r.site_id)
       JOIN "${schema}".safety_identification_action publication
         ON (publication.request_id,publication.site_id,publication.request_version)=(r.id,r.site_id,1)
       WHERE r.id=$1 AND r.site_id=$2 AND r.episode_id=$3 AND r.version=$4 AND r.status='CLOSED'
         AND accepted.kind='ACCEPT' AND proposal.kind='RESPOND'
         AND accepted.result->'result'=proposal.result->'result'
         AND proposal.result->'result'->>'outcome'='IDENTIFIED'
         AND publication.kind='CREATE' AND publication.actor_user_id=r.requested_by
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(publication.payload->'publishedEvidence')='array'
               THEN publication.payload->'publishedEvidence' ELSE '[]'::jsonb END
           ) evidence
           WHERE evidence->>'sourceEventId'=$5 AND evidence->>'personObservationIndex'=$6
             AND evidence->>'sourceSha256'=$7
         )
       LIMIT 2`,
    [requestId, siteId, episodeId, version, eventId, String(personObservationIndex), frameSha256],
  );
  const [binding] = rows;
  return rows.length === 1 && binding && uuid.test(binding.workerId)
    ? Object.freeze(binding)
    : null;
}
