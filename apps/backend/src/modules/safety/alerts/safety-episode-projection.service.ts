import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { resolveEventLocalEpisodeSubject } from '@smartsite/contracts';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { reviewEventIsConsistent } from '../identity/observation-identity-event.js';
import type { AlertCandidate } from './alert-candidate-evaluator.js';
import type { DurableGroupingService } from './durable-grouping.service.js';
import { EventProcessingStatus } from '../../../database/entities/enums.js';

interface ProjectionInput {
  siteId: string;
  eventId: string;
  personObservationIndex: number;
  alertIds: readonly string[];
}
export interface SafetyEpisodeProjection {
  episodeId: string;
  contentRevision: number;
  findingCount: number;
  materialChange: boolean;
  /** EVENT_LOCAL projection alone must never activate a notification per frame. */
  deliveryAdmitted: false;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unavailable(): never {
  throw new Error('SAFETY_EPISODE_PROJECTION_UNAVAILABLE');
}

/**
 * Internal ingestion projection, not an HTTP authorization boundary.
 * Caller owns the transaction and must roll it back in full on any failure. The
 * producer reserves all episodes by original PERSON index before grouping findings.
 * Legacy attach-only callers retain their existing grouping-before-projection order.
 * No legacy key, review decision, notification or recipient state is changed here.
 */
@Injectable()
export class SafetyEpisodeProjectionService {
  constructor(private readonly db: DataSource) {}

  /** Complete this batch inside the ingestion owner's transaction; never chooses a delivery route. */
  async produceObservationFindings(
    manager: EntityManager,
    input: { siteId: string; eventId: string; candidates: readonly AlertCandidate[] },
    grouping: DurableGroupingService,
  ): Promise<{ alertIds: string[]; episodes: SafetyEpisodeProjection[] }> {
    if (
      manager?.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased ||
      !input ||
      !UUID.test(input.siteId) ||
      !UUID.test(input.eventId) ||
      !Array.isArray(input.candidates) ||
      input.candidates.length < 1 ||
      input.candidates.length > 256
    )
      unavailable();
    const siteId = input.siteId.toLowerCase(),
      eventId = input.eventId.toLowerCase();
    const event = await manager.getRepository(AiObservationEventEntity).findOne({
      where: { eventId },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      !event ||
      event.processingStatus !== EventProcessingStatus.PROCESSED ||
      !reviewEventIsConsistent(event)
    )
      return unavailable();
    const schema = this.db.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      unavailable();
    const scope = '"' + schema.replaceAll('"', '""') + '"';
    const [legacy]: { present: boolean }[] = await manager.query(
      `SELECT EXISTS(SELECT 1 FROM ${scope}.alert_detection_mapping m JOIN ${scope}.safety_alert a ON a.id=m.alert_id
       WHERE m.event_id=$1 AND a.episode_id IS NULL) AS present`,
      [eventId],
    );
    if (!legacy || legacy.present) unavailable();
    const raw = event.rawPayload as { observations: { type: string; trackId: number }[] };
    const batches = new Map<number, AlertCandidate[]>();
    for (const candidate of input.candidates) {
      if (!candidate || candidate.alertType !== 'PPE_VIOLATION') unavailable();
      const index = raw.observations.findIndex(
        (o) => o.type === 'PERSON' && o.trackId === candidate.trackId,
      );
      const subject = resolveEventLocalEpisodeSubject(eventId, raw.observations, index);
      if (!subject || subject.personObservationIndex > 255) unavailable();
      const batch = batches.get(index) ?? [];
      batch.push(candidate);
      batches.set(index, batch);
    }
    // Every batch for one immutable event acquires episode locks in original PERSON order.
    const ordered = [...batches].sort(([a], [b]) => a - b);
    const reserved = new Map<number, SafetyEpisodeProjection>();
    for (const [personObservationIndex] of ordered)
      reserved.set(
        personObservationIndex,
        await this.reserveObservation(manager, { siteId, eventId, personObservationIndex }),
      );
    const episodes: SafetyEpisodeProjection[] = [],
      alertIds: string[] = [];
    for (const [personObservationIndex, batch] of ordered) {
      batch.sort((a, b) =>
        `${a.candidateSubtype}:${a.zoneId ?? ''}`.localeCompare(
          `${b.candidateSubtype}:${b.zoneId ?? ''}`,
        ),
      );
      const ids = new Set<string>();
      for (const candidate of batch) {
        const alert = await grouping.groupEpisodeCandidate(
          manager,
          siteId,
          candidate,
          event.capturedAt,
          reserved.get(personObservationIndex)!.episodeId,
        );
        ids.add(alert.id);
      }
      for (const alertId of ids)
        await manager.query(
          `INSERT INTO ${scope}.alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,$3)
         ON CONFLICT (alert_id,event_id) DO NOTHING`,
          [alertId, eventId, personObservationIndex],
        );
      const attached = await this.attachObservation(manager, {
        siteId,
        eventId,
        personObservationIndex,
        alertIds: [...ids],
      });
      // Finding linkage is reserved during grouping; advance once for this material batch.
      if (attached.findingCount > reserved.get(personObservationIndex)!.findingCount) {
        const updated: { content_revision: number }[] = await manager.query(
          `WITH updated AS (UPDATE ${scope}.safety_episode SET content_revision=content_revision+1
           WHERE id=$1 AND site_id=$2 AND content_revision<2147483647 RETURNING content_revision)
           SELECT content_revision FROM updated`,
          [attached.episodeId, siteId],
        );
        if (updated.length !== 1) unavailable();
        episodes.push({
          ...attached,
          contentRevision: updated[0]!.content_revision,
          materialChange: true,
        });
      } else episodes.push(attached);
      alertIds.push(...ids);
    }
    return { alertIds, episodes };
  }

  async attachObservation(
    manager: EntityManager,
    input: ProjectionInput,
  ): Promise<SafetyEpisodeProjection> {
    return this.project(manager, input, false);
  }

  /**
   * Resolve the immutable event-local identity before deriving a finding key.
   * The ingestion owner must create/attach findings in this same transaction or
   * roll it back. This does not admit continuity, recipients or delivery.
   */
  async reserveObservation(
    manager: EntityManager,
    input: Omit<ProjectionInput, 'alertIds'>,
  ): Promise<SafetyEpisodeProjection> {
    if (!input || Object.hasOwn(input, 'alertIds')) unavailable();
    return this.project(manager, { ...input, alertIds: [] }, true);
  }

  private async project(
    manager: EntityManager,
    input: ProjectionInput,
    reservation: boolean,
  ): Promise<SafetyEpisodeProjection> {
    if (
      manager?.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased
    )
      unavailable();
    if (
      !input ||
      !UUID.test(input.siteId) ||
      !UUID.test(input.eventId) ||
      !Number.isSafeInteger(input.personObservationIndex) ||
      input.personObservationIndex < 0 ||
      input.personObservationIndex > 255 ||
      !Array.isArray(input.alertIds) ||
      input.alertIds.length < (reservation ? 0 : 1) ||
      input.alertIds.length > 256 ||
      !input.alertIds.every((id) => typeof id === 'string' && UUID.test(id))
    )
      unavailable();
    const siteId = input.siteId.toLowerCase(),
      eventId = input.eventId.toLowerCase();
    const personIndex = input.personObservationIndex;
    const alertIds = [...new Set(input.alertIds.map((id) => id.toLowerCase()))].sort();
    const schema = this.db.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      unavailable();
    const scope = '"' + schema.replaceAll('"', '""') + '"';
    const event = await manager.getRepository(AiObservationEventEntity).findOne({
      where: { eventId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!event || !reviewEventIsConsistent(event)) unavailable();
    const [camera] = await manager.query(
      `SELECT id FROM ${scope}.camera WHERE id=$1 AND site_id=$2 FOR SHARE`,
      [event.resolvedCameraId, siteId],
    );
    if (!camera) unavailable();
    const raw = event.rawPayload as { observations: { type: string; trackId: number }[] };
    const subject = resolveEventLocalEpisodeSubject(eventId, raw.observations, personIndex);
    if (!subject) unavailable();
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
      `safety-episode:${siteId}`,
      `${eventId}:${personIndex}`,
    ]);
    const existing: {
      id: string;
      site_id: string;
      camera_id: string;
      payload_hash: string;
      content_revision: number;
      collection_state: string;
    }[] = await manager.query(
      `SELECT id,site_id,camera_id,payload_hash,content_revision,collection_state FROM ${scope}.safety_episode
        WHERE event_id=$1 AND person_observation_index=$2 FOR UPDATE`,
      [eventId, personIndex],
    );
    const episode = existing[0];
    if (
      episode &&
      (episode.site_id !== siteId ||
        episode.camera_id !== event.resolvedCameraId ||
        episode.payload_hash !== event.payloadHash)
    )
      unavailable();
    const findings: {
      id: string;
      site_id: string;
      episode_id: string | null;
      person_observation_index: number | null;
    }[] = await manager.query(
      `SELECT a.id,a.site_id,a.episode_id,m.person_observation_index
        FROM ${scope}.safety_alert a JOIN ${scope}.alert_detection_mapping m ON m.alert_id=a.id
        WHERE m.event_id=$1 AND a.id=ANY($2::uuid[]) ORDER BY a.id FOR UPDATE OF a,m`,
      [eventId, alertIds],
    );
    if (
      findings.length !== alertIds.length ||
      findings.some(
        (finding) =>
          finding.site_id !== siteId ||
          finding.person_observation_index !== personIndex ||
          (finding.episode_id !== null && finding.episode_id !== episode?.id),
      )
    )
      unavailable();
    const added = findings
      .filter((finding) => finding.episode_id === null)
      .map((finding) => finding.id);
    if (episode?.collection_state === 'SEALED' && added.length) unavailable();
    if (episode && added.length && episode.content_revision === 2147483647) unavailable();
    const episodeId = episode?.id ?? randomUUID();
    if (!episode) {
      await manager.query(
        `INSERT INTO ${scope}.safety_episode
        (id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$7)`,
        [
          episodeId,
          siteId,
          event.resolvedCameraId,
          eventId,
          personIndex,
          event.payloadHash,
          event.capturedAt,
        ],
      );
    }
    if (added.length) {
      const linked: { id: string }[] = await manager.query(
        `WITH linked AS (UPDATE ${scope}.safety_alert SET episode_id=$1
        WHERE id=ANY($2::uuid[]) AND site_id=$3 AND episode_id IS NULL RETURNING id)
        SELECT id FROM linked`,
        [episodeId, added, siteId],
      );
      if (linked.length !== added.length) unavailable();
      if (episode)
        await manager.query(
          `UPDATE ${scope}.safety_episode SET content_revision=content_revision+1 WHERE id=$1`,
          [episodeId],
        );
    }
    const [result]: { content_revision: number; finding_count: number }[] = await manager.query(
      `SELECT e.content_revision,
      (SELECT count(*)::int FROM ${scope}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id) AS finding_count
      FROM ${scope}.safety_episode e WHERE e.id=$1`,
      [episodeId],
    );
    if (!result) unavailable();
    return Object.freeze({
      episodeId,
      contentRevision: result.content_revision,
      findingCount: result.finding_count,
      materialChange: !episode || added.length > 0,
      deliveryAdmitted: false as const,
    });
  }
}
