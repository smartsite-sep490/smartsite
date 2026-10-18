import type { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../../../database/entities/enums.js';
import { reviewRawEventIsConsistent } from '../identity/observation-identity-event.js';
import { selectZoneEntrySubject } from '../identity/observation-identity-subject.js';

/**
 * Private fresh-ingestion primitive for MF06 zone entry assessments.
 * Unregistered service; executed strictly within caller transaction following raw event insertion.
 */
export class Mf06EnqueueService {
  constructor(private readonly db: DataSource) {}

  async enqueueFresh(
    manager: EntityManager,
    event: AiObservationEventEntity,
  ): Promise<readonly string[]> {
    // 1. Transaction guard: manager must belong to same database with active non-released transaction
    if (
      !manager ||
      manager.connection !== this.db ||
      !manager.queryRunner ||
      !manager.queryRunner.isTransactionActive ||
      manager.queryRunner.isReleased
    ) {
      throw new Error('MF06_ACTIVE_TRANSACTION_REQUIRED');
    }

    // 2. Snapshot event identifiers before any async operations
    const eventId = event?.eventId;
    const payloadHash = event?.payloadHash;
    if (
      typeof eventId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId) ||
      typeof payloadHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(payloadHash)
    ) {
      return [];
    }

    // Validate the locked original source before either replay or fresh enqueue.
    // A retained request must not bypass an inconsistent caller hash.
    const storedEvent = await manager
      .getRepository(AiObservationEventEntity)
      .createQueryBuilder('event')
      .setLock('pessimistic_read')
      .where('event.event_id = :eventId', { eventId })
      .getOne();
    if (!storedEvent || storedEvent.payloadHash !== payloadHash) return [];
    try {
      if (!reviewRawEventIsConsistent(storedEvent)) return [];
    } catch {
      return [];
    }

    // 3. Replay existing INITIAL_OBSERVATION_ASSESSMENT/revision 1 requests before registry checks
    const existingRequests = await manager.query(
      `SELECT request_id
       FROM zone_entry_assessment_request
       WHERE event_id = $1
         AND requested_purpose = 'INITIAL_OBSERVATION_ASSESSMENT'
         AND request_revision = 1
       ORDER BY zone_observation_index ASC, request_id ASC`,
      [eventId],
    );

    if (Array.isArray(existingRequests) && existingRequests.length > 0) {
      return Object.freeze(existingRequests.map((row: { request_id: string }) => row.request_id));
    }

    // 4. Freshness guard via transaction xmin: caller transaction must have inserted the raw event
    // Old historical events commit in prior transactions must not be backfilled
    const xminRows = await manager.query(
      `SELECT (xmin::text::bigint) AS row_xmin,
              ((pg_current_xact_id()::text::bigint) % 4294967296) AS cur_xid
       FROM ai_observation_event
       WHERE event_id = $1
       FOR SHARE`,
      [eventId],
    );

    if (!Array.isArray(xminRows) || xminRows.length === 0) {
      return [];
    }

    const rowXmin = BigInt(xminRows[0].row_xmin);
    const curXid = BigInt(xminRows[0].cur_xid);
    if (rowXmin !== curXid) {
      return [];
    }

    // Must be eligible processing status (PROCESSED or SKIPPED_NO_CANDIDATE)
    if (
      storedEvent.processingStatus !== EventProcessingStatus.PROCESSED &&
      storedEvent.processingStatus !== EventProcessingStatus.SKIPPED_NO_CANDIDATE
    ) {
      return [];
    }

    // Resolved camera ID is required
    if (!storedEvent.resolvedCameraId) {
      return [];
    }

    // 6. Camera SHARE lock exact resolvedCameraId / externalId / ACTIVE
    const cameraRows = await manager.query(
      `SELECT id, site_id, external_id, status
       FROM camera
       WHERE id = $1
         AND external_id = $2
         AND status = 'ACTIVE'
       FOR SHARE`,
      [storedEvent.resolvedCameraId, storedEvent.cameraExternalId],
    );

    if (!Array.isArray(cameraRows) || cameraRows.length === 0) {
      return [];
    }
    const camera = cameraRows[0];

    // 7. Process observations independently
    const raw = storedEvent.rawPayload as { observations?: unknown[] };
    if (
      !raw ||
      typeof raw !== 'object' ||
      !Array.isArray(raw.observations) ||
      raw.observations.length > 256
    ) {
      return [];
    }

    const observations = raw.observations;
    const enqueuedRequestIds: string[] = [];

    for (
      let zoneObservationIndex = 0;
      zoneObservationIndex < observations.length;
      zoneObservationIndex++
    ) {
      const obs = observations[zoneObservationIndex] as Record<string, unknown> | undefined;
      if (!obs || typeof obs !== 'object' || obs['type'] !== 'ZONE_ENTRY') {
        continue;
      }

      const selected = selectZoneEntrySubject(storedEvent.rawPayload, zoneObservationIndex);
      if (!selected.zoneEligible) {
        continue;
      }

      // Region SHARE lock: exact active geometry, camera, version
      const regionRows = await manager.query(
        `SELECT id, camera_id, zone_id, version, is_active
         FROM camera_observation_region
         WHERE id = $1
           AND camera_id = $2
           AND version = $3
           AND is_active = true
         FOR SHARE`,
        [selected.regionId, camera.id, selected.geometryVersion],
      );

      if (!Array.isArray(regionRows) || regionRows.length === 0) {
        continue;
      }
      const region = regionRows[0];

      // Zone SHARE lock: exact zone ID and site ID
      const zoneRows = await manager.query(
        `SELECT id, site_id
         FROM zone
         WHERE id = $1
           AND site_id = $2
         FOR SHARE`,
        [region.zone_id, camera.site_id],
      );

      if (!Array.isArray(zoneRows) || zoneRows.length === 0) {
        continue;
      }
      const zone = zoneRows[0];

      // Compute canonical server subject binding hash
      const bindingHash = computeCanonicalPayloadHash({
        algorithm: 'MF06_OBSERVATION_SUBJECT_BINDING_V1',
        eventId: storedEvent.eventId,
        zoneObservationIndex,
        personObservationIndex: selected.personObservationIndex,
        subjectBindingStatus: selected.subjectBindingStatus,
        trackId: selected.trackId,
        regionId: selected.regionId,
        geometryVersion: selected.geometryVersion,
        ...(selected.subjectBindingStatus === 'BOUND' && selected.personBoundingBox
          ? { personBoundingBox: selected.personBoundingBox }
          : {}),
      });

      const candidateRequestId = randomUUID();
      const insertRequestSql = `
        INSERT INTO zone_entry_assessment_request (
          request_id,
          event_id,
          payload_hash,
          person_observation_index,
          zone_observation_index,
          subject_binding_status,
          track_id,
          site_id,
          camera_id,
          camera_external_id,
          stream_session_id,
          region_id,
          geometry_version,
          zone_id,
          captured_at,
          requested_purpose,
          request_revision,
          binding_hash
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT ON CONSTRAINT uq_mf06_request_binding DO NOTHING
        RETURNING request_id
      `;

      const insertRes = await manager.query(insertRequestSql, [
        candidateRequestId,
        storedEvent.eventId,
        storedEvent.payloadHash,
        selected.personObservationIndex,
        zoneObservationIndex,
        selected.subjectBindingStatus,
        selected.trackId,
        camera.site_id,
        camera.id,
        storedEvent.cameraExternalId,
        storedEvent.streamSessionId,
        selected.regionId,
        selected.geometryVersion,
        zone.id,
        storedEvent.capturedAt,
        'INITIAL_OBSERVATION_ASSESSMENT',
        1,
        bindingHash,
      ]);

      let finalRequestId: string;
      let newlyInserted = false;

      if (Array.isArray(insertRes) && insertRes.length > 0 && insertRes[0]?.request_id) {
        finalRequestId = insertRes[0].request_id;
        newlyInserted = true;
      } else {
        // Conflict on uq_mf06_request_binding: select existing request_id
        const selectRes = await manager.query(
          `SELECT request_id FROM zone_entry_assessment_request
           WHERE event_id = $1
             AND person_observation_index IS NOT DISTINCT FROM $2
             AND zone_observation_index = $3
             AND requested_purpose = $4
             AND request_revision = $5`,
          [
            storedEvent.eventId,
            selected.personObservationIndex,
            zoneObservationIndex,
            'INITIAL_OBSERVATION_ASSESSMENT',
            1,
          ],
        );

        if (!Array.isArray(selectRes) || selectRes.length === 0 || !selectRes[0]?.request_id) {
          throw new Error('MF06_REQUEST_CONFLICT_RESOLUTION_FAILED');
        }
        finalRequestId = selectRes[0].request_id;
      }

      // Atomically insert PENDING job for newly created request
      if (newlyInserted) {
        const insertJobSql = `
          INSERT INTO zone_entry_assessment_job (
            request_id,
            status,
            attempt_count,
            head_revision,
            lease_token,
            lease_expires_at,
            next_attempt_at,
            deadline_at,
            last_error_code,
            created_at,
            updated_at
          ) VALUES (
            $1,
            'PENDING',
            0,
            1,
            NULL,
            NULL,
            statement_timestamp(),
            statement_timestamp() + interval '300 seconds',
            NULL,
            statement_timestamp(),
            statement_timestamp()
          )
          ON CONFLICT (request_id) DO NOTHING
        `;
        await manager.query(insertJobSql, [finalRequestId]);
      }

      enqueuedRequestIds.push(finalRequestId);
    }

    return Object.freeze(enqueuedRequestIds);
  }
}
