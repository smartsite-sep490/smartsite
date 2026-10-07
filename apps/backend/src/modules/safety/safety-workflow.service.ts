import { SchedulingNotificationService } from '../workforce/scheduling-notification.service.js';
import type { StoredObject } from '../../integrations/storage/storage.service.js';
import { WorkforceConfigurationService } from '../workforce/workforce-configuration.service.js';
import { reviewRawEventIsConsistent } from './identity/observation-identity-event.js';
import { observationSubjectRefMatchesEvent } from './identity/observation-identity-subject-ref.js';
import { AiObservationEventEntity } from '../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../database/entities/alert-detection-mapping.entity.js';
import { ObservationIdentityResolutionEntity } from '../../database/entities/observation-identity-resolution.entity.js';
import { ObservationIdentityDecisionEntity } from '../../database/entities/observation-identity-decision.entity.js';
import { buildGroupingKey } from './alerts/alert-candidate-evaluator.js';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';
import {
  computeCanonicalPayloadHash,
  type IncidentDetailResponse,
  type IncidentResponse,
  type SafetyTaskDetailResponse,
  type SafetyTaskResponse,
  type SafetyAuditResponse,
  type WorkflowMutationResponse,
  type SafetyEvidenceResponse,
} from '@smartsite/contracts';
import {
  command,
  conflict,
  invalid,
  missing,
  page,
  uuid,
} from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  IncidentEntity,
  IncidentWorkerEntity,
  CorrectiveActionEntity,
  CorrectiveActionSubmissionEntity,
  SafetyTaskEntity,
  SafetyEvidenceEntity,
  SafetyWorkflowAuditEntity,
} from '../../database/entities/safety-workflow.entity.js';
import { SafetyAlertEntity } from '../../database/entities/safety-alert.entity.js';
import { AlertStatus } from '../../database/entities/enums.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { UsersService } from '../users/users.service.js';
import { ZoneConfigurationService } from '../zones/zone-configuration.service.js';
import { canCloseIncident, incidentStatus } from './workflow-policy.js';
import {
  SafetyUploadService,
  validateSafetyJpeg,
  type SafetyUpload,
} from './safety-upload.service.js';
import {
  CorrectResponsibilityDto,
  ConfirmResponsibilityDto,
  TransferActionDto,
  CreateIncidentDto,
  LinkAlertsDto,
  AssignActionDto,
  VersionCommandDto,
  SubmitResultDto,
  ReviewSubmissionDto,
  ReasonCommandDto,
  ReopenIncidentDto,
  CreateSafetyTaskDto,
  WorkflowCommand,
} from './safety-workflow.commands.js';

const denied = (): never => {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
};
const has = (user: AuthenticatedUser, siteId: string | null, role: UserRole) =>
  user.roleAssignments.some((r) => r.role === role && r.siteId === siteId);
const admin = (user: AuthenticatedUser) => has(user, null, UserRole.ADMIN);
const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
const incidentStates = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'VERIFIED', 'CLOSED', 'REOPENED'];
const taskStates = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'];
export type IncidentOperation =
  | 'link'
  | 'responsibility'
  | 'correct-responsibility'
  | 'transfer'
  | 'assign'
  | 'start'
  | 'submit'
  | 'review'
  | 'close'
  | 'reopen';
export type TaskOperation = 'start' | 'submit' | 'verify' | 'return' | 'cancel';
type EvidenceStage = { saved?: StoredObject; changes?: Record<string, unknown> };
const required = (actor: AuthenticatedUser, site: string, role: UserRole) => {
  if (!has(actor, site, role)) denied();
};
function filterStatus(value: string | undefined, allowed: string[]) {
  if (value !== undefined && !allowed.includes(value)) invalid('Invalid status filter');
  return value;
}

@Injectable()
export class SafetyWorkflowService {
  constructor(
    private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly zones: ZoneConfigurationService,
    private readonly uploads: SafetyUploadService,
    private readonly workforce: WorkforceConfigurationService,
    private readonly notifications: SchedulingNotificationService = new SchedulingNotificationService(
      db,
    ),
  ) {}
  private async actor(manager: EntityManager, actorId: string, siteId: string) {
    uuid(siteId);
    const actor = await this.users.safetyActor(manager, actorId);
    return actor;
  }
  private readIncident(actor: AuthenticatedUser, siteId: string) {
    if (
      !admin(actor) &&
      ![UserRole.SAFETY_OFFICER, UserRole.SITE_MANAGER, UserRole.CONTRACTOR_REPRESENTATIVE].some(
        (role) => has(actor, siteId, role),
      )
    )
      denied();
  }
  private fullIncident(actor: AuthenticatedUser, siteId: string) {
    return (
      admin(actor) ||
      has(actor, siteId, UserRole.SAFETY_OFFICER) ||
      has(actor, siteId, UserRole.SITE_MANAGER)
    );
  }
  private readTask(actor: AuthenticatedUser, task: SafetyTaskEntity) {
    if (
      !admin(actor) &&
      !has(actor, task.siteId, UserRole.SITE_MANAGER) &&
      !(has(actor, task.siteId, UserRole.SAFETY_OFFICER) && task.assignedTo === actor.id)
    )
      denied();
  }
  private async incident(
    manager: EntityManager,
    siteId: string,
    id: string,
    lock: false | true | 'pessimistic_read' = false,
  ) {
    const value = await manager.getRepository(IncidentEntity).findOne({
      where: { id: uuid(id), siteId: uuid(siteId) },
      ...(lock
        ? {
            lock: {
              mode:
                lock === 'pessimistic_read'
                  ? ('pessimistic_read' as const)
                  : ('pessimistic_write' as const),
            },
          }
        : {}),
    });
    return value ?? missing();
  }
  private async task(
    manager: EntityManager,
    siteId: string,
    id: string,
    lock: false | true | 'pessimistic_read' = false,
  ) {
    const value = await manager.getRepository(SafetyTaskEntity).findOne({
      where: { id: uuid(id), siteId: uuid(siteId) },
      ...(lock
        ? {
            lock: {
              mode:
                lock === 'pessimistic_read'
                  ? ('pessimistic_read' as const)
                  : ('pessimistic_write' as const),
            },
          }
        : {}),
    });
    return value ?? missing();
  }
  private version(current: number, expected: number) {
    if (current !== expected) conflict('Data changed. Reload before retrying.');
  }
  private auditResponse(
    row: SafetyWorkflowAuditEntity,
    names: Record<string, string> = {},
    restricted = false,
  ): SafetyAuditResponse {
    const { id, actorId, action, resourceType, resourceId, reason, occurredAt } = row;
    const changes = restricted
      ? Object.fromEntries(
          Object.entries(row.changes).filter(([key]) =>
            [
              'actionId',
              'assignedTo',
              'assignedToName',
              'description',
              'dueAt',
              'resultDescription',
              'decision',
              'reason',
              'version',
              'contractorName',
            ].includes(key),
          ),
        )
      : row.changes;
    const actorName =
      typeof row.changes.actorName === 'string' ? row.changes.actorName : (names[actorId] ?? null);
    return json({
      id,
      actorId,
      actorName,
      action,
      resourceType,
      resourceId,
      reason,
      changes,
      occurredAt,
    });
  }
  private async audits(
    manager: EntityManager,
    siteId: string,
    resourceType: 'INCIDENT' | 'SAFETY_TASK',
    resourceId: string,
  ) {
    return manager.getRepository(SafetyWorkflowAuditEntity).find({
      where: { siteId, resourceType, resourceId },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
  }
  private evidenceResponse(row: SafetyEvidenceEntity): SafetyEvidenceResponse {
    return { id: row.id, mediaType: 'image/jpeg', size: row.size };
  }
  private async incidentDetail(
    manager: EntityManager,
    incident: IncidentEntity,
    actor: AuthenticatedUser,
  ): Promise<IncidentDetailResponse> {
    this.readIncident(actor, incident.siteId);
    const all = await manager
      .getRepository(CorrectiveActionEntity)
      .find({ where: { incidentId: incident.id }, order: { createdAt: 'ASC', id: 'ASC' } });
    const full = this.fullIncident(actor, incident.siteId);
    if (
      !full &&
      (!incident.contractorId ||
        !(await this.workforce.incidentRepresentativeAllowed(
          manager,
          incident.siteId,
          incident.contractorId,
          actor.id,
        )))
    )
      denied();
    const actions = full ? all : all.filter((a) => a.assignedTo === actor.id && !a.supersededAt);
    if (!full && !actions.length) denied();
    const submissions = actions.length
      ? await manager.getRepository(CorrectiveActionSubmissionEntity).find({
          where: { correctiveActionId: In(actions.map((a) => a.id)) },
          order: { submittedAt: 'ASC', id: 'ASC' },
        })
      : [];
    const evidenceIds = submissions.flatMap((s) => (s.evidenceId ? [s.evidenceId] : []));
    const evidence = evidenceIds.length
      ? await manager
          .getRepository(SafetyEvidenceEntity)
          .findBy({ id: In(evidenceIds), siteId: incident.siteId })
      : [];
    const alerts = await manager.getRepository(SafetyAlertEntity).find({
      where: { incidentId: incident.id, siteId: incident.siteId },
      order: { firstDetectedAt: 'ASC', id: 'ASC' },
    });
    const audit = (await this.audits(manager, incident.siteId, 'INCIDENT', incident.id)).filter(
      (a) => full || actions.some((action) => action.id === a.changes.actionId),
    );
    const names = await this.users.displayNames(manager, [
      incident.reportedBy,
      incident.closedBy,
      incident.responsibilityConfirmedBy,
      ...actions.flatMap((a) => [a.assignedTo, a.assignedBy]),
      ...submissions.flatMap((s) => [s.submittedBy, s.reviewedBy]),
      ...audit.map((a) => a.actorId),
    ]);
    const workerIds = (
      await manager.getRepository(IncidentWorkerEntity).findBy({ incidentId: incident.id })
    )
      .map((row) => row.workerId)
      .sort();
    const labels = await this.workforce.incidentLabels(
      manager,
      incident.siteId,
      incident.contractorId,
      workerIds,
    );
    const zoneName = await this.zones.referenceName(incident.siteId, incident.zoneId);
    return json({
      ...incident,
      ...labels,
      zoneName,
      workerIds,
      reportedByName: names[incident.reportedBy] ?? null,
      closedByName: incident.closedBy ? (names[incident.closedBy] ?? null) : null,
      responsibilityConfirmedByName: incident.responsibilityConfirmedBy
        ? (names[incident.responsibilityConfirmedBy] ?? null)
        : null,
      alerts: alerts.map((a) => ({
        id: a.id,
        siteId: a.siteId,
        zoneId: a.zoneId,
        incidentId: a.incidentId,
        candidateWorkerId: a.candidateWorkerId,
        alertType: a.alertType,
        candidateSubtype: a.candidateSubtype,
        status: a.status,
        firstDetectedAt: a.firstDetectedAt,
        lastDetectedAt: a.lastDetectedAt,
        detectionCount: a.detectionCount,
        revision: a.revision,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      actions: actions.map((a) => ({
        ...a,
        assignedToName: names[a.assignedTo] ?? null,
        assignedByName: names[a.assignedBy] ?? null,
        submissions: submissions
          .filter((s) => s.correctiveActionId === a.id)
          .map((s) => {
            const { evidenceId, ...safe } = s;
            const file = evidence.find((e) => e.id === evidenceId);
            return {
              ...safe,
              submittedByName: names[s.submittedBy] ?? null,
              reviewedByName: s.reviewedBy ? (names[s.reviewedBy] ?? null) : null,
              evidence: file ? this.evidenceResponse(file) : null,
            };
          }),
      })),
      audit: audit.map((a) => this.auditResponse(a, names, !full)),
    });
  }
  private async taskDetail(
    manager: EntityManager,
    task: SafetyTaskEntity,
    actor: AuthenticatedUser,
  ): Promise<SafetyTaskDetailResponse> {
    this.readTask(actor, task);
    const { resultEvidenceId, ...safe } = task;
    const audits = await this.audits(manager, task.siteId, 'SAFETY_TASK', task.id);
    const names = await this.users.displayNames(manager, [
      task.assignedTo,
      task.assignedBy,
      task.verifiedBy,
      ...audits.map((a) => a.actorId),
    ]);
    const evidence = resultEvidenceId
      ? await manager
          .getRepository(SafetyEvidenceEntity)
          .findOneBy({ id: resultEvidenceId, siteId: task.siteId })
      : null;
    return json({
      ...safe,
      assignedToName: names[task.assignedTo] ?? null,
      assignedByName: names[task.assignedBy] ?? null,
      verifiedByName: task.verifiedBy ? (names[task.verifiedBy] ?? null) : null,
      zoneName: await this.zones.referenceName(task.siteId, task.zoneId),
      resultEvidence: evidence ? this.evidenceResponse(evidence) : null,
      audit: audits.map((a) => this.auditResponse(a, names)),
    });
  }
  /** One receipt and audit per command, committed atomically with the business change. */
  private async execute<T extends IncidentDetailResponse | SafetyTaskDetailResponse>(
    siteId: string,
    actorId: string,
    resourceType: 'INCIDENT' | 'SAFETY_TASK',
    resourceId: string | null,
    action: string,
    input: WorkflowCommand,
    role: UserRole,
    file: SafetyUpload | undefined,
    work: (manager: EntityManager, actor: AuthenticatedUser, stage: EvidenceStage) => Promise<T>,
  ): Promise<WorkflowMutationResponse<T>> {
    const stage: EvidenceStage = {};
    const uploadHash = file ? validateSafetyJpeg(file) : null;
    const inputHash = computeCanonicalPayloadHash({
      siteId,
      actorId,
      resourceType,
      resourceId,
      action,
      input: json<Record<string, unknown>>(input),
      uploadHash,
    });
    // Authorize and validate state before object I/O; validate again under the final lock.
    if (file) {
      const replay = await this.db.transaction(async (manager) => {
        const actor = await this.actor(manager, actorId, siteId);
        required(actor, siteId, role);
        const receipt = await manager
          .getRepository(SafetyWorkflowAuditEntity)
          .findOneBy({ commandId: input.commandId });
        if (receipt) {
          if (receipt.inputHash !== inputHash)
            conflict('Command ID already used with different input');
          return { resource: await this.replay<T>(manager, actor, receipt), replayed: true };
        }
        await this.uploadTarget(manager, actor, siteId, resourceType, resourceId!, input);
        return null;
      });
      if (replay) return replay;
      stage.saved = await this.uploads.save(file);
    }
    try {
      const result = await this.db.transaction(async (manager) => {
        const actor = await this.actor(manager, actorId, siteId);
        required(actor, siteId, role);
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'mf08-command:' + input.commandId,
        ]);
        const receipt = await manager
          .getRepository(SafetyWorkflowAuditEntity)
          .findOneBy({ commandId: input.commandId });
        if (receipt) {
          if (receipt.inputHash !== inputHash)
            conflict('Command ID already used with different input');
          const resource = await this.replay<T>(manager, actor, receipt);
          return { resource, replayed: true };
        }
        const resource = await work(manager, actor, stage);
        const changes: Record<string, unknown> = {
          ...json<Record<string, unknown>>(input),
          version: resource.version,
        };
        // Store only evidence references; never file bytes or private storage keys.
        Object.assign(changes, stage.changes, { actorName: actor.displayName });
        const audit = manager.getRepository(SafetyWorkflowAuditEntity).create({
          id: randomUUID(),
          commandId: input.commandId,
          actorId,
          siteId,
          resourceType,
          resourceId: resource.id,
          action,
          reason: 'reason' in input ? String(input.reason) : null,
          inputHash,
          changes,
          result: {} as Record<string, unknown>,
          occurredAt: new Date(),
        });
        resource.audit.push(this.auditResponse(audit));
        // ponytail: snapshots preserve exact retries; compact receipts when long case histories exceed local storage budgets.
        audit.result = json<Record<string, unknown>>(resource);
        await manager.getRepository(SafetyWorkflowAuditEntity).save(audit);
        return { resource, replayed: false };
      });
      if (result.replayed && stage.saved) await this.uploads.remove(stage.saved);
      return result;
    } catch (error) {
      if (stage.saved) await this.uploads.remove(stage.saved);
      throw error;
    }
  }
  private async replay<T extends IncidentDetailResponse | SafetyTaskDetailResponse>(
    manager: EntityManager,
    actor: AuthenticatedUser,
    receipt: SafetyWorkflowAuditEntity,
  ): Promise<T> {
    const snapshot =
      receipt.resourceType === 'INCIDENT'
        ? ({
            contractorId: null,
            responsibilityReason: null,
            responsibilityConfirmedBy: null,
            responsibilityConfirmedAt: null,
            workerIds: [],
            ...receipt.result,
          } as unknown as T)
        : (receipt.result as unknown as T);
    if (receipt.resourceType === 'INCIDENT') {
      const current = await this.incidentDetail(
        manager,
        await this.incident(manager, receipt.siteId, receipt.resourceId),
        actor,
      );
      if (!this.fullIncident(actor, receipt.siteId)) {
        const saved = snapshot as IncidentDetailResponse;
        const actions = saved.actions.filter(
          (a) =>
            current.actions.some((c) => c.id === a.id && c.assignedTo === actor.id) &&
            a.assignedTo === actor.id,
        );
        if (!actions.length) denied();
        return {
          ...saved,
          actions,
          audit: saved.audit.filter((a) => actions.some((c) => c.id === a.changes.actionId)),
        } as T;
      }
    } else this.readTask(actor, await this.task(manager, receipt.siteId, receipt.resourceId));
    return snapshot;
  }
  private async uploadTarget(
    manager: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    type: 'INCIDENT' | 'SAFETY_TASK',
    id: string,
    input: WorkflowCommand,
  ) {
    const expected = (input as VersionCommandDto).expectedVersion;
    if (type === 'INCIDENT') {
      const incident = await this.incident(manager, siteId, id);
      if (incident.status === 'CLOSED') conflict('Incident is closed');
      await this.requireRepresentative(manager, incident, actor.id);
      const action = await manager.getRepository(CorrectiveActionEntity).findOneBy({
        id: (input as WorkflowCommand & { actionId: string }).actionId,
        incidentId: id,
        assignedTo: actor.id,
      });
      if (!action || action.supersededAt) denied();
      this.version(action!.version, expected);
      if (action!.status !== 'IN_PROGRESS') conflict('Action must be in progress');
    } else {
      const task = await this.task(manager, siteId, id);
      this.readTask(actor, task);
      if (task.assignedTo !== actor.id) denied();
      this.version(task.version, expected);
      if (task.status !== 'IN_PROGRESS') conflict('Task must be in progress');
    }
  }
  private async requireRepresentative(
    manager: EntityManager,
    incident: IncidentEntity,
    userId: string,
  ) {
    if (!incident.contractorId)
      conflict('Confirm Incident responsibility before assigning corrective work');
    if (
      !(await this.workforce.incidentRepresentativeAllowed(
        manager,
        incident.siteId,
        incident.contractorId,
        userId,
      ))
    )
      denied();
  }
  private async saveEvidence(
    manager: EntityManager,
    siteId: string,
    actorId: string,
    file: SafetyUpload | undefined,
    stage: EvidenceStage,
  ) {
    if (!file) return null;
    const saved = stage.saved;
    if (!saved) conflict('Upload was not staged');
    const evidence = await manager
      .getRepository(SafetyEvidenceEntity)
      .save({ id: randomUUID(), siteId, uploadedBy: actorId, ...saved });
    return evidence.id;
  }
  private async confirmedAlertWorkers(
    manager: EntityManager,
    siteId: string,
    alerts: SafetyAlertEntity[],
  ) {
    if (!alerts.length) return [];
    const mappings = await manager
      .getRepository(AlertDetectionMappingEntity)
      .findBy({ alertId: In(alerts.map((a) => a.id)) });
    if (!mappings.length) return [];
    const heads = await manager.getRepository(ObservationIdentityResolutionEntity).find({
      where: { siteId, eventId: In(mappings.map((m) => m.eventId)) },
      lock: { mode: 'pessimistic_read' },
    });
    const ids = new Set<string>();
    for (const head of heads) {
      const ref = head.subjectRef;
      const relevant = alerts.some(
        (a) =>
          mappings.some((m) => m.alertId === a.id && m.eventId === head.eventId) &&
          a.groupingKey ===
            buildGroupingKey(
              a.candidateSubtype,
              ref.cameraId,
              ref.streamSessionId,
              a.zoneId ?? undefined,
              ref.trackId,
            ),
      );
      if (!relevant || !head.currentDecisionId) continue;
      const event = await manager
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: head.eventId });
      if (
        !event ||
        !reviewRawEventIsConsistent(event) ||
        !observationSubjectRefMatchesEvent(ref, event, head.personObservationIndex)
      )
        conflict(
          'Reviewed observation identity is inconsistent; review source evidence before linking',
        );
      const decision = await manager.getRepository(ObservationIdentityDecisionEntity).findOneBy({
        id: head.currentDecisionId,
        resolutionId: head.id,
        revision: head.revision,
        siteId,
      });
      if (decision?.action === 'RESOLVE' && decision.workerId) ids.add(decision.workerId);
    }
    return [...ids].sort();
  }
  private async validateLinkedSubjects(manager: EntityManager, incident: IncidentEntity) {
    const alerts = await manager
      .getRepository(SafetyAlertEntity)
      .findBy({ incidentId: incident.id, siteId: incident.siteId });
    const workerIds = await this.confirmedAlertWorkers(manager, incident.siteId, alerts);
    if (incident.contractorId) {
      await this.workforce.requireIncidentWorkers(
        manager,
        incident.siteId,
        incident.contractorId,
        workerIds,
      );
      if (workerIds.length)
        await manager.getRepository(IncidentWorkerEntity).upsert(
          workerIds.map((workerId) => ({ incidentId: incident.id, workerId })),
          ['incidentId', 'workerId'],
        );
    } else
      await this.workforce.requireSingleIncidentContractor(manager, incident.siteId, workerIds);
    return workerIds;
  }
  private async link(manager: EntityManager, siteId: string, incidentId: string, ids: string[]) {
    for (const id of [...new Set(ids.map((id) => uuid(id).toLowerCase()))].sort()) {
      const alert = await manager
        .getRepository(SafetyAlertEntity)
        .findOne({ where: { id, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!alert) missing();
      if (alert.status !== AlertStatus.CONFIRMED) conflict('Only confirmed alerts can be linked');
      if (alert.incidentId && alert.incidentId !== incidentId)
        conflict('Alert already belongs to another Incident');
      await manager.getRepository(SafetyAlertEntity).update(alert.id, { incidentId });
    }
  }
  async createIncident(siteId: string, actorId: string, input: unknown) {
    const value = command(CreateIncidentDto, input);
    if (value.zoneId) await this.zones.get(siteId, value.zoneId);
    return this.execute(
      siteId,
      actorId,
      'INCIDENT',
      null,
      'create',
      value,
      UserRole.SAFETY_OFFICER,
      undefined,
      async (manager, actor) => {
        if (value.contractorId) {
          if (!value.responsibilityReason)
            invalid('A reason is required to confirm responsibility');
          await this.workforce.requireIncidentWorkers(
            manager,
            siteId,
            value.contractorId,
            value.workerIds ?? [],
          );
        } else if (value.responsibilityReason || value.workerIds?.length)
          invalid('Confirm contractor before adding Worker subjects');
        const incident = await manager.getRepository(IncidentEntity).save({
          id: randomUUID(),
          siteId: uuid(siteId),
          zoneId: value.zoneId ?? null,
          contractorId: value.contractorId ?? null,
          responsibilityReason: value.responsibilityReason ?? null,
          responsibilityConfirmedBy: value.contractorId ? actor.id : null,
          responsibilityConfirmedAt: value.contractorId ? new Date() : null,
          title: value.title,
          description: value.description,
          severity: value.severity,
          status: 'OPEN',
          occurredAt: new Date(value.occurredAt),
          reportedBy: actor.id,
          closedBy: null,
          closedAt: null,
          version: 1,
        });
        if (value.workerIds?.length)
          await manager
            .getRepository(IncidentWorkerEntity)
            .save(value.workerIds.map((workerId) => ({ incidentId: incident.id, workerId })));
        await this.link(manager, siteId, incident.id, value.alertIds);
        await this.validateLinkedSubjects(manager, incident);
        return this.incidentDetail(manager, incident, actor);
      },
    );
  }
  async incidentCommand(
    siteId: string,
    id: string,
    actorId: string,
    operation: IncidentOperation,
    input: unknown,
    actionId?: string,
    file?: SafetyUpload,
  ) {
    const role =
      operation === 'start' || operation === 'submit'
        ? UserRole.CONTRACTOR_REPRESENTATIVE
        : UserRole.SAFETY_OFFICER;
    const value =
      operation === 'correct-responsibility'
        ? command(CorrectResponsibilityDto, input)
        : operation === 'responsibility'
          ? command(ConfirmResponsibilityDto, input)
          : operation === 'transfer'
            ? command(TransferActionDto, input)
            : operation === 'link'
              ? command(LinkAlertsDto, input)
              : operation === 'assign'
                ? command(AssignActionDto, input)
                : operation === 'submit'
                  ? command(SubmitResultDto, input)
                  : operation === 'review'
                    ? command(ReviewSubmissionDto, input)
                    : operation === 'reopen'
                      ? command(ReopenIncidentDto, input)
                      : operation === 'close'
                        ? command(ReasonCommandDto, input)
                        : command(VersionCommandDto, input);
    const resourceId = uuid(id);
    if (actionId) actionId = uuid(actionId);
    // Include the action path in the fingerprint so its command cannot be replayed against another action.
    const fingerprint = { ...value, ...(actionId ? { actionId } : {}) };
    return this.execute(
      siteId,
      actorId,
      'INCIDENT',
      resourceId,
      operation,
      fingerprint,
      role,
      file,
      async (manager, actor, stage) => {
        const incident = await this.incident(manager, siteId, resourceId, true);
        const actions = await manager
          .getRepository(CorrectiveActionEntity)
          .find({ where: { incidentId: incident.id }, order: { id: 'ASC' } });
        let touched: CorrectiveActionEntity | undefined,
          evidenceId: string | null = null;
        if (['start', 'submit', 'review', 'transfer'].includes(operation)) {
          touched = actions.find((a) => a.id === actionId) ?? missing();
          if (touched.supersededAt) conflict('This handover has been superseded');
          if (['start', 'submit'].includes(operation)) {
            if (touched.assignedTo !== actor.id) denied();
            await this.requireRepresentative(manager, incident, actor.id);
          }
          this.version(touched.version, value.expectedVersion);
        } else this.version(incident.version, value.expectedVersion);
        if (
          incident.status === 'CLOSED' &&
          operation !== 'reopen' &&
          operation !== 'correct-responsibility' &&
          !(operation === 'responsibility' && !incident.contractorId)
        )
          conflict('Incident is closed');
        if (operation === 'correct-responsibility') {
          const corrected = value as CorrectResponsibilityDto;
          await this.workforce.requireIncidentWorkers(
            manager,
            siteId,
            corrected.contractorId,
            corrected.workerIds,
          );
          const previous = await this.workforce.incidentLabels(
            manager,
            siteId,
            incident.contractorId,
            [],
          );
          stage.changes = {
            previousContractorId: incident.contractorId,
            previousContractorName: previous.contractorName,
          };
          const wasClosed = incident.status === 'CLOSED';
          incident.contractorId = corrected.contractorId;
          incident.responsibilityReason = corrected.reason;
          incident.responsibilityConfirmedBy = actor.id;
          incident.responsibilityConfirmedAt = new Date();
          await manager.getRepository(IncidentWorkerEntity).delete({ incidentId: incident.id });
          if (corrected.workerIds.length)
            await manager
              .getRepository(IncidentWorkerEntity)
              .save(corrected.workerIds.map((workerId) => ({ incidentId: incident.id, workerId })));
          await this.validateLinkedSubjects(manager, incident);
          await this.requireRepresentative(manager, incident, corrected.assignedTo);
          for (const old of actions.filter((a) => !a.supersededAt)) {
            old.supersededAt = new Date();
            old.supersededBy = actor.id;
            old.supersededReason = corrected.reason;
            old.version++;
            await manager.getRepository(CorrectiveActionEntity).save(old);
          }
          touched = await manager
            .getRepository(CorrectiveActionEntity)
            .save({
              id: randomUUID(),
              incidentId: incident.id,
              assignedTo: corrected.assignedTo,
              assignedBy: actor.id,
              description: corrected.description,
              dueAt: corrected.dueAt ? new Date(corrected.dueAt) : null,
              status: 'ASSIGNED',
              version: 1,
            });
          actions.push(touched);
          incident.status = wasClosed ? 'REOPENED' : 'ASSIGNED';
          incident.closedAt = null;
          incident.closedBy = null;
        }
        if (operation === 'responsibility') {
          const responsibility = value as ConfirmResponsibilityDto;
          if (
            incident.contractorId &&
            incident.contractorId !== responsibility.contractorId &&
            actions.length
          )
            conflict('A contractor cannot be changed after corrective work has been assigned');
          await this.workforce.requireIncidentWorkers(
            manager,
            siteId,
            responsibility.contractorId,
            responsibility.workerIds,
          );
          incident.contractorId = responsibility.contractorId;
          incident.responsibilityReason = responsibility.reason;
          incident.responsibilityConfirmedBy = actor.id;
          incident.responsibilityConfirmedAt = new Date();
          await manager.getRepository(IncidentWorkerEntity).delete({ incidentId: incident.id });
          if (responsibility.workerIds.length)
            await manager
              .getRepository(IncidentWorkerEntity)
              .save(
                responsibility.workerIds.map((workerId) => ({ incidentId: incident.id, workerId })),
              );
          await this.validateLinkedSubjects(manager, incident);
        }
        if (operation === 'transfer') {
          if (['VERIFIED', 'CLOSED'].includes(touched!.status))
            conflict('Verified historical work cannot be transferred');
          if (
            touched!.status === 'SUBMITTED' ||
            (await manager
              .getRepository(CorrectiveActionSubmissionEntity)
              .existsBy({ correctiveActionId: touched!.id, status: 'PENDING' }))
          )
            conflict('Review the pending submission before transferring responsibility');
          await this.requireRepresentative(
            manager,
            incident,
            (value as TransferActionDto).assignedTo,
          );
          stage.changes = { previousAssignedTo: touched!.assignedTo };
          touched!.assignedTo = (value as TransferActionDto).assignedTo;
          touched!.assignedBy = actor.id;
          touched!.status = 'ASSIGNED';
        }
        if (operation === 'link') {
          await this.link(manager, siteId, incident.id, (value as LinkAlertsDto).alertIds);
          await this.validateLinkedSubjects(manager, incident);
        }
        if (operation === 'assign' || operation === 'reopen') {
          const assignment = value as AssignActionDto;
          if (operation === 'reopen' && incident.status !== 'CLOSED')
            conflict('Only closed incidents may be reopened');
          await this.requireRepresentative(manager, incident, assignment.assignedTo);
          touched = await manager.getRepository(CorrectiveActionEntity).save({
            id: randomUUID(),
            incidentId: incident.id,
            assignedTo: assignment.assignedTo,
            assignedBy: actor.id,
            description: assignment.description,
            dueAt: assignment.dueAt ? new Date(assignment.dueAt) : null,
            status: 'ASSIGNED',
            version: 1,
          });
          actions.push(touched);
          if (operation === 'reopen') {
            incident.status = 'REOPENED';
            incident.closedAt = null;
            incident.closedBy = null;
          }
        }
        if (operation === 'start') {
          if (touched!.status !== 'ASSIGNED') conflict('Action must be assigned');
          touched!.status = 'IN_PROGRESS';
        }
        if (operation === 'submit') {
          if (touched!.status !== 'IN_PROGRESS') conflict('Action must be in progress');
          if (
            await manager
              .getRepository(CorrectiveActionSubmissionEntity)
              .existsBy({ correctiveActionId: touched!.id, status: 'PENDING' })
          )
            conflict('Submission already awaiting review');
          evidenceId = await this.saveEvidence(manager, siteId, actor.id, file, stage);
          await manager.getRepository(CorrectiveActionSubmissionEntity).save({
            id: randomUUID(),
            correctiveActionId: touched!.id,
            submittedBy: actor.id,
            resultDescription: (value as SubmitResultDto).resultDescription,
            evidenceId,
            submittedAt: new Date(),
            status: 'PENDING',
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
          });
          touched!.status = 'SUBMITTED';
        }
        if (operation === 'review') {
          const review = value as ReviewSubmissionDto;
          const submission = await manager.getRepository(CorrectiveActionSubmissionEntity).findOne({
            where: { id: review.submissionId, correctiveActionId: touched!.id },
            lock: { mode: 'pessimistic_write' },
          });
          if (!submission) missing();
          if (submission.submittedBy === actor.id) denied();
          if (touched!.status !== 'SUBMITTED' || submission.status !== 'PENDING')
            conflict('Submission already reviewed');
          await manager.getRepository(CorrectiveActionSubmissionEntity).update(submission.id, {
            status: review.decision,
            reviewedBy: actor.id,
            reviewedAt: new Date(),
            reviewNote: review.reason,
          });
          touched!.status = review.decision === 'APPROVED' ? 'VERIFIED' : 'IN_PROGRESS';
        }
        if (touched && ['start', 'submit', 'review', 'transfer'].includes(operation)) {
          touched.version++;
          await manager.getRepository(CorrectiveActionEntity).save(touched);
        }
        const currentActions = actions.filter((a) => !a.supersededAt);
        if (operation === 'close') {
          if (!incident.contractorId) conflict('Confirm Incident responsibility before closing');
          const pending = currentActions.length
            ? await manager
                .getRepository(CorrectiveActionSubmissionEntity)
                .existsBy({
                  correctiveActionId: In(currentActions.map((a) => a.id)),
                  status: 'PENDING',
                })
            : false;
          if (
            !canCloseIncident(
              currentActions.map((a) => a.status),
              pending,
            )
          )
            conflict('All actions must be verified before closing');
          // Share the grouping locks with ingestion. New observations must form a new alert after closure.
          const linked = await manager
            .getRepository(SafetyAlertEntity)
            .findBy({ incidentId: incident.id, siteId });
          for (const key of [...new Set(linked.map((a) => siteId + ':' + a.groupingKey))].sort())
            await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
          for (const action of currentActions)
            if (action.status === 'VERIFIED') {
              action.status = 'CLOSED';
              action.version++;
              await manager.getRepository(CorrectiveActionEntity).save(action);
            }
          incident.status = 'CLOSED';
          incident.closedAt = new Date();
          incident.closedBy = actor.id;
        } else
          incident.status = incidentStatus(
            incident.status,
            currentActions.map((a) => a.status),
          );
        incident.version++;
        await manager.getRepository(IncidentEntity).save(incident);
        if (
          touched &&
          ['assign', 'transfer', 'reopen', 'correct-responsibility'].includes(operation)
        ) {
          await this.notifications.recordSafetyHandover(manager, {
            commandId: value.commandId,
            siteId,
            contractorId: incident.contractorId!,
            incidentId: incident.id,
            actionId: touched.id,
            recipientId: touched.assignedTo,
            title: incident.title,
          });
        }
        const result = await this.incidentDetail(manager, incident, actor);
        stage.changes = {
          contractorName: result.contractorName,
          ...(touched
            ? { assignedToName: result.actions.find((a) => a.id === touched!.id)?.assignedToName }
            : {}),
          ...stage.changes,
          ...(touched ? { actionId: touched.id } : {}),
          ...(evidenceId ? { evidenceId } : {}),
        };
        return result;
      },
    );
  }
  async createTask(siteId: string, actorId: string, input: unknown) {
    const value = command(CreateSafetyTaskDto, input);
    if (value.zoneId) await this.zones.get(siteId, value.zoneId);
    return this.execute(
      siteId,
      actorId,
      'SAFETY_TASK',
      null,
      'create',
      value,
      UserRole.SITE_MANAGER,
      undefined,
      async (manager, actor) => {
        await this.users.requireSafetyAssignee(
          manager,
          value.assignedTo,
          siteId,
          UserRole.SAFETY_OFFICER,
        );
        if (
          value.sourceAlertId &&
          !(await manager
            .getRepository(SafetyAlertEntity)
            .existsBy({ id: value.sourceAlertId, siteId }))
        )
          missing();
        if (value.sourceIncidentId) await this.incident(manager, siteId, value.sourceIncidentId);
        const task = await manager.getRepository(SafetyTaskEntity).save({
          id: randomUUID(),
          siteId,
          zoneId: value.zoneId ?? null,
          kind: value.kind,
          sourceAlertId: value.sourceAlertId ?? null,
          sourceIncidentId: value.sourceIncidentId ?? null,
          assignedTo: value.assignedTo,
          assignedBy: actor.id,
          description: value.description,
          dueAt: value.dueAt ? new Date(value.dueAt) : null,
          status: 'ASSIGNED',
          resultSummary: null,
          resultEvidenceId: null,
          completedAt: null,
          verifiedBy: null,
          verifiedAt: null,
          version: 1,
        });
        return this.taskDetail(manager, task, actor);
      },
    );
  }
  async taskCommand(
    siteId: string,
    id: string,
    actorId: string,
    operation: TaskOperation,
    input: unknown,
    file?: SafetyUpload,
  ) {
    const role =
      operation === 'start' || operation === 'submit'
        ? UserRole.SAFETY_OFFICER
        : UserRole.SITE_MANAGER;
    const value =
      operation === 'submit'
        ? command(SubmitResultDto, input)
        : operation === 'start'
          ? command(VersionCommandDto, input)
          : command(ReasonCommandDto, input);
    return this.execute(
      siteId,
      actorId,
      'SAFETY_TASK',
      uuid(id),
      operation,
      value,
      role,
      file,
      async (manager, actor, stage) => {
        const task = await this.task(manager, siteId, id, true);
        if (role === UserRole.SAFETY_OFFICER && task.assignedTo !== actor.id) denied();
        if (operation === 'verify' && task.assignedTo === actor.id) denied();
        this.version(task.version, value.expectedVersion);
        if (operation === 'start') {
          if (task.status !== 'ASSIGNED') conflict('Task must be assigned');
          task.status = 'IN_PROGRESS';
        } else if (operation === 'submit') {
          if (task.status !== 'IN_PROGRESS') conflict('Task must be in progress');
          task.resultSummary = (value as SubmitResultDto).resultDescription;
          task.resultEvidenceId = await this.saveEvidence(manager, siteId, actor.id, file, stage);
          task.completedAt = new Date();
          task.status = 'COMPLETED';
        } else if (operation === 'cancel') {
          if (task.status === 'VERIFIED' || task.status === 'CANCELLED')
            conflict('Task cannot be cancelled');
          task.status = 'CANCELLED';
        } else {
          if (task.status !== 'COMPLETED') conflict('Task must be completed');
          if (operation === 'verify') {
            task.status = 'VERIFIED';
            task.verifiedBy = actor.id;
            task.verifiedAt = new Date();
          } else task.status = 'IN_PROGRESS';
        }
        task.version++;
        await manager.getRepository(SafetyTaskEntity).save(task);
        const result = await this.taskDetail(manager, task, actor);
        stage.changes = { resultSummary: task.resultSummary, evidenceId: task.resultEvidenceId };
        return result;
      },
    );
  }
  async getIncident(siteId: string, id: string, actorId: string) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      this.readIncident(actor, siteId);
      return this.incidentDetail(
        manager,
        await this.incident(manager, siteId, id, 'pessimistic_read'),
        actor,
      );
    });
  }
  async getTask(siteId: string, id: string, actorId: string) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      return this.taskDetail(
        manager,
        await this.task(manager, siteId, id, 'pessimistic_read'),
        actor,
      );
    });
  }
  async listIncidents(
    siteId: string,
    actorId: string,
    offset = 0,
    limit = 20,
    status?: string,
    assignedTo?: string,
  ) {
    const pagination = page(offset, limit);
    filterStatus(status, incidentStates);
    if (assignedTo) uuid(assignedTo);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      this.readIncident(actor, siteId);
      const query = manager
        .getRepository(IncidentEntity)
        .createQueryBuilder('incident')
        .where('incident.siteId=:siteId', { siteId });
      if (!this.fullIncident(actor, siteId)) {
        assignedTo = actor.id;
        const contractorIds = await this.workforce.incidentRepresentativeContractors(
          manager,
          siteId,
          actor.id,
        );
        if (!contractorIds.length) return { items: [], total: 0 };
        query.andWhere('incident.contractorId IN (:...contractorIds)', { contractorIds });
      }
      if (assignedTo)
        query.andWhere(
          'EXISTS (SELECT 1 FROM corrective_action a WHERE a.incident_id=incident.id AND a.assigned_to=:assignedTo AND a.superseded_at IS NULL)',
          { assignedTo },
        );
      if (status) query.andWhere('incident.status=:status', { status });
      const [items, total] = await query
        .orderBy('incident.createdAt', 'DESC')
        .addOrderBy('incident.id', 'DESC')
        .skip(pagination.offset)
        .take(pagination.limit)
        .getManyAndCount();
      const names = await this.users.displayNames(
        manager,
        items.map((row) => row.reportedBy),
      );
      return {
        items: await Promise.all(
          items.map(async (row) => ({
            ...json<IncidentResponse>(row),
            reportedByName: names[row.reportedBy] ?? null,
            ...(await this.workforce.incidentLabels(manager, siteId, row.contractorId, [])),
            zoneName: await this.zones.referenceName(siteId, row.zoneId),
          })),
        ),
        total,
      };
    });
  }
  async listTasks(
    siteId: string,
    actorId: string,
    offset = 0,
    limit = 20,
    status?: string,
    assignedTo?: string,
  ) {
    const pagination = page(offset, limit);
    filterStatus(status, taskStates);
    if (assignedTo) uuid(assignedTo);
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      if (!admin(actor) && !has(actor, siteId, UserRole.SITE_MANAGER)) {
        required(actor, siteId, UserRole.SAFETY_OFFICER);
        assignedTo = actor.id;
      }
      const [tasks, total] = await manager.getRepository(SafetyTaskEntity).findAndCount({
        where: {
          siteId,
          ...(status ? { status: status as SafetyTaskEntity['status'] } : {}),
          ...(assignedTo ? { assignedTo } : {}),
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: pagination.offset,
        take: pagination.limit,
      });
      const items = await Promise.all(
        tasks.map(async (task) => {
          const { audit, ...safe } = await this.taskDetail(manager, task, actor);
          void audit;
          return safe;
        }),
      );
      return { items: items as SafetyTaskResponse[], total };
    });
  }
  async assignees(
    siteId: string,
    actorId: string,
    role: string,
    offset = 0,
    limit = 20,
    contractorId?: string,
  ) {
    if (![UserRole.SAFETY_OFFICER, UserRole.CONTRACTOR_REPRESENTATIVE].includes(role as UserRole))
      invalid('Invalid assignee role');
    const representatives = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      if (!admin(actor))
        required(
          actor,
          siteId,
          role === UserRole.SAFETY_OFFICER ? UserRole.SITE_MANAGER : UserRole.SAFETY_OFFICER,
        );
      if (role === UserRole.CONTRACTOR_REPRESENTATIVE) {
        return this.workforce.incidentRepresentatives(
          manager,
          siteId,
          contractorId ? uuid(contractorId) : undefined,
          offset,
          limit,
        );
      }
      return null;
    });
    if (representatives) return representatives;
    return this.users.listSafetyAssignees(siteId, role as UserRole, offset, limit);
  }
  async responsibilityLookup(
    siteId: string,
    actorId: string,
    contractorId: string | undefined,
    offset = 0,
    limit = 20,
  ) {
    return this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      if (!admin(actor)) required(actor, siteId, UserRole.SAFETY_OFFICER);
      return contractorId
        ? this.workforce.incidentWorkers(manager, siteId, uuid(contractorId), offset, limit)
        : this.workforce.incidentContractors(manager, siteId, offset, limit);
    });
  }
  async evidence(
    siteId: string,
    id: string,
    actorId: string,
    type: 'INCIDENT' | 'SAFETY_TASK',
    evidenceId: string,
  ) {
    uuid(evidenceId);
    const reference = await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      if (type === 'INCIDENT') {
        const detail = await this.incidentDetail(
          manager,
          await this.incident(manager, siteId, id, 'pessimistic_read'),
          actor,
        );
        if (!detail.actions.some((a) => a.submissions.some((s) => s.evidence?.id === evidenceId)))
          missing();
      } else {
        const detail = await this.taskDetail(
          manager,
          await this.task(manager, siteId, id, 'pessimistic_read'),
          actor,
        );
        if (
          detail.resultEvidence?.id !== evidenceId &&
          !detail.audit.some((a) => a.changes.evidenceId === evidenceId)
        )
          missing();
      }
      const evidence = await manager
        .getRepository(SafetyEvidenceEntity)
        .findOneBy({ id: evidenceId, siteId });
      if (!evidence) missing();
      return evidence;
    });
    return this.uploads.read(reference);
  }
  async linkedAlert(siteId: string, id: string, actorId: string, alertId: string) {
    const detail = await this.getIncident(siteId, id, actorId);
    if (!detail.alerts.some((a) => a.id === uuid(alertId))) missing();
  }
}
