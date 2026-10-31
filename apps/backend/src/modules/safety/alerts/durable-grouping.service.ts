import { randomUUID } from 'node:crypto';
import { loadMf06EventAdmission } from '../assessments/mf06-event-admission.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { type EntityManager } from 'typeorm';
import { AlertStatus, AlertType } from '../../../database/entities/enums.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import {
  AlertCandidateEvaluator,
  type AlertCandidate,
  type Observation,
} from './alert-candidate-evaluator.js';
import {
  ObservationContextResolverService,
  type ResolvedObservationContext,
} from '../../zones/observation-context-resolver.service.js';
import { SchedulingNotificationService } from '../../workforce/notifications/scheduling-notification.service.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { resolveEventLocalEpisodeSubject } from '@smartsite/contracts';
import { reviewEventIsConsistent } from '../identity/observation-identity-event.js';

export interface AdmittedObservationFrame {
  readonly cameraId: string;
  readonly streamSessionId: string;
  readonly frameId: string;
}

const OPEN_ALERT_STATUSES = [AlertStatus.PENDING_REVIEW, AlertStatus.CONFIRMED];

// Safe bounds compatible with both ECMAScript Date and PostgreSQL timestamptz (4-digit ISO years)
// Prevents JS Date overflow (Invalid Date) when ALERT_COOLDOWN_SECONDS is configured near MAX_SAFE_INTEGER.
const MIN_SAFE_DATE_MS = -62_135_596_800_000; // 0001-01-01T00:00:00.000Z
const MAX_SAFE_DATE_MS = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z

@Injectable()
export class DurableGroupingService {
  constructor(
    private readonly configService: ConfigService<BackendEnvironment, true>,
    private readonly notifications: SchedulingNotificationService,
  ) {}

  private getCooldownMs(): number {
    return this.configService.getOrThrow('ALERT_COOLDOWN_SECONDS', { infer: true }) * 1000;
  }

  /** Internal EVENT_LOCAL finding path; no continuity or notification admission. */
  async groupEpisodeCandidate(
    manager: EntityManager,
    siteId: string,
    candidate: AlertCandidate,
    capturedAt: Date,
    episodeId: string,
  ): Promise<SafetyAlertEntity> {
    const refuse = (): never => {
      throw new PublicHttpException(503, {
        code: 'AI_INGESTION_UNAVAILABLE',
        message: 'AI ingestion is temporarily unavailable',
      });
    };
    if (
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(episodeId) ||
      !Number.isFinite(capturedAt?.getTime()) ||
      candidate.alertType !== 'PPE_VIOLATION'
    )
      refuse();
    const schema = manager.connection.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      return refuse();
    const scope = '"' + schema.replaceAll('"', '""') + '"';
    const [episode]: {
      event_id: string;
      person_observation_index: number;
      payload_hash: string;
      camera_id: string;
      collection_state: string;
    }[] = await manager.query(
      `SELECT event_id,person_observation_index,payload_hash,camera_id,collection_state FROM ${scope}.safety_episode WHERE id=$1 AND site_id=$2 FOR UPDATE`,
      [episodeId, siteId],
    );
    if (!episode || episode.collection_state !== 'COLLECTING') return refuse();
    const event = await manager.getRepository(AiObservationEventEntity).findOne({
      where: { eventId: episode.event_id },
      lock: { mode: 'pessimistic_read' },
    });
    if (
      !event ||
      !reviewEventIsConsistent(event) ||
      event.payloadHash !== episode.payload_hash ||
      event.resolvedCameraId !== episode.camera_id ||
      candidate.cameraId !== episode.camera_id ||
      candidate.streamSessionId.toLowerCase() !== event.streamSessionId ||
      capturedAt.getTime() !== event.capturedAt.getTime()
    )
      return refuse();
    const raw = event.rawPayload as { observations: Observation[] };
    const subject = resolveEventLocalEpisodeSubject(
      event.eventId,
      raw.observations,
      episode.person_observation_index,
    );
    if (
      !subject ||
      raw.observations[episode.person_observation_index]?.trackId !== candidate.trackId
    )
      refuse();
    const issued = await loadMf06EventAdmission(manager, event, siteId);
    if (!issued) return refuse();
    const contexts = new Map<string, ResolvedObservationContext>();
    const resolver = new ObservationContextResolverService();
    const observations = raw.observations.filter((o) => o.type !== 'ZONE_ENTRY');
    for (const observation of observations) {
      if (
        observation.type !== 'PPE' ||
        observation.trackId !== candidate.trackId ||
        observation.status !== 'MISSING'
      )
        continue;
      const context = issued.bundle
        ? await resolver.resolveIssuedRegion(
            manager,
            siteId,
            issued.bundle,
            observation.regionId,
            observation.geometryVersion,
          )
        : await resolver.resolve(
            manager,
            event.cameraExternalId,
            observation.regionId,
            observation.geometryVersion,
            true,
          );
      if (context && context.siteId === siteId && context.cameraId === episode.camera_id)
        contexts.set(`${observation.regionId}:${observation.geometryVersion}`, context);
    }
    const matches = new AlertCandidateEvaluator()
      .evaluate(
        {
          streamSessionId: event.streamSessionId,
          cameraExternalId: event.cameraExternalId,
          observations,
        },
        contexts,
      )
      .filter(
        (c) =>
          c.trackId === candidate.trackId &&
          c.candidateSubtype === candidate.candidateSubtype &&
          c.zoneId === candidate.zoneId,
      );
    if (matches.length !== 1) return refuse();
    const canonical = matches[0]!;
    if (
      candidate.candidateWorkerId !== canonical.candidateWorkerId ||
      candidate.identitySimilarityScore !== canonical.identitySimilarityScore ||
      candidate.identityQualityScore !== canonical.identityQualityScore
    )
      return refuse();
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${siteId}:episode:${episodeId.toLowerCase()}:${canonical.groupingKey}`,
    ]);
    // Replays never create another finding after a human review closes the first.
    const existing = await manager.getRepository(SafetyAlertEntity).find({
      where: { siteId, groupingKey: canonical.groupingKey, episodeId: episodeId.toLowerCase() },
      lock: { mode: 'pessimistic_write' },
      take: 2,
    });
    if (existing.length > 1) refuse();
    if (existing[0]) return existing[0];
    const created = await this.createAlert(manager, siteId, canonical, capturedAt, false);
    // Bind before another grouping call; keep the historical key used by identity/workflow readers.
    await manager.query(
      `UPDATE ${scope}.safety_alert SET episode_id=$1 WHERE id=$2 AND site_id=$3`,
      [episodeId.toLowerCase(), created.id, siteId],
    );
    return created;
  }

  async groupCandidate(
    manager: EntityManager,
    siteId: string,
    candidate: AlertCandidate,
    capturedAt: Date,
    frame?: AdmittedObservationFrame,
  ): Promise<SafetyAlertEntity> {
    const lockKey = `${siteId}:${candidate.groupingKey}`;
    // 1. Transaction-scoped advisory lock serializes concurrent grouping calls for this site & groupingKey
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    if (frame) {
      if (
        !manager.queryRunner?.isTransactionActive ||
        frame.cameraId !== candidate.cameraId ||
        frame.streamSessionId !== candidate.streamSessionId.toLowerCase()
      ) {
        throw new PublicHttpException(503, {
          code: 'AI_INGESTION_UNAVAILABLE',
          message: 'AI ingestion is temporarily unavailable',
        });
      }
      const previous = await manager.query<Array<{ id: string }>>(
        `SELECT DISTINCT a.id FROM safety_alert a
         JOIN alert_detection_mapping m ON m.alert_id=a.id
         JOIN ai_observation_event e ON e.event_id=m.event_id
         WHERE a.site_id=$1 AND a.grouping_key=$2 AND a.episode_id IS NULL AND e.resolved_camera_id=$3
           AND e.stream_session_id=$4 AND e.raw_payload->>'schemaVersion'='1.4.0'
           AND e.raw_payload#>>'{framePartition,frameId}'=$5 LIMIT 2`,
        [siteId, candidate.groupingKey, frame.cameraId, frame.streamSessionId, frame.frameId],
      );
      if (previous.length > 1) {
        throw new PublicHttpException(503, {
          code: 'AI_INGESTION_UNAVAILABLE',
          message: 'AI ingestion is temporarily unavailable',
        });
      }
      if (previous[0]) {
        const existing = await manager
          .getRepository(SafetyAlertEntity)
          .findOneBy({ id: previous[0].id });
        if (!existing)
          throw new PublicHttpException(503, {
            code: 'AI_INGESTION_UNAVAILABLE',
            message: 'AI ingestion is temporarily unavailable',
          });
        // A delayed sibling adds its evidence, even if review closed the original alert.
        return existing;
      }
    }

    const cooldownMs = this.getCooldownMs();
    const capturedMs = capturedAt.getTime();

    // Clamp computed boundaries to safe date ranges to avoid Invalid Date on large cooldown configurations
    const minLastDetectedMs = Math.max(MIN_SAFE_DATE_MS, capturedMs - cooldownMs);
    const maxFirstDetectedMs = Math.min(MAX_SAFE_DATE_MS, capturedMs + cooldownMs);

    const minLastDetectedAt = new Date(minLastDetectedMs);
    const maxFirstDetectedAt = new Date(maxFirstDetectedMs);

    // 2. Query open alerts matching time-window eligibility directly in SQL before FOR UPDATE.
    // Filtering by time-window in SQL ensures PostgreSQL locks ONLY eligible rows within cooldown.
    // Explicit limit(1) emits LIMIT 1 with FOR UPDATE so PostgreSQL locks ONLY the top ordered eligible
    // row, preventing blocking on other still-eligible rows held by concurrent human transactions.
    // Preserves out-of-order semantics: firstDetectedAt <= capturedAt+cooldown AND lastDetectedAt >= capturedAt-cooldown.
    const matchingAlerts = await manager
      .createQueryBuilder(SafetyAlertEntity, 'alert')
      .setLock('pessimistic_write')
      .where('alert.siteId = :siteId', { siteId })
      .andWhere('alert.groupingKey = :groupingKey', { groupingKey: candidate.groupingKey })
      .andWhere('alert.episode_id IS NULL')
      .andWhere(
        "NOT EXISTS (SELECT 1 FROM incident i WHERE i.id=alert.incident_id AND i.status='CLOSED')",
      )
      .andWhere('alert.status IN (:...openStatuses)', { openStatuses: OPEN_ALERT_STATUSES })
      .andWhere('alert.firstDetectedAt <= :maxFirstDetectedAt', { maxFirstDetectedAt })
      .andWhere('alert.lastDetectedAt >= :minLastDetectedAt', { minLastDetectedAt })
      .orderBy('alert.lastDetectedAt', 'DESC')
      .addOrderBy('alert.createdAt', 'DESC')
      .limit(1)
      .getMany();

    const matchedAlert = matchingAlerts[0];

    if (matchedAlert) {
      const lastDetectedMs = matchedAlert.lastDetectedAt.getTime();
      const newLastDetectedAt =
        capturedMs > lastDetectedMs ? capturedAt : matchedAlert.lastDetectedAt;

      // 3. Narrow conditional update: mutate ONLY detection_count and last_detected_at.
      // Guard status to ensure we never reopen a row that was closed concurrently.
      // Never mutate identity evidence columns (candidateWorkerId, identitySimilarityScore, identityQualityScore) or status.
      const updateResult = await manager
        .createQueryBuilder()
        .update(SafetyAlertEntity)
        .set({
          detectionCount: () => 'detection_count + 1',
          lastDetectedAt: newLastDetectedAt,
        })
        .where('id = :id', { id: matchedAlert.id })
        .andWhere('status IN (:...openStatuses)', { openStatuses: OPEN_ALERT_STATUSES })
        .execute();

      if (updateResult.affected && updateResult.affected > 0) {
        const updated = await manager
          .getRepository(SafetyAlertEntity)
          .findOneBy({ id: matchedAlert.id });
        if (updated) {
          return updated;
        }
      }
    }

    // 4. If no matching open alert within cooldown, or if the alert was closed concurrently: create new Alert
    return this.createAlert(manager, siteId, candidate, capturedAt, true);
  }

  private async createAlert(
    manager: EntityManager,
    siteId: string,
    candidate: AlertCandidate,
    capturedAt: Date,
    notifyLegacy: boolean,
  ): Promise<SafetyAlertEntity> {
    const alertRepo = manager.getRepository(SafetyAlertEntity);
    const newAlert = alertRepo.create({
      id: randomUUID(),
      siteId,
      zoneId: candidate.zoneId ?? null,
      candidateWorkerId: candidate.candidateWorkerId ?? null,
      identitySimilarityScore: candidate.identitySimilarityScore ?? null,
      identityQualityScore: candidate.identityQualityScore ?? null,
      alertType: candidate.alertType as AlertType,
      candidateSubtype: candidate.candidateSubtype,
      groupingKey: candidate.groupingKey,
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: capturedAt,
      lastDetectedAt: capturedAt,
      detectionCount: 1,
    });

    const saved = await alertRepo.save(newAlert);
    if (notifyLegacy && saved.alertType === AlertType.PPE_VIOLATION) {
      await this.notifications.recordPpeAlert(manager, saved, candidate.cameraId);
    }
    return saved;
  }
}
