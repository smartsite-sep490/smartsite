import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { command, conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import {
  CreateWorkerSiteZoneAssignmentCommand,
  SiteManagerDecisionCommand,
  RevokeWorkerAssignmentCommand,
} from '../workforce/worker-assignment.commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { withZoneAuthorityTransaction } from './zone-authority-transaction.js';

const id = z.uuid().transform((v) => v.toLowerCase()),
  instant = z.iso.datetime({ offset: true }).max(128);
const scope = { commandId: id, actorUserId: id, siteId: id };
const requestSchema = z.strictObject({
  ...scope,
  workerId: id,
  zoneIds: z.array(id).min(1).max(64),
  validFrom: instant,
  validUntil: instant.nullable(),
});
const reviewSchema = z.strictObject({ ...scope, assignmentId: id });
const decisionSchema = z.strictObject({
  ...scope,
  assignmentId: id,
  approve: z.boolean(),
  expectedVersion: z.int().min(1).max(2147483647).optional(),
  reviewNote: z.string().max(1000).nullish(),
});
const revokeSchema = z.strictObject({
  ...scope,
  assignmentId: id,
  expectedVersion: z.int().min(1).max(2147483647),
  reviewNote: z.string().trim().min(1).max(1000),
});
const assignmentSchema = z.strictObject({
  id,
  workerId: id,
  siteId: id,
  siteContractorId: id.nullable(),
  zoneIds: z.array(id).min(1),
  gateId: z.string().nullable(),
  status: z.enum([
    'PENDING',
    'SAFETY_REVIEWED',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'REVOKED',
    'EXPIRED',
  ]),
  version: z.int().min(1),
  validFrom: instant,
  validUntil: instant.nullable(),
  requestedByUserId: id,
  safetyReviewedByUserId: id.nullable(),
  siteManagerDecidedByUserId: id.nullable(),
  reviewedAt: instant.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: instant,
});
type Operation = 'REQUEST' | 'SAFETY_REVIEW' | 'DECISION' | 'REVOKE';
type Command =
  | z.infer<typeof requestSchema>
  | z.infer<typeof reviewSchema>
  | z.infer<typeof decisionSchema>
  | z.infer<typeof revokeSchema>;
type Request = Omit<z.infer<typeof requestSchema>, 'commandId'>;
type Transition =
  | Omit<z.infer<typeof reviewSchema>, 'commandId'>
  | Omit<z.infer<typeof decisionSchema>, 'commandId'>
  | Omit<z.infer<typeof revokeSchema>, 'commandId'>;
type WorkCommand = Request | Transition;
// Explicit main columns, independent of candidate functions and branch-only contractor_id.
const assignmentProjection = `jsonb_build_object('id',id,'workerId',worker_id,'siteId',site_id,
  'siteContractorId',site_contractor_id,'zoneIds',zone_ids,'gateId',gate_id,'status',status,'version',version,
  'validFrom',to_char(valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'validUntil',to_char(valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'requestedByUserId',requested_by_user_id,'safetyReviewedByUserId',safety_reviewed_by_user_id,
  'siteManagerDecidedByUserId',site_manager_decided_by_user_id,
  'reviewedAt',to_char(reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'reviewNote',review_note,'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`;
export interface MainAssignmentCommandResult {
  commandId: string;
  replayed: boolean;
  assignment: z.infer<typeof assignmentSchema>;
}
interface Receipt {
  assignment: MainAssignmentCommandResult['assignment'];
  contractorId: string | null;
}
function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Assignment command could not be confirmed; retry with the same command ID',
  });
}

/** Retained-main assignment business core; no role grant, READY epoch, model or identity execution. */
@Injectable()
export class MainAssignmentCommandService {
  constructor(private readonly source: DataSource) {}
  async publicRequest(
    workerId: string,
    input: CreateWorkerSiteZoneAssignmentCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(CreateWorkerSiteZoneAssignmentCommand, input);
    const value: Request = {
      ...p,
      workerId: uuid(workerId).toLowerCase(),
      siteId: p.siteId.toLowerCase(),
      zoneIds: p.zoneIds.map((z) => z.toLowerCase()),
      actorUserId: uuid(context.actorUserId).toLowerCase(),
      validFrom: this.publicInstant(p.validFrom),
      validUntil: p.validUntil === null ? null : this.publicInstant(p.validUntil),
    };
    return this.executePublic('REQUEST', value, context);
  }
  async publicSafetyReview(assignmentId: string, context: MainConfigurationCommandContext) {
    return this.executePublic(
      'SAFETY_REVIEW',
      await this.publicScope(assignmentId, context),
      context,
    );
  }
  async publicDecision(
    assignmentId: string,
    input: SiteManagerDecisionCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(SiteManagerDecisionCommand, input);
    return this.executePublic(
      'DECISION',
      { ...(await this.publicScope(assignmentId, context)), ...p },
      context,
    );
  }
  async publicRevoke(
    assignmentId: string,
    input: RevokeWorkerAssignmentCommand,
    context: MainConfigurationCommandContext,
  ) {
    const p = command(RevokeWorkerAssignmentCommand, input);
    return this.executePublic(
      'REVOKE',
      { ...(await this.publicScope(assignmentId, context)), ...p },
      context,
    );
  }
  private publicInstant(value: string): string {
    // Main's public date DTO also accepts dates/local times. Keep its JS timezone
    // interpretation for those; explicit offsets retain PostgreSQL microseconds.
    if (!Number.isFinite(new Date(value).getTime())) invalid('Invalid assignment time');
    return /[Tt ].*(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value) ? value : new Date(value).toISOString();
  }
  private async publicScope(assignmentId: string, context: MainConfigurationCommandContext) {
    const id = uuid(assignmentId).toLowerCase();
    const rows = await this.source.query(
      'SELECT site_id FROM worker_site_zone_assignment WHERE id=$1',
      [id],
    );
    if (!rows.length) missing();
    return {
      assignmentId: id,
      siteId: rows[0].site_id as string,
      actorUserId: uuid(context.actorUserId).toLowerCase(),
    };
  }
  private async executePublic(
    operation: Operation,
    value: WorkCommand,
    context: MainConfigurationCommandContext,
  ) {
    const result = await executeMainConfigurationCommand(
      this.source,
      context,
      `ASSIGNMENT_${operation}`,
      value,
      async (manager) => {
        await this.authorize(manager, operation, value);
        const sourceId =
          'workerId' in value
            ? await this.create(manager, value)
            : await this.transition(manager, operation, value);
        return this.readAssignment(manager, sourceId, value.siteId);
      },
      async (manager) => {
        await this.authorize(manager, operation, value);
      },
    );
    // Existing main public JSON uses Date precision; historical facts keep exact instants.
    return {
      ...result,
      validFrom: new Date(result.validFrom),
      validUntil: result.validUntil === null ? null : new Date(result.validUntil),
      reviewedAt: result.reviewedAt === null ? null : new Date(result.reviewedAt),
      createdAt: new Date(result.createdAt),
    };
  }
  private async readAssignment(
    manager: EntityManager,
    assignmentId: string,
    siteId: string,
    lock = false,
  ) {
    const rows = await manager.query(
      `SELECT ${assignmentProjection} AS value FROM worker_site_zone_assignment WHERE id=$1 AND site_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [assignmentId, siteId],
    );
    if (!rows.length) missing();
    const parsed = assignmentSchema.safeParse(rows[0]?.value);
    if (!parsed.success)
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Assignment state is unavailable',
      });
    return parsed.data;
  }
  async request(input: unknown): Promise<MainAssignmentCommandResult> {
    const p = requestSchema.safeParse(input);
    if (!p.success) invalid();
    return this.execute('REQUEST', p.data);
  }
  async safetyReview(input: unknown): Promise<MainAssignmentCommandResult> {
    const p = reviewSchema.safeParse(input);
    if (!p.success) invalid();
    return this.execute('SAFETY_REVIEW', p.data);
  }
  async decision(input: unknown): Promise<MainAssignmentCommandResult> {
    const p = decisionSchema.safeParse(input);
    if (!p.success) invalid();
    return this.execute('DECISION', p.data);
  }
  async revoke(input: unknown): Promise<MainAssignmentCommandResult> {
    const p = revokeSchema.safeParse(input);
    if (!p.success) invalid();
    return this.execute('REVOKE', p.data);
  }

  private async authorize(
    manager: EntityManager,
    operation: Operation,
    value: WorkCommand,
  ): Promise<void> {
    const users = await manager.query(
      'SELECT id FROM app_user WHERE id=$1 AND is_active AND NOT must_change_password FOR SHARE',
      [value.actorUserId],
    );
    const role =
      operation === 'REQUEST'
        ? 'CONTRACTOR_REPRESENTATIVE'
        : operation === 'SAFETY_REVIEW'
          ? 'SAFETY_OFFICER'
          : 'SITE_MANAGER';
    const roles: { role: string; site_id: string | null }[] = await manager.query(
      'SELECT role,site_id FROM user_role_assignment WHERE user_id=$1 AND role=$2 AND site_id=$3 FOR SHARE',
      [value.actorUserId, role, value.siteId],
    );
    if (!users.length || !roles.length) forbidden();
  }
  private async representative(
    manager: EntityManager,
    value: WorkCommand,
    contractorId: string | null,
  ): Promise<void> {
    if (!contractorId) forbidden();
    if (
      !(
        await manager.query(
          'SELECT id FROM contractor_representative_grant WHERE user_id=$1 AND contractor_id=$2 FOR SHARE',
          [value.actorUserId, contractorId],
        )
      ).length
    )
      forbidden();
  }
  private async execute(
    operation: Operation,
    value: Command,
  ): Promise<MainAssignmentCommandResult> {
    const { commandId, ...body } = value;
    const requestHash = computeCanonicalPayloadHash({
      operation,
      ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    });
    const result = await withZoneAuthorityTransaction(this.source, async (manager) => {
      await this.authorize(manager, operation, value);
      const context = await manager.query(
        "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
      );
      if (context[0]?.value) conflict('Nested authority commands are not supported');
      const op = 'MAIN_ASSIGNMENT_' + operation;
      const inserted = await manager.query(
        'INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(command_id) DO NOTHING RETURNING command_id',
        [commandId, value.actorUserId, op, requestHash],
      );
      if (!inserted.length) {
        const previous = await manager.query(
          'SELECT request_hash,operation,actor_user_id FROM mf06_authority_command WHERE command_id=$1',
          [commandId],
        );
        if (
          previous[0]?.request_hash !== requestHash ||
          previous[0]?.operation !== op ||
          previous[0]?.actor_user_id !== value.actorUserId
        )
          conflict('Command ID was already used for another request');
        const receipt = await this.result(manager, commandId);
        if (receipt.assignment.siteId !== value.siteId) unavailable();
        if (operation === 'REQUEST')
          await this.representative(manager, value, receipt.contractorId);
        return { commandId, replayed: true, assignment: receipt.assignment };
      }
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      const sourceId =
        'workerId' in value
          ? await this.create(manager, value)
          : await this.transition(manager, operation, value);
      await manager.query(
        "INSERT INTO mf06_assignment_command_result(command_id,source_id,contractor_id,result_json,result_hash) SELECT $1,a.id,p.contractor_id,mf06_assignment_response(a.id),'' FROM worker_site_zone_assignment a LEFT JOIN contractor_site_participation p ON p.id=a.site_contractor_id WHERE a.id=$2",
        [commandId, sourceId],
      );
      const receipt = await this.result(manager, commandId);
      await manager.query("SELECT set_config('smartsite.mf06_command_id','',true)");
      return { commandId, replayed: false, assignment: receipt.assignment };
    }).catch((error: unknown) => {
      const code =
        error instanceof QueryFailedError
          ? (error.driverError as { code?: string }).code
          : undefined;
      if (code === '42P01' || code === '42703' || code === '42883') unavailable();
      throw error;
    });
    try {
      await this.source.query(
        'INSERT INTO mf06_authority_commit_witness(command_id,transaction_id) SELECT command_id,transaction_id FROM mf06_authority_command c WHERE command_id=$1 AND NOT EXISTS(SELECT 1 FROM mf06_authority_commit_witness w WHERE w.command_id=c.command_id) ON CONFLICT(command_id) DO NOTHING',
        [commandId],
      );
    } catch {
      unavailable();
    }
    return result;
  }

  private async create(manager: EntityManager, value: Request): Promise<string> {
    if (new Set(value.zoneIds).size !== value.zoneIds.length) conflict('Zone IDs must be unique');
    if (!value.validUntil) conflict('Worker assignment requires an expiry');
    const range = await manager.query(
      'SELECT isfinite($1::timestamptz) AND isfinite($2::timestamptz) AND $2::timestamptz>$1::timestamptz AS valid',
      [value.validFrom, value.validUntil],
    );
    if (!range[0]?.valid) invalid('validUntil must be after validFrom');
    const workers: { contractor_id: string | null }[] = await manager.query(
      'SELECT contractor_id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
      [value.workerId, value.siteId],
    );
    const worker = workers[0];
    if (!worker?.contractor_id) forbidden();
    await this.representative(manager, value, worker.contractor_id);
    if (
      !(
        await manager.query('SELECT id FROM contractor WHERE id=$1 AND is_active FOR SHARE', [
          worker.contractor_id,
        ])
      ).length
    )
      forbidden();
    const eligible = await manager.query(
      'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2 AND is_active AND valid_from<=$3::timestamptz AND (valid_until IS NULL OR valid_until>$3::timestamptz) FOR SHARE',
      [worker.contractor_id, value.siteId, value.validFrom],
    );
    if (!eligible.length) forbidden();
    // Retain main's separate active-participation lookup, including its lack of ordering.
    // Request creates a PENDING assignment; approval rechecks the stored participation anchor.
    const participations: { id: string; contained: boolean }[] = await manager.query(
      'SELECT id,($3::timestamptz<=valid_until OR valid_until IS NULL) AS contained FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2 AND is_active LIMIT 1 FOR SHARE',
      [worker.contractor_id, value.siteId, value.validUntil],
    );
    if (!participations.length)
      conflict('Assignment must fit the Contractor participation interval');
    if (!participations[0]!.contained)
      conflict('Assignment must fit the Contractor participation interval');
    const zones = await manager.query(
      'SELECT id FROM zone WHERE site_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',
      [value.siteId, value.zoneIds],
    );
    if (zones.length !== value.zoneIds.length) forbidden();
    const sourceId = randomUUID();
    await manager.query(
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,zone_ids,site_contractor_id,status,version,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,$5,'PENDING',1,$6,$7,$8)",
      [
        sourceId,
        value.workerId,
        value.siteId,
        value.zoneIds,
        participations[0]!.id,
        value.validFrom,
        value.validUntil,
        value.actorUserId,
      ],
    );
    await this.audit(
      manager,
      value,
      'WORKER_ASSIGNMENT_REQUESTED',
      sourceId,
      null,
      { workerId: value.workerId, siteContractorId: participations[0]!.id },
      false,
    );
    return sourceId;
  }
  private async transition(
    manager: EntityManager,
    operation: Operation,
    value: Transition,
  ): Promise<string> {
    const current = await this.readAssignment(manager, value.assignmentId, value.siteId, true);
    if (
      (operation === 'SAFETY_REVIEW' || operation === 'DECISION') &&
      current.requestedByUserId === value.actorUserId
    )
      forbidden();
    if (operation === 'SAFETY_REVIEW') {
      if (current.status !== 'PENDING') conflict('Assignment is not pending');
      await manager.query(
        "UPDATE worker_site_zone_assignment SET status='SAFETY_REVIEWED',safety_reviewed_by_user_id=$2,version=version+1 WHERE id=$1",
        [current.id, value.actorUserId],
      );
      await this.audit(
        manager,
        value,
        'WORKER_ASSIGNMENT_SAFETY_REVIEWED',
        current.id,
        null,
        { version: current.version + 1 },
        false,
      );
    } else if ('approve' in value) {
      if (current.status !== 'PENDING' && current.status !== 'SAFETY_REVIEWED')
        conflict('Assignment has already been reviewed');
      if (value.expectedVersion !== undefined && current.version !== value.expectedVersion)
        conflict('Assignment changed. Reload before reviewing');
      if (value.approve) await this.approvable(manager, current);
      const status = value.approve ? 'APPROVED' : 'REJECTED',
        note = value.reviewNote?.trim() || null;
      await manager.query(
        'UPDATE worker_site_zone_assignment SET status=$2,version=version+1,site_manager_decided_by_user_id=$3,reviewed_at=clock_timestamp(),review_note=$4 WHERE id=$1',
        [current.id, status, value.actorUserId, note],
      );
      await this.audit(
        manager,
        value,
        'WORKER_ASSIGNMENT_REVIEWED',
        current.id,
        note,
        { status, version: current.version + 1 },
        true,
      );
    } else if ('expectedVersion' in value && 'reviewNote' in value) {
      if (
        current.status === 'REVOKED' &&
        current.siteManagerDecidedByUserId === value.actorUserId &&
        current.reviewNote === value.reviewNote &&
        current.version === value.expectedVersion + 1
      )
        return current.id;
      if (current.status !== 'APPROVED' || current.version !== value.expectedVersion)
        conflict('Assignment changed or is not approved');
      await manager.query(
        "UPDATE worker_site_zone_assignment SET status='REVOKED',version=version+1,site_manager_decided_by_user_id=$2,reviewed_at=clock_timestamp(),review_note=$3 WHERE id=$1",
        [current.id, value.actorUserId, value.reviewNote],
      );
      await this.audit(
        manager,
        value,
        'WORKER_ASSIGNMENT_REVOKED',
        current.id,
        value.reviewNote,
        { version: current.version + 1 },
        true,
      );
    } else unavailable();
    return current.id;
  }
  private async approvable(
    manager: EntityManager,
    value: MainAssignmentCommandResult['assignment'],
  ): Promise<void> {
    if (!value.siteContractorId || !value.validUntil)
      conflict('Assignment participation or validity is unavailable');
    const workers = await manager.query(
      'SELECT contractor_id FROM worker WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
      [value.workerId, value.siteId],
    );
    const participations = await manager.query(
      'SELECT contractor_id,isfinite(valid_from) AND (valid_until IS NULL OR isfinite(valid_until)) AND valid_from<=$3::timestamptz AND (valid_until IS NULL OR valid_until>=$4::timestamptz) AND isfinite($3::timestamptz) AND isfinite($4::timestamptz) AND $4::timestamptz>clock_timestamp() AS valid FROM contractor_site_participation WHERE id=$1 AND site_id=$2 AND is_active FOR SHARE',
      [value.siteContractorId, value.siteId, value.validFrom, value.validUntil],
    );
    if (
      !workers.length ||
      !participations[0]?.valid ||
      workers[0].contractor_id !== participations[0].contractor_id
    )
      conflict('Assignment participation or validity is unavailable');
  }
  private async audit(
    manager: EntityManager,
    value: WorkCommand,
    action: string,
    sourceId: string,
    reason: string | null,
    changes: object,
    bump: boolean,
  ): Promise<void> {
    if (bump)
      await manager.query(
        'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1',
        [value.siteId],
      );
    await manager.query(
      "INSERT INTO audit_log(id,actor_account_id,site_id,action,entity_type,entity_id,reason,changes,occurred_at) VALUES($1,$2,$3,$4,'worker_assignment',$5,$6,$7,clock_timestamp())",
      [randomUUID(), value.actorUserId, value.siteId, action, sourceId, reason, changes],
    );
  }
  private async result(manager: EntityManager, commandId: string): Promise<Receipt> {
    const rows = await manager.query(
      "SELECT result_json,contractor_id,result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS hash_valid FROM mf06_assignment_command_result WHERE command_id=$1",
      [commandId],
    );
    const parsed = assignmentSchema.safeParse(rows[0]?.result_json);
    if (!parsed.success || !rows[0]?.hash_valid) unavailable();
    const contractor = id.nullable().safeParse(rows[0]?.contractor_id);
    if (!contractor.success) unavailable();
    return { assignment: parsed.data, contractorId: contractor.data };
  }
}
