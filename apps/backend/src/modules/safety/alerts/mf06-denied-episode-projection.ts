import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { Mf06AssessmentStore } from '../assessments/mf06-assessment-store.service.js';
import {
  loadMf06RequestAdmission,
  readSealedMf06TrackedFrame,
} from '../assessments/mf06-event-admission.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { AlertStatus, AlertType } from '../../../database/entities/enums.js';
import { buildGroupingKey } from './alert-candidate-evaluator.js';

type Result =
  | { state: 'SKIPPED' }
  | {
      state: 'PROJECTED' | 'REPLAY';
      episodeId: string;
      alertId: string;
      insertedRecipients: number;
      contentRevision: number;
    };
function unavailable(): never {
  throw new Error('MF06_DENIED_EPISODE_UNAVAILABLE');
}

/** Initial trusted denial projection on the assessment caller's serializable transaction. */
export class Mf06DeniedEpisodeProjection {
  private readonly maxRecipients: number;
  constructor(
    private readonly db: DataSource,
    policy: { maxRecipients: number },
  ) {
    if (
      !policy ||
      !Number.isSafeInteger(policy.maxRecipients) ||
      policy.maxRecipients < 1 ||
      policy.maxRecipients > 4096
    )
      unavailable();
    this.maxRecipients = policy.maxRecipients;
  }

  async project(manager: EntityManager, siteId: string, assessmentId: string): Promise<Result> {
    if (
      manager.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased
    )
      unavailable();
    const [settings] = await manager.query('SHOW transaction_isolation');
    if (settings?.transaction_isolation !== 'serializable') unavailable();
    const denial = await new Mf06AssessmentStore(this.db).readNotificationDenialInTransaction(
      manager,
      siteId,
      assessmentId,
    );
    if (!denial) return { state: 'SKIPPED' };
    const a = denial.assessment;
    const cameras = await manager.query(
      'SELECT id FROM camera WHERE id=$1 AND site_id=$2 FOR UPDATE',
      [a.cameraId, a.siteId],
    );
    if (cameras.length !== 1) unavailable();
    const request = await manager
      .getRepository(ZoneEntryAssessmentRequestEntity)
      .findOneBy({ requestId: a.requestId, siteId: a.siteId });
    const event = await manager
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: a.eventId });
    if (
      !request ||
      !event ||
      request.subjectBindingStatus !== 'BOUND' ||
      request.personObservationIndex === null ||
      !Number.isSafeInteger(request.personObservationIndex) ||
      request.personObservationIndex < 0 ||
      request.personObservationIndex > 255 ||
      request.eventId !== a.eventId ||
      request.cameraId !== a.cameraId ||
      request.zoneId !== a.zoneId ||
      event.resolvedCameraId !== a.cameraId ||
      !(await loadMf06RequestAdmission(manager, event, request))
    )
      return { state: 'SKIPPED' };
    if (!(await readSealedMf06TrackedFrame(manager, event, a.siteId))) return { state: 'SKIPPED' };
    const raw = event.rawPayload as {
      streamSessionId: string;
      continuity: {
        subjects: Array<{ personObservationIndex: number; segmentId: string }>;
      };
    };
    const subjects = raw.continuity.subjects.filter(
      (s) => s.personObservationIndex === request.personObservationIndex,
    );
    if (subjects.length !== 1) unavailable();
    const segmentId = subjects[0]!.segmentId;
    const [segment]: Array<{ scope: string; state: string }> = await manager.query(
      `SELECT s.scope_sha256 AS scope,s.state FROM ai_subject_segment s
       JOIN ai_observation_event e ON e.event_id=$1 AND e.resolved_camera_id=s.camera_id
         AND e.tracking_scope_sha256=s.scope_sha256 AND e.tracking_site_id=s.site_id
       WHERE s.segment_id=$2 AND s.site_id=$3 AND s.camera_id=$4 FOR UPDATE OF s`,
      [a.eventId, segmentId, a.siteId, a.cameraId],
    );
    if (!segment) unavailable();
    const episodes: Array<{ id: string; revision: number }> = await manager.query(
      `SELECT id,content_revision AS revision FROM safety_episode
       WHERE subject_kind='TRACKED' AND tracking_segment_id=$1 AND tracking_scope_sha256=$2
         AND camera_id=$3 AND site_id=$4 FOR UPDATE`,
      [segmentId, segment.scope, a.cameraId, a.siteId],
    );
    if (episodes.length > 1) unavailable();
    const existing = episodes[0],
      episodeId = existing?.id ?? randomUUID();
    if (!existing)
      await manager.query(
        `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,
       first_observed_at,last_observed_at,subject_kind,tracking_segment_id,tracking_scope_sha256,collection_state)
       SELECT $1,$2,$3,event_id,$5,payload_hash,captured_at,captured_at,'TRACKED',$6,$7,$8
       FROM ai_observation_event WHERE event_id=$4`,
        [
          episodeId,
          a.siteId,
          a.cameraId,
          a.eventId,
          request.personObservationIndex,
          segmentId,
          segment.scope,
          segment.state === 'ACTIVE' ? 'COLLECTING' : 'SEALED',
        ],
      );
    const findings: Array<{ id: string }> = await manager.query(
      `SELECT id FROM safety_alert WHERE episode_id=$1 AND site_id=$2
       AND candidate_subtype=$3 AND zone_id=$4 FOR UPDATE`,
      [episodeId, a.siteId, denial.candidateSubtype, a.zoneId],
    );
    if (findings.length > 1) unavailable();
    const newFinding = findings.length === 0,
      alertId = findings[0]?.id ?? randomUUID();
    if (newFinding) {
      const repo = manager.getRepository(SafetyAlertEntity);
      await repo.insert(
        repo.create({
          id: alertId,
          siteId: a.siteId,
          zoneId: a.zoneId,
          alertType: AlertType.RESTRICTED_ZONE_INTRUSION,
          candidateSubtype: denial.candidateSubtype,
          groupingKey: buildGroupingKey(
            denial.candidateSubtype,
            a.cameraId,
            raw.streamSessionId,
            a.zoneId,
            request.trackId,
          ),
          status: AlertStatus.PENDING_REVIEW,
          candidateWorkerId: null,
          identitySimilarityScore: null,
          identityQualityScore: null,
          firstDetectedAt: event.capturedAt,
          lastDetectedAt: event.capturedAt,
          detectionCount: 1,
        }),
      );
      await manager.query(
        `UPDATE safety_alert SET episode_id=$1,
        first_detected_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$4),
        last_detected_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$4)
        WHERE id=$2 AND site_id=$3`,
        [episodeId, alertId, a.siteId, a.eventId],
      );
    }
    const mappings: Array<{ alert_id: string }> = await manager.query(
      `INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index) VALUES($1,$2,$3)
       ON CONFLICT(alert_id,event_id) DO NOTHING RETURNING alert_id`,
      [alertId, a.eventId, request.personObservationIndex],
    );
    if (!newFinding && !mappings.length) {
      return {
        state: 'REPLAY',
        episodeId,
        alertId,
        insertedRecipients: 0,
        contentRevision: existing!.revision,
      };
    }
    if (!newFinding && mappings.length) {
      const updated: Array<{ id: string }> = await manager.query(
        `WITH updated AS (UPDATE safety_alert SET detection_count=detection_count+1,
         last_detected_at=GREATEST(last_detected_at,(SELECT captured_at FROM ai_observation_event WHERE event_id=$2))
         WHERE id=$1 AND detection_count<2147483647 RETURNING id) SELECT id FROM updated`,
        [alertId, a.eventId],
      );
      if (updated.length !== 1) unavailable();
    }
    const bump = existing && newFinding ? 1 : 0;
    if (existing && bump && existing.revision >= 2147483647) unavailable();
    await manager.query(
      `UPDATE safety_episode SET last_observed_at=GREATEST(last_observed_at,
      (SELECT captured_at FROM ai_observation_event WHERE event_id=$2)),
      content_revision=content_revision+$3 WHERE id=$1`,
      [episodeId, a.eventId, bump],
    );
    const recipients: Array<{ id: string }> = await manager.query(
      `SELECT u.id FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id
       WHERE u.is_active AND NOT u.must_change_password AND r.site_id=$1 AND r.role='SAFETY_OFFICER'
       ORDER BY u.id,r.id LIMIT $2 FOR SHARE OF u,r`,
      [a.siteId, this.maxRecipients + 1],
    );
    if (recipients.length > this.maxRecipients) unavailable();
    let insertedRecipients = 0;
    for (const userId of new Set(recipients.map((r) => r.id))) {
      const inserted = await manager.query(
        `INSERT INTO safety_episode_recipient(id,episode_id,site_id,recipient_user_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(recipient_user_id,episode_id) DO NOTHING RETURNING id`,
        [randomUUID(), episodeId, a.siteId, userId],
      );
      insertedRecipients += inserted.length;
    }
    return {
      state: newFinding || mappings.length || insertedRecipients ? 'PROJECTED' : 'REPLAY',
      episodeId,
      alertId,
      insertedRecipients,
      contentRevision: (existing?.revision ?? 1) + bump,
    };
  }
}
