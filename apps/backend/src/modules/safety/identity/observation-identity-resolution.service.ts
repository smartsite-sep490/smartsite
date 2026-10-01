import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, In, type EntityManager } from 'typeorm';
import { conflict, missing, page } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../../database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { ObservationIdentityDecisionEntity } from '../../../database/entities/observation-identity-decision.entity.js';
import { ObservationIdentityResolutionEntity } from '../../../database/entities/observation-identity-resolution.entity.js';
import { SafetyAlertEvidenceService } from '../alerts/safety-alert-evidence.service.js';
import {
  normalizeObservationIdentityScope,
  normalizeObservationIdentitySubjectScope,
  observationIdentityCommandHash,
  parseObservationIdentityCommand,
  type ObservationIdentityCommandScope,
  type ObservationIdentityDecisionCommand,
} from './observation-identity-command.js';
import { selectObservationSubject } from './observation-identity-subject.js';
import type { ObservationSubjectRef } from './observation-identity.types.js';
import type { WorkerReferenceReader } from './worker-reference.port.js';
import { reviewEventIsConsistent } from './observation-identity-event.js';
import {
  observationSubjectRefMatchesEvent,
  projectObservationSubjectRef,
} from './observation-identity-subject-ref.js';

export interface ObservationIdentityDecisionResult {
  decision: ObservationIdentityDecisionEntity;
  latestHead: ObservationIdentityResolutionEntity;
  replayed: boolean;
}

export interface ObservationIdentityContextRecords {
  event: AiObservationEventEntity;
  heads: {
    head: ObservationIdentityResolutionEntity;
    decision: ObservationIdentityDecisionEntity | null;
  }[];
}

/** HTTP callers require the dedicated identity-review guard before invoking this service. */
@Injectable()
export class ObservationIdentityResolutionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly evidence: SafetyAlertEvidenceService,
    private readonly workers?: WorkerReferenceReader,
  ) {}

  async decide(
    siteId: string,
    alertId: string,
    eventId: string,
    personObservationIndex: number,
    actorUserId: string,
    input: unknown,
  ): Promise<ObservationIdentityDecisionResult> {
    const scope = normalizeObservationIdentityScope({
      siteId,
      alertId,
      eventId,
      personObservationIndex,
      actorUserId,
    });
    const command = parseObservationIdentityCommand(input);
    const hash = observationIdentityCommandHash(scope, command);
    const replay = await this.findReplay(scope, command, hash);
    if (replay) return replay;

    // No file IO or remote calls while any database lock is held.
    let subjectRef: ObservationSubjectRef | undefined;
    if (command.action === 'RESOLVE') {
      try {
        const event = await this.loadScopedEvent(this.dataSource.manager, scope);
        subjectRef = this.selectSubjectRef(event, scope, command.expectedEventHash);
        const frame = await this.evidence.readFrameForIdentityReview(
          scope.siteId,
          scope.alertId,
          scope.eventId,
          String(command.evidenceIndex),
          command.expectedEventHash,
        );
        if (frame.sha256 !== command.expectedEvidenceSha256)
          conflict('Observation identity evidence has changed');
      } catch (error) {
        // An identical request may commit while this retry is reading expired media.
        const concurrentReplay = await this.findReplay(scope, command, hash);
        if (concurrentReplay) return concurrentReplay;
        throw error;
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, `identity-command:${command.commandId}`);
      const lockedEvent = await this.loadScopedEvent(manager, scope);
      if (lockedEvent.payloadHash !== command.expectedEventHash)
        conflict('Observation identity event hash has changed');
      const recorded = await this.replay(manager, scope, command, hash, lockedEvent);
      if (recorded) return recorded;
      await this.lock(manager, `identity-subject:${scope.eventId}:${scope.personObservationIndex}`);
      const event = await this.loadScopedEvent(manager, scope);
      if (event.payloadHash !== command.expectedEventHash)
        conflict('Observation identity event hash has changed');
      const heads = manager.getRepository(ObservationIdentityResolutionEntity);
      let head = await heads.findOneBy({
        eventId: scope.eventId,
        personObservationIndex: scope.personObservationIndex,
      });
      if (head && (head.siteId !== scope.siteId || head.payloadHash !== command.expectedEventHash))
        conflict('Observation identity scope is inconsistent');
      if (head) this.assertHeadSubjectScope(head, event, scope.personObservationIndex);
      if ((head?.revision ?? 0) !== command.expectedRevision)
        conflict('Observation identity revision is stale');

      if (command.action === 'RESOLVE') {
        const currentRef = this.selectSubjectRef(event, scope, command.expectedEventHash);
        if (
          !subjectRef ||
          computeCanonicalPayloadHash(currentRef) !== computeCanonicalPayloadHash(subjectRef)
        )
          conflict('Observation identity subject has changed');
        if (!this.workers)
          throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Worker reference reader is unavailable',
          });
        const worker = await this.workers.findForReview(
          manager,
          scope.siteId,
          command.workerId,
          true,
        );
        if (!worker || worker.id !== command.workerId || worker.siteId !== scope.siteId) missing();
        if (!worker.isActive) conflict('Worker is inactive');
        if (!head)
          head = await heads.save(
            heads.create({
              id: randomUUID(),
              eventId: scope.eventId,
              personObservationIndex: scope.personObservationIndex,
              siteId: scope.siteId,
              payloadHash: command.expectedEventHash,
              subjectRef: currentRef,
              revision: 0,
              currentDecisionId: null,
            }),
          );
      } else {
        if (!head?.currentDecisionId) conflict('Observation identity has no resolution to clear');
        const current = await manager
          .getRepository(ObservationIdentityDecisionEntity)
          .findOneBy({ id: head.currentDecisionId, resolutionId: head.id });
        if (current?.action !== 'RESOLVE')
          conflict('Observation identity has no resolution to clear');
      }
      if (!head) conflict('Observation identity head is unavailable');
      const decisions = manager.getRepository(ObservationIdentityDecisionEntity);
      const decision = await decisions.save(
        decisions.create({
          id: command.commandId,
          resolutionId: head.id,
          siteId: scope.siteId,
          actorUserId: scope.actorUserId,
          revision: head.revision + 1,
          expectedRevision: command.expectedRevision,
          commandHash: hash,
          action: command.action,
          workerId: command.action === 'RESOLVE' ? command.workerId : null,
          evidenceIndex: command.action === 'RESOLVE' ? command.evidenceIndex : null,
          evidenceSha256: command.action === 'RESOLVE' ? command.expectedEvidenceSha256 : null,
          reason: command.reason,
          scope: 'EXACT_OBSERVATION',
          verificationMethod: 'MANUAL',
        }),
      );
      head.revision = decision.revision;
      head.currentDecisionId = decision.id;
      await heads.save(head);
      return { decision, latestHead: head, replayed: false };
    });
  }

  async listDecisions(
    siteId: string,
    alertId: string,
    eventId: string,
    personObservationIndex: number,
    offset = 0,
    limit = 20,
  ): Promise<{ items: ObservationIdentityDecisionEntity[]; total: number }> {
    const scope = normalizeObservationIdentitySubjectScope({
      siteId,
      alertId,
      eventId,
      personObservationIndex,
    });
    const paging = page(offset, limit);
    const event = await this.loadScopedEvent(this.dataSource.manager, scope);
    const head = await this.dataSource
      .getRepository(ObservationIdentityResolutionEntity)
      .findOneBy({
        eventId: scope.eventId,
        personObservationIndex: scope.personObservationIndex,
        siteId: scope.siteId,
      });
    if (!head) return { items: [], total: 0 };
    this.assertHeadSubjectScope(head, event, scope.personObservationIndex);
    const [items, total] = await this.dataSource
      .getRepository(ObservationIdentityDecisionEntity)
      .findAndCount({
        where: { resolutionId: head.id, siteId: scope.siteId },
        order: { revision: 'ASC', id: 'ASC' },
        skip: paging.offset,
        take: paging.limit,
      });
    return { items, total };
  }

  /** Feature-internal snapshot, never an HTTP response: raw evidence is projected by context. */
  async readContextRecords(
    siteId: string,
    alertId: string,
    eventId: string,
  ): Promise<ObservationIdentityContextRecords> {
    const scope = normalizeObservationIdentitySubjectScope({
      siteId,
      alertId,
      eventId,
      personObservationIndex: 0,
    });
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const event = await this.loadScopedEvent(manager, scope);
      const heads = await manager.getRepository(ObservationIdentityResolutionEntity).find({
        where: { eventId: scope.eventId, siteId: scope.siteId },
        order: { personObservationIndex: 'ASC' },
        take: 256,
      });
      const ids = heads.flatMap((head) => (head.currentDecisionId ? [head.currentDecisionId] : []));
      const decisions = ids.length
        ? await manager
            .getRepository(ObservationIdentityDecisionEntity)
            .findBy({ id: In(ids), siteId: scope.siteId })
        : [];
      const byId = new Map(decisions.map((decision) => [decision.id, decision]));
      return {
        event,
        heads: heads.map((head) => ({
          head,
          decision: head.currentDecisionId ? (byId.get(head.currentDecisionId) ?? null) : null,
        })),
      };
    });
  }

  private async lock(manager: EntityManager, key: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  }

  private async findReplay(
    scope: ObservationIdentityCommandScope,
    command: ObservationIdentityDecisionCommand,
    hash: string,
  ): Promise<ObservationIdentityDecisionResult | null> {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, `identity-command:${command.commandId}`);
      const event = await this.loadScopedEvent(manager, scope);
      if (event.payloadHash !== command.expectedEventHash)
        conflict('Observation identity event hash has changed');
      return this.replay(manager, scope, command, hash, event);
    });
  }

  private async replay(
    manager: EntityManager,
    scope: ObservationIdentityCommandScope,
    command: ObservationIdentityDecisionCommand,
    hash: string,
    event: AiObservationEventEntity,
  ): Promise<ObservationIdentityDecisionResult | null> {
    const decision = await manager
      .getRepository(ObservationIdentityDecisionEntity)
      .findOneBy({ id: command.commandId });
    if (!decision) return null;
    if (decision.commandHash !== hash || decision.siteId !== scope.siteId)
      conflict('Observation identity command was already used');
    const head = await manager.getRepository(ObservationIdentityResolutionEntity).findOneBy({
      id: decision.resolutionId,
      siteId: scope.siteId,
      eventId: scope.eventId,
      personObservationIndex: scope.personObservationIndex,
    });
    if (!head || head.payloadHash !== command.expectedEventHash)
      conflict('Observation identity scope is inconsistent');
    this.assertHeadSubjectScope(head, event, scope.personObservationIndex);
    return { decision, latestHead: head, replayed: true };
  }

  private assertHeadSubjectScope(
    head: ObservationIdentityResolutionEntity,
    event: AiObservationEventEntity,
    index: number,
  ): void {
    const ref = projectObservationSubjectRef(head.subjectRef);
    if (
      head.payloadHash !== event.payloadHash ||
      !ref ||
      !observationSubjectRefMatchesEvent(ref, event, index)
    )
      conflict('Observation identity scope is inconsistent');
  }

  private async loadScopedEvent(
    manager: EntityManager,
    scope: Pick<ObservationIdentityCommandScope, 'siteId' | 'alertId' | 'eventId'>,
  ): Promise<AiObservationEventEntity> {
    const alert = await manager
      .getRepository(SafetyAlertEntity)
      .findOneBy({ id: scope.alertId, siteId: scope.siteId });
    if (!alert) return missing();
    const mapping = await manager
      .getRepository(AlertDetectionMappingEntity)
      .findOneBy({ alertId: scope.alertId, eventId: scope.eventId });
    if (!mapping) return missing();
    const event = await manager
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: scope.eventId });
    if (!event) return missing();
    const contradictory = await manager.query<{ conflicting: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM alert_detection_mapping m JOIN safety_alert a ON a.id=m.alert_id WHERE m.event_id=$1 AND a.site_id<>$2) AS conflicting',
      [scope.eventId, scope.siteId],
    );
    if (contradictory[0]?.conflicting) conflict('Observation identity scope is inconsistent');
    return event;
  }

  private selectSubjectRef(
    event: AiObservationEventEntity,
    scope: ObservationIdentityCommandScope,
    expectedHash: string,
  ): ObservationSubjectRef {
    const raw = event.rawPayload;
    if (
      !reviewEventIsConsistent(event) ||
      event.payloadHash !== expectedHash ||
      computeCanonicalPayloadHash(raw) !== expectedHash
    )
      conflict('Observation identity evidence is inconsistent');
    const header = raw as {
      eventId: string;
      cameraExternalId: string;
      streamSessionId: string;
      capturedAt: string;
    };
    if (
      header.eventId.toLowerCase() !== scope.eventId ||
      header.cameraExternalId !== event.cameraExternalId ||
      header.streamSessionId.toLowerCase() !== event.streamSessionId.toLowerCase() ||
      !event.resolvedCameraId
    )
      conflict('Observation identity evidence is inconsistent');
    const subject = selectObservationSubject(raw, scope.personObservationIndex);
    if (!subject.eligible) conflict('Observation PERSON subject is unavailable');
    return {
      eventId: scope.eventId,
      personObservationIndex: scope.personObservationIndex,
      payloadHash: expectedHash,
      cameraId: event.resolvedCameraId,
      cameraExternalId: header.cameraExternalId,
      streamSessionId: header.streamSessionId,
      capturedAt: header.capturedAt,
      trackId: subject.trackId,
      personBoundingBox: subject.personBoundingBox,
    };
  }
}
