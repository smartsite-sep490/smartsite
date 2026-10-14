import { SafetyWorkflowService } from './safety-workflow.service.js';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  ChecklistResponse,
  ChecklistDetailResponse,
  ChecklistSubmissionResponse,
  WorkflowMutationResponse,
} from '@smartsite/contracts';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { UsersService } from '../users/users.service.js';
import { WorkforceConfigurationService } from '../workforce/directory/workforce-configuration.service.js';
import { SchedulingNotificationService } from '../workforce/notifications/scheduling-notification.service.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { UserRole } from '../../database/entities/user.entity.js';
import {
  SafetyChecklistAssignmentEntity,
  SafetyChecklistItemEntity,
  SafetyChecklistSubmissionEntity,
  SafetyChecklistItemResultEntity,
  SafetyChecklistResultEvidenceEntity,
} from '../../database/entities/safety-checklist.entity.js';
import {
  SafetyEvidenceEntity,
  SafetyWorkflowAuditEntity,
} from '../../database/entities/safety-workflow.entity.js';
import { ContractorTeamEntity } from '../../database/entities/contractor-team.entity.js';
import {
  command,
  uuid,
  missing,
  conflict,
  invalid,
  page,
} from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  SafetyUploadService,
  validateChecklistFiles,
  type SafetyUpload,
} from './safety-upload.service.js';
import type { StoredObject } from '../../integrations/storage/storage.service.js';
import {
  ChecklistContextQueryDto,
  CreateChecklistDto,
  SubmitChecklistDto,
  ReviewChecklistDto,
} from './safety-checklist.commands.js';
import {
  VersionCommandDto,
  ReasonCommandDto,
  WorkflowCommand,
} from './safety-workflow.commands.js';
import {
  checklistTransition,
  requireChecklistReviewer,
  validateChecklistResults,
} from './checklist-policy.js';
const has = (actor: AuthenticatedUser, siteId: string | null, role: UserRole) =>
  actor.roleAssignments.some((r) => r.siteId === siteId && r.role === role);
const denied = (): never => {
  throw new PublicHttpException(403, {
    code: 'FORBIDDEN',
    message: 'Checklist access is not permitted',
  });
};
const json = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type Operation = 'start' | 'submit' | 'review' | 'cancel';
const states = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'CANCELLED'];
@Injectable()
export class SafetyChecklistService {
  constructor(
    private readonly db: DataSource,
    private readonly users: UsersService,
    private readonly workforce: WorkforceConfigurationService,
    private readonly uploads: SafetyUploadService,
    private readonly notifications: SchedulingNotificationService,
    private readonly workflow?: SafetyWorkflowService,
  ) {}
  private full(actor: AuthenticatedUser, siteId: string) {
    return (
      has(actor, null, UserRole.ADMIN) ||
      has(actor, siteId, UserRole.SAFETY_OFFICER) ||
      has(actor, siteId, UserRole.SITE_MANAGER)
    );
  }
  private async assignment(m: EntityManager, siteId: string, id: string, lock = false) {
    return (
      (await m.getRepository(SafetyChecklistAssignmentEntity).findOne({
        where: { id: uuid(id), siteId: uuid(siteId) },
        ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
      })) ?? missing()
    );
  }
  private async read(
    m: EntityManager,
    actor: AuthenticatedUser,
    a: SafetyChecklistAssignmentEntity,
  ) {
    if (this.full(actor, a.siteId)) return;
    if (
      a.assignedTo !== actor.id ||
      !has(actor, a.siteId, UserRole.CONTRACTOR_REPRESENTATIVE) ||
      !(await this.workforce.incidentRepresentativeAllowed(m, a.siteId, a.contractorId, actor.id))
    )
      denied();
  }
  private async headers(
    m: EntityManager,
    assignments: SafetyChecklistAssignmentEntity[],
  ): Promise<ChecklistResponse[]> {
    if (!assignments.length) return [];
    const rows = (await m.query(
      `SELECT a.id,c.name AS "contractorName",t.name AS "teamName",z.name AS "zoneName",u.display_name AS "assignedToName",s.display_name AS "assignedByName",(SELECT min(sub.submitted_at) FROM safety_checklist_submission sub WHERE sub.assignment_id=a.id) AS "firstSubmittedAt" FROM safety_checklist_assignment a LEFT JOIN contractor c ON c.id=a.contractor_id LEFT JOIN contractor_team t ON t.id=a.team_id LEFT JOIN zone z ON z.id=a.zone_id LEFT JOIN app_user u ON u.id=a.assigned_to LEFT JOIN app_user s ON s.id=a.assigned_by WHERE a.id=ANY($1::uuid[])`,
      [assignments.map((a) => a.id)],
    )) as (Pick<
      ChecklistResponse,
      'id' | 'contractorName' | 'teamName' | 'zoneName' | 'assignedToName' | 'assignedByName'
    > & { firstSubmittedAt: Date | null })[];
    return assignments.map((a) => json({ ...a, ...rows.find((r) => r.id === a.id) }));
  }
  private async header(m: EntityManager, a: SafetyChecklistAssignmentEntity) {
    return (await this.headers(m, [a]))[0]!;
  }
  private async detail(
    m: EntityManager,
    a: SafetyChecklistAssignmentEntity,
    actor: AuthenticatedUser,
  ): Promise<ChecklistDetailResponse> {
    await this.read(m, actor, a);
    const items = await m
      .getRepository(SafetyChecklistItemEntity)
      .find({ where: { assignmentId: a.id }, order: { position: 'ASC' } });
    const submissions = await m
      .getRepository(SafetyChecklistSubmissionEntity)
      .find({ where: { assignmentId: a.id }, order: { submittedAt: 'ASC', id: 'ASC' } });
    const results = await m
      .getRepository(SafetyChecklistItemResultEntity)
      .find({ where: { assignmentId: a.id }, order: { id: 'ASC' } });
    const evidence = (await m.query(
      `SELECT b.result_id AS "resultId",e.id,e.media_type AS "mediaType",e.size FROM safety_checklist_result_evidence b JOIN safety_evidence e ON e.id=b.evidence_id JOIN safety_checklist_item_result r ON r.id=b.result_id WHERE r.assignment_id=$1 AND e.site_id=$2 ORDER BY e.created_at,e.id`,
      [a.id, a.siteId],
    )) as {
      resultId: string;
      id: string;
      mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
      size: number;
    }[];
    const links = this.workflow
      ? await this.workflow.checklistIncidentReferences(
          m,
          actor,
          a.siteId,
          results.map((r) => r.id),
        )
      : this.full(actor, a.siteId)
        ? ((await m.query(
            'SELECT source_checklist_result_id AS "resultId",id,title,status FROM incident WHERE site_id=$1 AND source_checklist_result_id=ANY($2::uuid[])',
            [a.siteId, results.map((r) => r.id)],
          )) as {
            resultId: string;
            id: string;
            title: string;
            status: import('@smartsite/contracts').IncidentStatus;
          }[])
        : [];
    const audits = await m.getRepository(SafetyWorkflowAuditEntity).find({
      where: { siteId: a.siteId, resourceType: 'CHECKLIST', resourceId: a.id },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
    const names = await this.users.displayNames(m, [
      ...submissions.flatMap((s) => [s.submittedBy, s.reviewedBy]),
      ...audits.map((a) => a.actorId),
    ]);
    const response: ChecklistSubmissionResponse[] = submissions.map((s) => ({
      ...json<Omit<ChecklistSubmissionResponse, 'results' | 'submittedByName' | 'reviewedByName'>>(
        s,
      ),
      submittedByName: names[s.submittedBy] ?? null,
      reviewedByName: s.reviewedBy ? (names[s.reviewedBy] ?? null) : null,
      results: results
        .filter((r) => r.submissionId === s.id)
        .map((r) => ({
          id: r.id,
          itemId: r.itemId,
          answer: r.answer,
          note: r.note,
          evidence: evidence
            .filter((e) => e.resultId === r.id)
            .map((e) => ({ id: e.id, mediaType: e.mediaType, size: e.size })),
          incidentId: links.find((l) => l.resultId === r.id)?.id ?? null,
          linkedIncident: (() => {
            const linked = links.find((l) => l.resultId === r.id);
            return linked ? { id: linked.id, title: linked.title, status: linked.status } : null;
          })(),
        })),
    }));
    return {
      ...(await this.header(m, a)),
      items: items.map((i) => ({
        id: i.id,
        position: i.position,
        text: i.text,
        evidenceRequired: i.evidenceRequired,
      })),
      submissions: response,
      audit: audits.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorName:
          typeof row.changes.actorName === 'string'
            ? row.changes.actorName
            : (names[row.actorId] ?? null),
        action: row.action,
        resourceType: 'CHECKLIST',
        resourceId: row.resourceId,
        reason: row.reason,
        changes: row.changes,
        occurredAt: row.occurredAt.toISOString(),
      })),
    };
  }
  async get(siteId: string, id: string, actorId: string) {
    return this.db.transaction(async (m) =>
      this.detail(
        m,
        await this.assignment(m, siteId, id),
        await this.users.safetyActor(m, actorId),
      ),
    );
  }
  async list(
    siteId: string,
    actorId: string,
    filters: import('@smartsite/contracts').ChecklistListQuery = {},
  ) {
    const paging = page(filters.offset, filters.limit);
    const context = command(ChecklistContextQueryDto, {
      teamId: filters.teamId,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      timezone: filters.timezone,
    });
    if (context.fromDate || context.toDate || context.timezone) {
      if (
        !context.fromDate ||
        !context.toDate ||
        !context.timezone ||
        context.fromDate > context.toDate
      )
        invalid('A valid date interval and timezone are required');
      try {
        new Intl.DateTimeFormat('en', { timeZone: context.timezone }).format();
      } catch {
        invalid('Invalid timezone');
      }
    }
    uuid(siteId);
    if (filters.status && !states.includes(filters.status)) invalid('Invalid checklist status');
    if (filters.assignedTo) uuid(filters.assignedTo);
    return this.db.transaction(async (m) => {
      const actor = await this.users.safetyActor(m, actorId);
      const q = m
        .getRepository(SafetyChecklistAssignmentEntity)
        .createQueryBuilder('a')
        .where('a.siteId=:siteId', { siteId });
      if (!this.full(actor, siteId)) {
        if (!has(actor, siteId, UserRole.CONTRACTOR_REPRESENTATIVE)) denied();
        if (filters.assignedTo && filters.assignedTo !== actor.id) denied();
        const contractors = await this.workforce.incidentRepresentativeContractors(
          m,
          siteId,
          actor.id,
        );
        if (!contractors.length) return { items: [], total: 0 };
        q.andWhere('a.assignedTo=:actorId AND a.contractorId IN (:...contractors)', {
          actorId: actor.id,
          contractors,
        });
      }
      if (context.teamId) q.andWhere('a.teamId=:teamId', { teamId: context.teamId });
      if (context.fromDate)
        q.andWhere(
          'a.starts_at<((CAST(:toDate AS date)+1)::timestamp AT TIME ZONE :timezone) AND a.ends_at>(CAST(:fromDate AS date)::timestamp AT TIME ZONE :timezone)',
          { ...context },
        );
      if (context.teamId && context.fromDate && !filters.status)
        q.andWhere("a.status<>'CANCELLED'");
      if (filters.status) q.andWhere('a.status=:status', { status: filters.status });
      if (filters.assignedTo)
        q.andWhere('a.assignedTo=:assignedTo', { assignedTo: filters.assignedTo });
      const [rows, total] = await q
        .orderBy('a.createdAt', 'DESC')
        .addOrderBy('a.id', 'ASC')
        .skip(paging.offset)
        .take(paging.limit)
        .getManyAndCount();
      return { items: await this.headers(m, rows), total };
    });
  }
  private async execute(
    siteId: string,
    actorId: string,
    id: string | null,
    action: string,
    input: WorkflowCommand,
    files: SafetyUpload[],
    work: (
      m: EntityManager,
      actor: AuthenticatedUser,
      saved: StoredObject[],
    ) => Promise<ChecklistDetailResponse>,
  ): Promise<WorkflowMutationResponse<ChecklistDetailResponse>> {
    uuid(siteId);
    const validated = validateChecklistFiles(files),
      saved: StoredObject[] = [];
    const hash = computeCanonicalPayloadHash({
      siteId,
      actorId,
      id,
      action,
      input: json<Record<string, unknown>>(input),
      files: validated.map((f) => f.sha256),
    });
    const authorize = async (m: EntityManager) => {
      const actor = await this.users.safetyActor(m, actorId);
      const role =
        action === 'start' || action === 'submit'
          ? UserRole.CONTRACTOR_REPRESENTATIVE
          : UserRole.SAFETY_OFFICER;
      if (!has(actor, siteId, role)) denied();
      if (id) {
        const a = await this.assignment(m, siteId, id);
        await this.read(m, actor, a);
        if (role === UserRole.CONTRACTOR_REPRESENTATIVE && a.assignedTo !== actor.id) denied();
      }
      return actor;
    };
    const replay = async (m: EntityManager, actor: AuthenticatedUser) => {
      const receipt = await m
        .getRepository(SafetyWorkflowAuditEntity)
        .findOneBy({ commandId: input.commandId });
      if (!receipt) return null;
      if (receipt.inputHash !== hash || receipt.resourceType !== 'CHECKLIST')
        conflict('Command ID already used with different input');
      await this.read(m, actor, await this.assignment(m, siteId, receipt.resourceId));
      return { resource: receipt.result as unknown as ChecklistDetailResponse, replayed: true };
    };
    if (files.length) {
      const receipt = await this.db.transaction(async (m) => {
        const actor = await authorize(m),
          receipt = await replay(m, actor);
        if (receipt) return receipt;
        const a = await this.assignment(m, siteId, id!);
        if (a.version !== (input as VersionCommandDto).expectedVersion)
          conflict('Data changed. Reload before retrying.');
        checklistTransition(a.status, 'submit');
        const items = await m
          .getRepository(SafetyChecklistItemEntity)
          .findBy({ assignmentId: a.id });
        validateChecklistResults(items, (input as SubmitChecklistDto).results, files.length);
        return null;
      });
      if (receipt) return receipt;
    }
    try {
      for (const file of files) saved.push(await this.uploads.saveChecklist(file));
      const result = await this.db.transaction(async (m) => {
        const actor = await authorize(m);
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          'mf08-command:' + input.commandId,
        ]);
        const receipt = await replay(m, actor);
        if (receipt) return receipt;
        const resource = await work(m, actor, saved);
        const audit = m.getRepository(SafetyWorkflowAuditEntity).create({
          id: randomUUID(),
          commandId: input.commandId,
          actorId,
          siteId,
          resourceType: 'CHECKLIST',
          resourceId: resource.id,
          action,
          reason: 'reason' in input ? String(input.reason) : null,
          inputHash: hash,
          changes: {
            ...json<Record<string, unknown>>(input),
            actorName: actor.displayName,
            version: resource.version,
          },
          result: {},
          occurredAt: new Date(),
        });
        resource.audit.push({
          id: audit.id,
          actorId,
          actorName: actor.displayName,
          resourceType: 'CHECKLIST',
          resourceId: resource.id,
          action,
          reason: audit.reason,
          changes: audit.changes,
          occurredAt: audit.occurredAt.toISOString(),
        });
        audit.result = json<Record<string, unknown>>(resource);
        await m.getRepository(SafetyWorkflowAuditEntity).save(audit);
        return { resource, replayed: false };
      });
      if (result.replayed) await Promise.all(saved.map((f) => this.uploads.remove(f)));
      return result;
    } catch (error) {
      await Promise.all(saved.map((f) => this.uploads.remove(f)));
      throw error;
    }
  }
  async create(siteId: string, actorId: string, input: unknown) {
    const value = command(CreateChecklistDto, input);
    if (!value.description.trim()) invalid('Checklist description must not be blank');
    if (new Date(value.endsAt) <= new Date(value.startsAt))
      invalid('End time must follow start time');
    for (const item of value.items)
      if (!item.text.trim()) invalid('Checklist criteria must not be blank');
    return this.execute(siteId, actorId, null, 'create', value, [], async (m, actor) => {
      const team = await m.getRepository(ContractorTeamEntity).findOne({
        where: { id: value.teamId, siteId, isActive: true },
        lock: { mode: 'pessimistic_read' },
      });
      if (!team) missing();
      await this.users.requireSafetyAssignee(
        m,
        value.assignedTo,
        siteId,
        UserRole.CONTRACTOR_REPRESENTATIVE,
      );
      if (
        !(await this.workforce.incidentRepresentativeAllowed(
          m,
          siteId,
          team.contractorId,
          value.assignedTo,
        ))
      )
        denied();
      const permissions = (await m.query(
        `SELECT tp.id FROM team_zone_permission tp JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id JOIN contractor_site_participation p ON p.id=cp.site_contractor_id JOIN zone z ON z.id=cp.zone_id WHERE tp.team_id=$1 AND z.id=$2 AND z.site_id=$3 AND p.site_id=$3 AND p.contractor_id=$4 AND p.is_active AND tp.revoked_at IS NULL AND cp.revoked_at IS NULL AND tp.valid_from<=$5 AND tp.valid_until>=$6 AND cp.valid_from<=$5 AND cp.valid_until>=$6 AND p.valid_from<=$5 AND (p.valid_until IS NULL OR p.valid_until>=$6) FOR SHARE OF tp,cp,p,z`,
        [team.id, value.zoneId, siteId, team.contractorId, value.startsAt, value.endsAt],
      )) as unknown[];
      if (!permissions.length)
        conflict('The team must have a Zone grant covering this work window');
      const a = await m.getRepository(SafetyChecklistAssignmentEntity).save({
        id: randomUUID(),
        siteId,
        contractorId: team.contractorId,
        teamId: team.id,
        zoneId: value.zoneId,
        description: value.description.trim(),
        startsAt: new Date(value.startsAt),
        endsAt: new Date(value.endsAt),
        assignedTo: value.assignedTo,
        assignedBy: actor.id,
        status: 'ASSIGNED',
        version: 1,
      });
      await m.getRepository(SafetyChecklistItemEntity).save(
        value.items.map((item, position) => ({
          id: randomUUID(),
          assignmentId: a.id,
          position,
          text: item.text.trim(),
          evidenceRequired: item.evidenceRequired,
        })),
      );
      await this.notifications.recordChecklist(m, {
        commandId: value.commandId,
        assignment: a,
        event: 'CHECKLIST_ASSIGNED',
      });
      return this.detail(m, a, actor);
    });
  }
  async mutate(
    siteId: string,
    id: string,
    actorId: string,
    operation: Operation,
    input: unknown,
    files: SafetyUpload[] = [],
  ) {
    const value =
      operation === 'submit'
        ? command(SubmitChecklistDto, input)
        : operation === 'review'
          ? command(ReviewChecklistDto, input)
          : operation === 'cancel'
            ? command(ReasonCommandDto, input)
            : command(VersionCommandDto, input);
    return this.execute(siteId, actorId, id, operation, value, files, async (m, actor, saved) => {
      const a = await this.assignment(m, siteId, id, true);
      if (a.version !== value.expectedVersion) conflict('Data changed. Reload before retrying.');
      if (operation === 'submit') {
        a.status = checklistTransition(a.status, 'submit');
        const items = await m
          .getRepository(SafetyChecklistItemEntity)
          .findBy({ assignmentId: a.id });
        const results = (value as SubmitChecklistDto).results;
        validateChecklistResults(items, results, saved.length);
        const submission = await m.getRepository(SafetyChecklistSubmissionEntity).save({
          id: randomUUID(),
          assignmentId: a.id,
          submittedBy: actor.id,
          status: 'PENDING',
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
        });
        for (const entry of results) {
          const row = await m.getRepository(SafetyChecklistItemResultEntity).save({
            id: randomUUID(),
            assignmentId: a.id,
            submissionId: submission.id,
            itemId: entry.itemId,
            answer: entry.answer,
            note: entry.note.trim(),
          });
          for (const index of entry.fileIndexes) {
            const object = saved[index]!;
            const evidence = await m
              .getRepository(SafetyEvidenceEntity)
              .save({ id: randomUUID(), siteId, uploadedBy: actor.id, ...object });
            await m
              .getRepository(SafetyChecklistResultEvidenceEntity)
              .save({ resultId: row.id, evidenceId: evidence.id });
          }
        }
        await this.notifications.recordChecklist(m, {
          commandId: value.commandId,
          assignment: a,
          event: 'CHECKLIST_SUBMITTED',
        });
      } else if (operation === 'review') {
        const review = value as ReviewChecklistDto;
        const pending = await m.getRepository(SafetyChecklistSubmissionEntity).findOne({
          where: { id: review.submissionId, assignmentId: a.id, status: 'PENDING' },
          lock: { mode: 'pessimistic_write' },
        });
        if (!pending) conflict('Only the current pending submission can be reviewed');
        requireChecklistReviewer(actor.id, pending.submittedBy);
        a.status = checklistTransition(
          a.status,
          review.decision === 'ACCEPTED' ? 'accept' : 'return',
        );
        await m.getRepository(SafetyChecklistSubmissionEntity).update(pending.id, {
          status: review.decision,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: review.reason.trim(),
        });
        await this.notifications.recordChecklist(m, {
          commandId: value.commandId,
          assignment: a,
          event: review.decision === 'ACCEPTED' ? 'CHECKLIST_RECORDED' : 'CHECKLIST_RETURNED',
        });
      } else a.status = checklistTransition(a.status, operation);
      a.version++;
      await m.getRepository(SafetyChecklistAssignmentEntity).save(a);
      return this.detail(m, a, actor);
    });
  }
  async evidence(siteId: string, id: string, evidenceId: string, actorId: string) {
    const ref = await this.db.transaction(async (m) => {
      const actor = await this.users.safetyActor(m, actorId),
        a = await this.assignment(m, siteId, id);
      await this.read(m, actor, a);
      const [row] = (await m.query(
        `SELECT e.* FROM safety_evidence e JOIN safety_checklist_result_evidence b ON b.evidence_id=e.id JOIN safety_checklist_item_result r ON r.id=b.result_id WHERE e.id=$1 AND e.site_id=$2 AND r.assignment_id=$3`,
        [uuid(evidenceId), siteId, a.id],
      )) as {
        storage_key: string;
        storage_provider: 'LOCAL' | 'R2';
        media_type: string;
        sha256: string;
        size: number;
      }[];
      if (!row) missing();
      return {
        storageKey: row.storage_key,
        storageProvider: row.storage_provider,
        mediaType: row.media_type,
        sha256: row.sha256,
        size: row.size,
      };
    });
    return { bytes: await this.uploads.readChecklist(ref), mediaType: ref.mediaType };
  }
}
