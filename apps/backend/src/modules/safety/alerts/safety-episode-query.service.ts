import { HttpStatus, Injectable } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { DataSource, type EntityManager } from 'typeorm';
import type { SafetyEpisode, SafetyEpisodePage, SafetyEpisodeFinding } from '@smartsite/contracts';
import {
  command,
  conflict,
  invalid,
  missing,
  uuid,
} from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyEpisodeEntity } from '../../../database/entities/safety-episode.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ObservationIdentityResolutionEntity } from '../../../database/entities/observation-identity-resolution.entity.js';
import { ObservationIdentityDecisionEntity } from '../../../database/entities/observation-identity-decision.entity.js';
import {
  IncidentEntity,
  CorrectiveActionEntity,
} from '../../../database/entities/safety-workflow.entity.js';
import { SafetyAlertEvidenceService } from './safety-alert-evidence.service.js';
import { reviewEventIsConsistent } from '../identity/observation-identity-event.js';
import { resolveEventLocalEpisodeSubject } from '@smartsite/contracts';
import {
  projectObservationSubjectRef,
  observationSubjectRefMatchesEvent,
} from '../identity/observation-identity-subject-ref.js';
import { identityDecisionPageResponse } from '../identity/observation-identity-response.dto.js';

class EpisodeFilters {
  @IsOptional() @IsUUID() cameraId?: string;
  @IsOptional() @IsUUID() zoneId?: string;
}

@Injectable()
export class SafetyEpisodeQueryService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: UserAuthGuard,
    private readonly evidence: SafetyAlertEvidenceService,
  ) {}

  private async authorize(
    manager: EntityManager,
    request: AuthenticatedRequest,
    siteId: string,
  ): Promise<boolean> {
    await this.auth.authenticateRequest(request, manager);
    const user = request.user;
    if (!user)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    if (user.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    const roles: { role: string; site_id: string | null }[] = await manager.query(
      `SELECT role,site_id FROM ${this.scope()}.user_role_assignment WHERE user_id=$1 ORDER BY id FOR SHARE`,
      [user.id],
    );
    const safety = roles.some((role) => role.role === 'SAFETY_OFFICER' && role.site_id === siteId);
    if (!safety && !roles.some((role) => role.role === 'ADMIN' && role.site_id === null))
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    return safety;
  }

  private scope(): string {
    const schema = this.db.driver.schema;
    if (
      typeof schema !== 'string' ||
      !schema ||
      schema.includes('\0') ||
      Buffer.byteLength(schema) > 63 ||
      /^(pg_|information_schema$)/i.test(schema)
    )
      throw new Error('SAFETY_EPISODE_SCHEMA_UNAVAILABLE');
    return '"' + schema.replaceAll('"', '""') + '"';
  }

  async get(
    request: AuthenticatedRequest,
    rawSiteId: string,
    rawId: string,
  ): Promise<SafetyEpisode> {
    const siteId = uuid(rawSiteId).toLowerCase(),
      id = uuid(rawId).toLowerCase();
    const snapshot = await this.db.transaction('REPEATABLE READ', async (manager) => {
      const safety = await this.authorize(manager, request, siteId);
      const episode = await manager.getRepository(SafetyEpisodeEntity).findOneBy({ id, siteId });
      if (!episode) missing();
      const alerts = await manager
        .getRepository(SafetyAlertEntity)
        .createQueryBuilder('a')
        .where('a.site_id=:siteId AND a.episode_id=:id', { siteId, id })
        .orderBy('a.id', 'ASC')
        .take(257)
        .getMany();
      if (!alerts.length) missing();
      if (alerts.length > 256) conflict('Episode findings exceed the supported bound');
      const event = await manager
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: episode.eventId });
      if (
        !event ||
        !reviewEventIsConsistent(event) ||
        event.payloadHash !== episode.payloadHash ||
        event.resolvedCameraId !== episode.cameraId
      )
        conflict('Episode observation is inconsistent');
      const raw = event.rawPayload as {
        observations: { type: string; trackId: number }[];
        evidence: { kind: string; trackId?: number; sha256?: string }[];
      };
      if (
        !resolveEventLocalEpisodeSubject(
          event.eventId,
          raw.observations,
          episode.personObservationIndex,
        )
      )
        conflict('Episode subject is inconsistent');
      const mappings: { alert_id: string; person_observation_index: number | null }[] =
        await manager.query(
          `SELECT alert_id,person_observation_index FROM ${this.scope()}.alert_detection_mapping WHERE event_id=$1 AND alert_id=ANY($2::uuid[])`,
          [event.eventId, alerts.map((alert) => alert.id)],
        );
      if (
        alerts.some(
          (alert) =>
            !mappings.some(
              (m) =>
                m.alert_id === alert.id &&
                m.person_observation_index === episode.personObservationIndex,
            ),
        )
      )
        conflict('Episode finding provenance is inconsistent');
      const [crossSite]: { conflict: boolean }[] = await manager.query(
        `SELECT EXISTS(SELECT 1 FROM ${this.scope()}.alert_detection_mapping m JOIN ${this.scope()}.safety_alert a ON a.id=m.alert_id WHERE m.event_id=$1 AND a.site_id<>$2) AS conflict`,
        [event.eventId, siteId],
      );
      if (crossSite?.conflict) conflict('Episode evidence scope is inconsistent');
      let identityDecision: SafetyEpisode['identityDecision'] = null;
      if (safety) {
        const head = await manager.getRepository(ObservationIdentityResolutionEntity).findOneBy({
          eventId: event.eventId,
          personObservationIndex: episode.personObservationIndex,
          siteId,
        });
        if (head?.currentDecisionId) {
          const decision = await manager
            .getRepository(ObservationIdentityDecisionEntity)
            .findOneBy({
              id: head.currentDecisionId,
              resolutionId: head.id,
              revision: head.revision,
              siteId,
            });
          const ref = projectObservationSubjectRef(head.subjectRef);
          if (
            !decision ||
            head.payloadHash !== event.payloadHash ||
            !ref ||
            !observationSubjectRefMatchesEvent(ref, event, episode.personObservationIndex)
          )
            conflict('Episode identity decision is inconsistent');
          identityDecision = identityDecisionPageResponse({ items: [decision], total: 1 }, ref)
            .items[0]!;
        }
      }
      const workflowLinks: SafetyEpisode['workflowLinks'] = [];
      for (const incidentId of [
        ...new Set(alerts.flatMap((alert) => (alert.incidentId ? [alert.incidentId] : []))),
      ].sort()) {
        const incident = await manager
          .getRepository(IncidentEntity)
          .findOneBy({ id: incidentId, siteId });
        if (!incident) conflict('Episode workflow scope is inconsistent');
        const actions = await manager
          .getRepository(CorrectiveActionEntity)
          .find({ where: { incidentId }, order: { id: 'ASC' }, take: 257 });
        if (actions.length > 256) conflict('Episode actions exceed the supported bound');
        workflowLinks.push({
          incidentId,
          status: incident.status,
          actions: actions.map((action) => ({ actionId: action.id, status: action.status })),
        });
      }
      return { episode, alerts, event, raw, identityDecision, workflowLinks };
    });
    const { episode, alerts, event, raw } = snapshot;
    const selectedTrack = raw.observations[episode.personObservationIndex]!.trackId;
    const refs: SafetyEpisodeFinding['evidenceRefs'] = [];
    // Read each shared frame only once, outside database transactions. Never expose storage URIs.
    for (const descriptor of this.evidence.summarize(raw, event.eventId)) {
      const item = raw.evidence[descriptor.index];
      if (
        !item ||
        (item.kind !== 'FRAME' && item.trackId !== selectedTrack) ||
        !item.sha256 ||
        !/^[0-9a-f]{64}$/.test(item.sha256)
      )
        continue;
      let available = false;
      try {
        await this.evidence.read(siteId, alerts[0]!.id, event.eventId, String(descriptor.index));
        available = true;
      } catch (error) {
        if (!(error instanceof PublicHttpException) || ![404, 409, 503].includes(error.getStatus()))
          throw error;
      }
      refs.push({
        eventId: event.eventId,
        personObservationIndex: episode.personObservationIndex,
        evidenceIndex: descriptor.index,
        sha256: item.sha256,
        available,
      });
    }
    // File IO may outlive revocation: recheck the current session/role before releasing the response.
    const safety = await this.db.transaction((manager) => this.authorize(manager, request, siteId));
    return {
      id: episode.id,
      siteId,
      cameraId: episode.cameraId,
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: event.eventId,
        personObservationIndex: episode.personObservationIndex,
      },
      configurationBundleId: null,
      firstObservedAt: episode.firstObservedAt.toISOString(),
      lastObservedAt: episode.lastObservedAt.toISOString(),
      contentRevision: episode.contentRevision,
      collectionState: episode.collectionState,
      findingCount: alerts.length,
      identityDecision: safety ? snapshot.identityDecision : null,
      findings: alerts.map((alert) => ({
        alertId: alert.id,
        alertType: alert.alertType,
        candidateSubtype: alert.candidateSubtype,
        status: alert.status,
        alertRevision: alert.revision,
        zoneId: alert.zoneId,
        evidenceRefs: refs,
      })),
      workflowLinks: snapshot.workflowLinks,
    };
  }

  async list(
    request: AuthenticatedRequest,
    rawSiteId: string,
    query: Record<string, unknown>,
  ): Promise<SafetyEpisodePage> {
    const siteId = uuid(rawSiteId).toLowerCase();
    const { offset, limit, ...filters } = query;
    for (const key of ['cameraId', 'zoneId', 'offset', 'limit'])
      if (query[key] !== undefined && typeof query[key] !== 'string') invalid();
    const filter = command(EpisodeFilters, filters);
    const page = pagination(offset as string | undefined, limit as string | undefined);
    const scope = this.scope();
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      await this.authorize(manager, request, siteId);
      const args = [
        siteId,
        filter.cameraId?.toLowerCase() ?? null,
        filter.zoneId?.toLowerCase() ?? null,
      ];
      const eligible = `e.site_id=$1 AND ($2::uuid IS NULL OR e.camera_id=$2)
        AND EXISTS(SELECT 1 FROM ${scope}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id AND ($3::uuid IS NULL OR a.zone_id=$3))`;
      const [count]: { total: number }[] = await manager.query(
        `SELECT count(*)::int AS total FROM ${scope}.safety_episode e WHERE ${eligible}`,
        args,
      );
      const rows: {
        id: string;
        site_id: string;
        camera_id: string;
        event_id: string;
        person_observation_index: number;
        first_observed_at: Date;
        last_observed_at: Date;
        content_revision: number;
        collection_state: 'COLLECTING' | 'SEALED';
        finding_count: number;
      }[] = await manager.query(
        `SELECT e.id,e.site_id,e.camera_id,e.event_id,e.person_observation_index,
        e.first_observed_at,e.last_observed_at,e.content_revision,e.collection_state,
        (SELECT count(*)::int FROM ${scope}.safety_alert a WHERE a.episode_id=e.id AND a.site_id=e.site_id) AS finding_count
        FROM ${scope}.safety_episode e WHERE ${eligible}
        ORDER BY e.first_observed_at DESC,e.id DESC OFFSET $4 LIMIT $5`,
        [...args, page.offset, page.limit],
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          siteId: row.site_id,
          cameraId: row.camera_id,
          subject: {
            kind: 'EVENT_LOCAL' as const,
            eventId: row.event_id,
            personObservationIndex: row.person_observation_index,
          },
          configurationBundleId: null,
          firstObservedAt: row.first_observed_at.toISOString(),
          lastObservedAt: row.last_observed_at.toISOString(),
          contentRevision: row.content_revision,
          collectionState: row.collection_state,
          findingCount: row.finding_count,
        })),
        total: count?.total ?? 0,
      };
    });
  }
}
