import { randomUUID } from 'node:crypto';
import {
  computeCanonicalPayloadHash,
  computeWorkerEventBindingHash,
  parseWorkerEventDeliveryContext,
  validateTrackedObservationEvent,
  type CameraConfigurationBundle,
} from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { readHistoricalIssuedCameraBundleInTransaction } from '../../cameras/camera-configuration-bundle-reader.js';
import {
  ObservationContextResolverService,
  type ResolvedObservationContext,
} from '../../zones/observation-context-resolver.service.js';
import {
  AlertCandidateEvaluator,
  type AlertCandidate,
  type Observation,
} from './alert-candidate-evaluator.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { AlertStatus, AlertType } from '../../../database/entities/enums.js';

interface Input {
  siteId: string;
  cameraId: string;
  scopeSha256: string;
  coordinatorEventId: string;
}
interface Payload {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  framePartition: { partIndex: number; partCount: number; frameId: string };
  observations: Observation[];
  continuity: {
    subjects: Array<{ personObservationIndex: number; segmentId: string }>;
    retiredSegments: Array<{ segmentId: string }>;
  };
}
interface Raw {
  routeMode: string | null;
  routeEpoch: string | null;
  eventId: string;
  payloadHash: string;
  rawPayload: unknown;
  context: { context: unknown; classification: string; bindingHash: string };
  partIndex: number;
  partCount: number;
  frameId: string;
  sequence: string;
  state: string;
  scopeSha256: string;
  generationId: string;
  sessionId: string;
}
interface Contribution {
  row: Raw;
  payload: Payload;
  personIndex: number;
  candidate: AlertCandidate;
  regions: string[];
}
interface Batch {
  segmentId: string;
  findings: Map<string, Contribution[]>;
}
function unavailable(): never {
  throw new Error('TRACKED_PPE_PROJECTION_UNAVAILABLE');
}
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** End technical collection only. Preserve findings/reviews, last real observation and unread revision. */
export async function sealRetiredTrackedEpisodes(
  manager: EntityManager,
  siteId: string,
  cameraId: string,
  segmentIds: readonly string[],
) {
  if (
    !manager.queryRunner?.isTransactionActive ||
    manager.queryRunner.isReleased ||
    !uuid.test(siteId) ||
    !uuid.test(cameraId) ||
    segmentIds.length > 4096 ||
    segmentIds.some((id) => !uuid.test(id))
  )
    unavailable();
  if (!segmentIds.length) return;
  const rows = await manager.query<Array<{ id: string }>>(
    `SELECT e.id FROM safety_episode e JOIN ai_subject_segment s
    ON s.segment_id=e.tracking_segment_id AND s.scope_sha256=e.tracking_scope_sha256 AND s.site_id=e.site_id AND s.camera_id=e.camera_id
    WHERE e.subject_kind='TRACKED' AND e.collection_state='COLLECTING' AND e.site_id=$1 AND e.camera_id=$2
    AND s.state='RETIRED' AND s.segment_id=ANY($3::uuid[]) ORDER BY e.id FOR UPDATE OF e`,
    [siteId, cameraId, [...new Set(segmentIds)]],
  );
  if (rows.length)
    await manager.query(
      "UPDATE safety_episode SET collection_state='SEALED' WHERE site_id=$1 AND camera_id=$2 AND id=ANY($3::uuid[])",
      [siteId, cameraId, rows.map((r) => r.id)],
    );
}

/** Unregistered business projection for the tracked admission owner's transaction only.
 * The admission owner authenticates every original immediately before invoking this port.
 * No HTTP, legacy fallback, identity propagation or notification owner is installed here.
 */
export class TrackedPpeEpisodeProjection {
  constructor(private readonly db: DataSource) {}
  async projectFrame(manager: EntityManager, input: Input) {
    if (
      manager.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased ||
      !input ||
      ![input.siteId, input.cameraId, input.coordinatorEventId].every((id) => uuid.test(id)) ||
      !/^[a-f0-9]{64}$/.test(input.scopeSha256)
    )
      unavailable();
    const scope = { ...input };
    await manager.query('SELECT id FROM camera WHERE id=$1 AND site_id=$2 FOR UPDATE', [
      scope.cameraId,
      scope.siteId,
    ]);
    const select = `SELECT event_id AS "eventId",payload_hash AS "payloadHash",raw_payload AS "rawPayload",admission_context AS context,
      tracking_part_index AS "partIndex",tracking_part_count AS "partCount",tracking_frame_id AS "frameId",tracking_source_sequence::text AS sequence,
      tracking_frame_state AS state,tracking_scope_sha256 AS "scopeSha256",tracking_generation_id AS "generationId",stream_session_id AS "sessionId",
      safety_route_mode AS "routeMode",safety_route_epoch AS "routeEpoch"
      FROM ai_observation_event`;
    const [coordinator] = await manager.query<Raw[]>(
      `${select} WHERE event_id=$1 AND resolved_camera_id=$2 AND tracking_site_id=$3 AND tracking_part_index=0 FOR SHARE`,
      [scope.coordinatorEventId, scope.cameraId, scope.siteId],
    );
    if (
      !coordinator ||
      coordinator.state !== 'SEALED' ||
      coordinator.scopeSha256 !== scope.scopeSha256 ||
      coordinator.routeMode !== 'EPISODE_TRACKED' ||
      !coordinator.routeEpoch
    )
      unavailable();
    const rows = await manager.query<Raw[]>(
      `${select} WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3
      AND tracking_frame_id=$4 ORDER BY tracking_part_index LIMIT 1025 FOR SHARE`,
      [scope.cameraId, coordinator.generationId, coordinator.sessionId, coordinator.frameId],
    );
    if (rows.length !== coordinator.partCount || rows.length > 1024) unavailable();
    const batches = new Map<string, Batch>();
    for (const row of rows) {
      if (
        row.scopeSha256 !== scope.scopeSha256 ||
        row.routeMode !== 'EPISODE_TRACKED' ||
        row.routeEpoch !== coordinator.routeEpoch ||
        row.sequence !== coordinator.sequence ||
        row.partCount !== rows.length ||
        (row.partIndex === 0 ? row.state !== 'SEALED' : row.state !== 'PART_STAGED') ||
        !validateTrackedObservationEvent(row.rawPayload).isValid ||
        computeCanonicalPayloadHash(row.rawPayload) !== row.payloadHash ||
        row.context?.classification !== 'LIVE'
      )
        unavailable();
      const payload = row.rawPayload as Payload,
        context = parseWorkerEventDeliveryContext(row.context.context);
      if (
        !context ||
        context.cameraId !== scope.cameraId ||
        context.workerGenerationId !== row.generationId ||
        context.streamSessionId !== row.sessionId ||
        payload.eventId.toLowerCase() !== row.eventId ||
        computeWorkerEventBindingHash(row.payloadHash, context) !== row.context.bindingHash
      )
        unavailable();
      const bundle = await readHistoricalIssuedCameraBundleInTransaction(manager, {
        ...context,
        siteId: scope.siteId,
        cameraExternalId: payload.cameraExternalId,
      });
      if (!bundle) unavailable();
      const contexts = new Map<string, ResolvedObservationContext>();
      const resolver = new ObservationContextResolverService();
      for (const observation of payload.observations) {
        if (observation.type !== 'PPE') continue;
        const key = `${observation.regionId}:${observation.geometryVersion}`;
        if (!contexts.has(key)) {
          const resolved = await resolver.resolveIssuedRegion(
            manager,
            scope.siteId,
            bundle,
            observation.regionId,
            observation.geometryVersion,
          );
          if (!resolved) unavailable();
          contexts.set(key, resolved);
        }
      }
      // Zone-entry assessments retain their capture-time authority pipeline; never infer one here.
      const candidates = new AlertCandidateEvaluator().evaluate(
        {
          streamSessionId: payload.streamSessionId,
          cameraExternalId: payload.cameraExternalId,
          observations: payload.observations.filter((o) => o.type !== 'ZONE_ENTRY'),
        },
        contexts,
      );
      for (const candidate of candidates) {
        if (candidate.alertType !== 'PPE_VIOLATION') unavailable();
        const personIndex = payload.observations.findIndex(
          (o) => o.type === 'PERSON' && o.trackId === candidate.trackId,
        );
        const claim = payload.continuity.subjects.find(
          (s) => s.personObservationIndex === personIndex,
        );
        if (!claim || personIndex < 0) unavailable();
        const batch = batches.get(claim.segmentId) ?? {
          segmentId: claim.segmentId,
          findings: new Map<string, Contribution[]>(),
        };
        const key = `${candidate.candidateSubtype}:${candidate.zoneId ?? ''}`;
        const contributors = batch.findings.get(key) ?? [];
        contributors.push({
          row,
          payload,
          personIndex,
          candidate,
          regions: this.regions(payload, personIndex, candidate, bundle),
        });
        batch.findings.set(key, contributors);
        batches.set(claim.segmentId, batch);
      }
    }
    const projected: Array<{
      episodeId: string;
      contentRevision: number;
      materialChange: boolean;
      deliveryAdmitted: false;
    }> = [];
    for (const batch of [...batches.values()].sort((a, b) =>
      a.segmentId.localeCompare(b.segmentId),
    )) {
      const [head] = await manager.query<Array<{ frameId: string; scope: string }>>(
        `SELECT r.tracking_frame_id AS "frameId",s.scope_sha256 AS scope
        FROM ai_subject_segment s JOIN ai_observation_event r ON r.event_id=s.head_event_id
        WHERE s.segment_id=$1 AND s.camera_id=$2 AND s.site_id=$3 AND s.state='ACTIVE' FOR UPDATE OF s`,
        [batch.segmentId, scope.cameraId, scope.siteId],
      );
      if (!head || head.scope !== scope.scopeSha256 || head.frameId !== coordinator.frameId)
        unavailable();
      const existing = await manager.query<
        Array<{ id: string; content_revision: number; collection_state: string }>
      >(
        `SELECT id,content_revision,collection_state FROM safety_episode
        WHERE subject_kind='TRACKED' AND tracking_segment_id=$1 AND tracking_scope_sha256=$2 AND camera_id=$3 AND site_id=$4 FOR UPDATE`,
        [batch.segmentId, scope.scopeSha256, scope.cameraId, scope.siteId],
      );
      if (existing.length > 1 || existing[0]?.collection_state === 'SEALED') unavailable();
      const episode = existing[0],
        episodeId = episode?.id ?? randomUUID();
      const first = [...batch.findings.values()]
        .flat()
        .sort((a, b) => a.row.partIndex - b.row.partIndex || a.personIndex - b.personIndex)[0]!;
      if (!episode)
        await manager.query(
          `INSERT INTO safety_episode(id,site_id,camera_id,event_id,person_observation_index,payload_hash,first_observed_at,last_observed_at,subject_kind,tracking_segment_id,tracking_scope_sha256)
        SELECT $1,$2,$3,event_id,$5,payload_hash,captured_at,captured_at,'TRACKED',$6,$7 FROM ai_observation_event WHERE event_id=$4`,
          [
            episodeId,
            scope.siteId,
            scope.cameraId,
            first.row.eventId,
            first.personIndex,
            batch.segmentId,
            scope.scopeSha256,
          ],
        );
      let material = !episode;
      for (const [, contributors] of [...batch.findings].sort(([a], [b]) => a.localeCompare(b))) {
        const original = contributors[0]!,
          candidate = original.candidate;
        const findings = await manager.query<Array<{ id: string }>>(
          `SELECT id FROM safety_alert WHERE episode_id=$1 AND site_id=$2
          AND candidate_subtype=$3 AND zone_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE`,
          [episodeId, scope.siteId, candidate.candidateSubtype, candidate.zoneId ?? null],
        );
        if (findings.length > 1) unavailable();
        let alertId = findings[0]?.id;
        if (!alertId) {
          material = true;
          alertId = randomUUID();
          const repo = manager.getRepository(SafetyAlertEntity);
          await repo.insert(
            repo.create({
              id: alertId,
              siteId: scope.siteId,
              zoneId: candidate.zoneId ?? null,
              candidateWorkerId: candidate.candidateWorkerId ?? null,
              identitySimilarityScore: candidate.identitySimilarityScore ?? null,
              identityQualityScore: candidate.identityQualityScore ?? null,
              alertType: AlertType.PPE_VIOLATION,
              candidateSubtype: candidate.candidateSubtype,
              groupingKey: candidate.groupingKey,
              status: AlertStatus.PENDING_REVIEW,
              firstDetectedAt: new Date(original.payload.capturedAt),
              lastDetectedAt: new Date(original.payload.capturedAt),
              detectionCount: 1,
            }),
          );
          await manager.query(
            `UPDATE safety_alert SET episode_id=$1,
            first_detected_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$4),
            last_detected_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$4)
            WHERE id=$2 AND site_id=$3`,
            [episodeId, alertId, scope.siteId, original.row.eventId],
          );
        } else {
          const previous = await manager.query<Array<{ rawPayload: unknown; personIndex: number }>>(
            `SELECT r.raw_payload AS "rawPayload",m.person_observation_index AS "personIndex"
            FROM alert_detection_mapping m JOIN ai_observation_event r ON r.event_id=m.event_id WHERE m.alert_id=$1
            AND r.tracking_source_sequence=(SELECT max(p.tracking_source_sequence) FROM alert_detection_mapping n JOIN ai_observation_event p ON p.event_id=n.event_id WHERE n.alert_id=$1)
            ORDER BY r.tracking_part_index LIMIT 1025`,
            [alertId],
          );
          if (!previous.length || previous.length > 1024) unavailable();
          // Scope is immutable, so the current issued bundle also resolves prior same-scope region bindings.
          const ctx = parseWorkerEventDeliveryContext(original.row.context.context)!;
          const bundle = await readHistoricalIssuedCameraBundleInTransaction(manager, {
            ...ctx,
            siteId: scope.siteId,
            cameraExternalId: original.payload.cameraExternalId,
          });
          if (!bundle) unavailable();
          const before = [
            ...new Set(
              previous.flatMap((p) =>
                this.regions(p.rawPayload as Payload, p.personIndex, candidate, bundle),
              ),
            ),
          ].sort();
          const current = [...new Set(contributors.flatMap((c) => c.regions))].sort();
          if (JSON.stringify(before) !== JSON.stringify(current)) material = true;
          const [updated] = await manager.query<Array<{ id: string }>>(
            `WITH updated AS (UPDATE safety_alert SET detection_count=detection_count+1,
            last_detected_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$2)
            WHERE id=$1 AND detection_count<2147483647 RETURNING id) SELECT id FROM updated`,
            [alertId, original.row.eventId],
          );
          if (!updated) unavailable();
        }
        for (const contribution of contributors)
          await manager.query(
            `INSERT INTO alert_detection_mapping(alert_id,event_id,person_observation_index)
          VALUES($1,$2,$3) ON CONFLICT(alert_id,event_id) DO NOTHING`,
            [alertId, contribution.row.eventId, contribution.personIndex],
          );
      }
      if (episode && material && episode.content_revision === 2147483647) unavailable();
      await manager.query(
        `UPDATE safety_episode SET last_observed_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$2),
        content_revision=content_revision+$3 WHERE id=$1`,
        [episodeId, scope.coordinatorEventId, episode && material ? 1 : 0],
      );
      projected.push({
        episodeId,
        contentRevision: (episode?.content_revision ?? 1) + (episode && material ? 1 : 0),
        materialChange: material,
        deliveryAdmitted: false,
      });
    }
    await sealRetiredTrackedEpisodes(manager, scope.siteId, scope.cameraId, [
      ...new Set(
        rows.flatMap((row) =>
          (row.rawPayload as Payload).continuity.retiredSegments.map((s) => s.segmentId),
        ),
      ),
    ]);
    return projected;
  }
  private regions(
    payload: Payload,
    personIndex: number,
    candidate: AlertCandidate,
    bundle: CameraConfigurationBundle,
  ): string[] {
    const person = payload.observations[personIndex];
    if (!person || person.type !== 'PERSON') unavailable();
    return [
      ...new Set(
        payload.observations.flatMap((o) =>
          o.type === 'PPE' &&
          o.trackId === person.trackId &&
          o.status === 'MISSING' &&
          o.ppeItem === candidate.details.ppeItem &&
          bundle.regions.some(
            (r) =>
              r.regionId === o.regionId &&
              r.geometryVersion === o.geometryVersion &&
              r.zoneId === candidate.zoneId,
          )
            ? [`${o.regionId}:${o.geometryVersion}`]
            : [],
        ),
      ),
    ].sort();
  }
}
