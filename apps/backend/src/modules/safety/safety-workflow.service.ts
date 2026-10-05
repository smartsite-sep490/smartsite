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
  'link' | 'assign' | 'start' | 'submit' | 'review' | 'close' | 'reopen';
export type TaskOperation = 'start' | 'submit' | 'verify' | 'return' | 'cancel';
type EvidenceStage = { key?: string; changes?: Record<string, unknown> };
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
  ) {}
  private async actor(manager: EntityManager, actorId: string, siteId: string) {
    uuid(siteId);
    const actor = await this.users.safetyActor(manager, actorId);
    return actor;
  }
  private readIncident(actor: AuthenticatedUser, siteId: string) {
    if (
      !admin(actor) &&
      ![UserRole.SAFETY_OFFICER, UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER].some((role) =>
        has(actor, siteId, role),
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
  private auditResponse(row: SafetyWorkflowAuditEntity): SafetyAuditResponse {
    const { id, actorId, action, resourceType, resourceId, reason, changes, occurredAt } = row;
    return json({ id, actorId, action, resourceType, resourceId, reason, changes, occurredAt });
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
    const actions = full ? all : all.filter((a) => a.assignedTo === actor.id);
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
    const audit = await this.audits(manager, incident.siteId, 'INCIDENT', incident.id);
    return json({
      ...incident,
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
        submissions: submissions
          .filter((s) => s.correctiveActionId === a.id)
          .map((s) => {
            const { evidenceId, ...safe } = s;
            const file = evidence.find((e) => e.id === evidenceId);
            return { ...safe, evidence: file ? this.evidenceResponse(file) : null };
          }),
      })),
      audit: audit
        .filter(
          (a) =>
            full ||
            !a.changes.actionId ||
            actions.some((action) => action.id === a.changes.actionId),
        )
        .map((a) => this.auditResponse(a)),
    });
  }
  private async taskDetail(
    manager: EntityManager,
    task: SafetyTaskEntity,
    actor: AuthenticatedUser,
  ): Promise<SafetyTaskDetailResponse> {
    this.readTask(actor, task);
    const { resultEvidenceId, ...safe } = task;
    const evidence = resultEvidenceId
      ? await manager
          .getRepository(SafetyEvidenceEntity)
          .findOneBy({ id: resultEvidenceId, siteId: task.siteId })
      : null;
    return json({
      ...safe,
      resultEvidence: evidence ? this.evidenceResponse(evidence) : null,
      audit: (await this.audits(manager, task.siteId, 'SAFETY_TASK', task.id)).map((a) =>
        this.auditResponse(a),
      ),
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
    try {
      return await this.db.transaction(async (manager) => {
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
          let resource = receipt.result as unknown as T;
          if (resourceType === 'INCIDENT') {
            const snapshot = resource as IncidentDetailResponse;
            this.readIncident(actor, snapshot.siteId);
            if (!this.fullIncident(actor, snapshot.siteId)) {
              const actions = snapshot.actions.filter((action) => action.assignedTo === actor.id);
              if (!actions.length) denied();
              resource = {
                ...snapshot,
                actions,
                audit: snapshot.audit.filter(
                  (entry) =>
                    !entry.changes.actionId ||
                    actions.some((action) => action.id === entry.changes.actionId),
                ),
              } as T;
            }
          } else this.readTask(actor, resource as unknown as SafetyTaskEntity);
          return { resource, replayed: true };
        }
        const resource = await work(manager, actor, stage);
        const changes: Record<string, unknown> = {
          ...json<Record<string, unknown>>(input),
          version: resource.version,
        };
        // Store only evidence references; never file bytes or private storage keys.
        Object.assign(changes, stage.changes);
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
    } catch (error) {
      if (stage.key) await this.uploads.remove(stage.key);
      throw error;
    }
  }
  private async saveEvidence(
    manager: EntityManager,
    siteId: string,
    actorId: string,
    file: SafetyUpload | undefined,
    stage: EvidenceStage,
  ) {
    if (!file) return null;
    const saved = await this.uploads.save(file);
    stage.key = saved.storageKey;
    const evidence = await manager
      .getRepository(SafetyEvidenceEntity)
      .save({ id: randomUUID(), siteId, uploadedBy: actorId, ...saved });
    return evidence.id;
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
        const incident = await manager.getRepository(IncidentEntity).save({
          id: randomUUID(),
          siteId: uuid(siteId),
          zoneId: value.zoneId ?? null,
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
        await this.link(manager, siteId, incident.id, value.alertIds);
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
        ? UserRole.SECURITY_OFFICER
        : UserRole.SAFETY_OFFICER;
    const value =
      operation === 'link'
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
        if (['start', 'submit', 'review'].includes(operation)) {
          touched = actions.find((a) => a.id === actionId) ?? missing();
          if (operation !== 'review' && touched.assignedTo !== actor.id) denied();
          this.version(touched.version, value.expectedVersion);
        } else this.version(incident.version, value.expectedVersion);
        if (incident.status === 'CLOSED' && operation !== 'reopen') conflict('Incident is closed');
        if (operation === 'link')
          await this.link(manager, siteId, incident.id, (value as LinkAlertsDto).alertIds);
        if (operation === 'assign' || operation === 'reopen') {
          const assignment = value as AssignActionDto;
          if (operation === 'reopen' && incident.status !== 'CLOSED')
            conflict('Only closed incidents may be reopened');
          await this.users.requireSafetyAssignee(
            manager,
            assignment.assignedTo,
            siteId,
            UserRole.SECURITY_OFFICER,
          );
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
        if (touched && ['start', 'submit', 'review'].includes(operation)) {
          touched.version++;
          await manager.getRepository(CorrectiveActionEntity).save(touched);
        }
        if (operation === 'close') {
          const pending = actions.length
            ? await manager
                .getRepository(CorrectiveActionSubmissionEntity)
                .existsBy({ correctiveActionId: In(actions.map((a) => a.id)), status: 'PENDING' })
            : false;
          if (
            !canCloseIncident(
              actions.map((a) => a.status),
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
          for (const action of actions)
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
            actions.map((a) => a.status),
          );
        incident.version++;
        await manager.getRepository(IncidentEntity).save(incident);
        const result = await this.incidentDetail(manager, incident, actor);
        stage.changes = {
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
      if (!this.fullIncident(actor, siteId)) assignedTo = actor.id;
      if (assignedTo)
        query.andWhere(
          'EXISTS (SELECT 1 FROM corrective_action a WHERE a.incident_id=incident.id AND a.assigned_to=:assignedTo)',
          { assignedTo },
        );
      if (status) query.andWhere('incident.status=:status', { status });
      const [items, total] = await query
        .orderBy('incident.createdAt', 'DESC')
        .addOrderBy('incident.id', 'DESC')
        .skip(pagination.offset)
        .take(pagination.limit)
        .getManyAndCount();
      return { items: json<IncidentResponse[]>(items), total };
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
  async assignees(siteId: string, actorId: string, role: string, offset = 0, limit = 20) {
    if (![UserRole.SAFETY_OFFICER, UserRole.SECURITY_OFFICER].includes(role as UserRole))
      invalid('Invalid assignee role');
    await this.db.transaction(async (manager) => {
      const actor = await this.actor(manager, actorId, siteId);
      if (!admin(actor))
        required(
          actor,
          siteId,
          role === UserRole.SAFETY_OFFICER ? UserRole.SITE_MANAGER : UserRole.SAFETY_OFFICER,
        );
    });
    return this.users.listSafetyAssignees(siteId, role as UserRole, offset, limit);
  }
  async evidence(
    siteId: string,
    id: string,
    actorId: string,
    type: 'INCIDENT' | 'SAFETY_TASK',
    evidenceId: string,
  ) {
    uuid(evidenceId);
    return this.db.transaction(async (manager) => {
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
      return this.uploads.read(evidence);
    });
  }
  async linkedAlert(siteId: string, id: string, actorId: string, alertId: string) {
    const detail = await this.getIncident(siteId, id, actorId);
    if (!detail.alerts.some((a) => a.id === uuid(alertId))) missing();
  }
}
