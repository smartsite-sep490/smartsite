import type { EntityManager } from 'typeorm';
import type { WorkforceActor } from '../directory/contractor-operations.service.js';
import type {
  QrFallbackResponse,
  QrPassResponse,
  VisitorPassResponse,
  VisitResponse,
  VisitorGateEventResponse,
  WorkerQrVerificationResponse,
} from '@smartsite/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { newVisitorCode, encryptVisitorCode, decryptVisitorCode } from './visitor-code.js';
import { VisitorEmailService } from './visitor-email.service.js';
import { DataSource, In, IsNull } from 'typeorm';
import { SITE_GATES } from '@smartsite/contracts';
import {
  command,
  conflict,
  invalid,
  missing,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  ContractorEntity,
  GateAccessLogEntity,
  VisitorVisitEntity,
  VisitorGateEventEntity,
  QrCredentialEntity,
  QrFallbackSessionEntity,
  VisitorEntity,
  VisitZoneEntity,
  ZoneEntity,
  AccessAttemptEntity,
  GateEventEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  AttendanceDayEntity,
  OvertimeRequestEntity,
} from '../../../database/entities/index.js';
import { evaluateWorkerAccess } from './worker-access-evaluation.js';
import { auditAccess } from '../shared/access-audit.js';
import { AttendanceReconciliationService } from '../attendance/attendance-reconciliation.service.js';
import { isRepeatedGatePassage } from './gate-repeat-policy.js';
import { SchedulingNotificationService } from '../notifications/scheduling-notification.service.js';
import {
  RegisterVisitCommand,
  VisitDecisionCommand,
  LookupVisitorPassCommand,
  CameraFallbackCommand,
  IssueWorkerQrCommand,
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
  ConfirmPassageCommand,
  ManualWorkerVerificationCommand,
  ManualVisitCheckoutCommand,
  PreviewVisitorQrCommand,
} from './qr-access.commands.js';
import { applyVisitorAttendance, createVisitorRoster } from './visitor-roster.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const expiresInFiveMinutes = () => new Date(Date.now() + 300_000);
function forbidden(message = 'Access to this site is required'): never {
  throw new PublicHttpException(HttpStatus.FORBIDDEN, { code: 'FORBIDDEN', message });
}
export function requireSiteRole(
  actor: WorkforceActor,
  siteId: string,
  roles: readonly UserRole[],
  allowAdmin = true,
) {
  uuid(siteId);
  if (
    actor.mustChangePassword ||
    !actor.roleAssignments.some(
      (r) =>
        (allowAdmin && r.role === UserRole.ADMIN && r.siteId === null) ||
        (r.siteId === siteId && roles.includes(r.role)),
    )
  )
    forbidden();
}
export function requireGate(gateId: string) {
  if (!SITE_GATES.some((g) => g.id === gateId)) invalid('Invalid gate identifier');
}
export function visitResponse(v: VisitorVisitEntity, zoneIds: string[] = []): VisitResponse {
  return {
    id: v.id,
    siteId: v.siteId,
    visitorName: v.visitorName,
    company: v.company,
    contact: v.contact,
    email: v.email,
    emailStatus: v.emailStatus,
    hostName: v.hostName,
    purpose: v.purpose,
    targetArea: v.targetArea,
    groupSize: v.groupSize,
    members: v.members ?? [],
    gateId: v.gateId,
    validFrom: v.validFrom.toISOString(),
    validUntil: v.validUntil.toISOString(),
    status: v.status,
    enteredCount: v.enteredCount,
    exitedCount: v.exitedCount,
    createdAt: v.createdAt.toISOString(),
    decidedByUserId: v.decidedByUserId,
    representativeVisitorId: v.representativeVisitorId,
    siteManagerId: v.siteManagerId,
    version: v.version,
    reviewNote: v.reviewNote,
    zoneIds,
    presence:
      v.enteredCount === v.exitedCount
        ? 'OUTSIDE'
        : v.members?.length || v.enteredCount - v.exitedCount === v.groupSize
          ? 'INSIDE'
          : 'NEEDS_REVIEW',
  };
}
@Injectable()
export class QrAccessService {
  constructor(
    private readonly source: DataSource,
    private readonly reconciliation: AttendanceReconciliationService = new AttendanceReconciliationService(
      source,
      new SchedulingNotificationService(source),
    ),
    private readonly notifications: SchedulingNotificationService = new SchedulingNotificationService(
      source,
    ),
    @Optional() private readonly config?: ConfigService<BackendEnvironment, true>,
    @Optional() private readonly email?: VisitorEmailService,
  ) {}
  private async bookingCode(manager: EntityManager, visit: VisitorVisitEntity) {
    const stored = await manager
      .getRepository(VisitorVisitEntity)
      .createQueryBuilder('v')
      .addSelect(['v.bookingCodeHash', 'v.bookingCodeCiphertext'])
      .where('v.id = :id', { id: visit.id })
      .getOneOrFail();
    const secret = this.config?.get('AUTH_JWT_SECRET', { infer: true });
    if (!secret)
      throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Visitor QR configuration is unavailable',
      });
    if (stored.bookingCodeCiphertext)
      return decryptVisitorCode(stored.bookingCodeCiphertext, secret);
    let code: string;
    do {
      code = newVisitorCode();
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `visitor-code:${hash(code)}`,
      ]);
    } while (
      await manager.getRepository(VisitorVisitEntity).existsBy({ bookingCodeHash: hash(code) })
    );
    await manager.getRepository(VisitorVisitEntity).update(visit.id, {
      bookingCodeHash: hash(code),
      bookingCodeCiphertext: encryptVisitorCode(code, secret),
    });
    return code;
  }
  async recordAttempt(
    manager: EntityManager,
    input: {
      actor: WorkforceActor;
      siteId: string;
      gateId: string;
      direction: 'IN' | 'OUT';
      method: 'FACE' | 'QR' | 'MANUAL';
      identityStatus: string;
      authorization: string;
      reasonCode: string;
      workerId?: string;
      visitId?: string;
      credentialId?: string;
      assignmentId?: string;
      assignmentVersion?: number;
      scheduleStatus?: string;
      attemptId?: string;
    },
  ) {
    const site = await manager.getRepository(SiteEntity).findOneBy({ id: input.siteId });
    if (!site) missing();
    const attempt = await manager.getRepository(AccessAttemptEntity).save({
      id: input.attemptId ?? randomUUID(),
      siteId: input.siteId,
      gateId: input.gateId,
      operatorId: input.actor.id,
      direction: input.direction,
      method: input.method,
      credentialId: input.credentialId ?? null,
      workerId: input.workerId ?? null,
      visitId: input.visitId ?? null,
      workerAssignmentId: input.assignmentId ?? null,
      identityStatus: input.identityStatus,
      authorizationStatus:
        input.authorization === 'MANUAL_REVIEW' ? 'REVIEW_REQUIRED' : input.authorization,
      reasonCode: input.reasonCode,
      assignmentVersion: input.assignmentVersion ?? null,
      sitePolicyVersion: site.accessPolicyVersion,
      scheduleStatus: input.scheduleStatus ?? 'NOT_APPLICABLE',
      status:
        input.method === 'MANUAL'
          ? 'PENDING'
          : input.authorization === 'ALLOWED' && input.identityStatus === 'MATCHED'
            ? input.scheduleStatus === 'NO_SCHEDULE'
              ? 'PENDING'
              : 'READY'
            : input.authorization === 'DENIED'
              ? 'DENIED'
              : 'PENDING',
      expiresAt: expiresInFiveMinutes(),
      usedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    });
    if (
      input.direction === 'IN' &&
      input.authorization === 'DENIED' &&
      input.reasonCode === 'NO_SCHEDULE' &&
      input.workerId
    ) {
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneByOrFail({ id: input.workerId, siteId: input.siteId });
      await this.notifications.recordNoScheduleDenial(manager, worker);
    }
    return {
      id: attempt.id,
      status: attempt.status,
      scheduleStatus: attempt.scheduleStatus,
      expiresAt: attempt.expiresAt.toISOString(),
    };
  }
  private async repeatedPassage(
    manager: EntityManager,
    worker: WorkerEntity,
    direction: 'IN' | 'OUT',
    at: Date,
  ) {
    const previous = await manager.getRepository(GateEventEntity).findOne({
      where: { siteId: worker.siteId, workerId: worker.id },
      order: { occurredAt: 'DESC', createdAt: 'DESC', id: 'DESC' },
    });
    if (!previous || previous.direction !== direction) return false;
    const event = await manager
      .getRepository(AttendanceEventEntity)
      .findOneBy({ gateEventId: previous.id });
    const session = event
      ? await manager.getRepository(AttendanceSessionEntity).findOne({
          where: [{ checkInEventId: event.id }, { checkOutEventId: event.id }],
        })
      : null;
    const day = session?.dayId
      ? await manager.getRepository(AttendanceDayEntity).findOneByOrFail({ id: session.dayId })
      : null;
    if (day?.scheduleId) {
      const overtime = await manager
        .getRepository(OvertimeRequestEntity)
        .findBy({ scheduleId: day.scheduleId, status: 'APPROVED' });
      const end = Math.max(
        day.endsAt ? +day.endsAt : 0,
        ...overtime.map((request) => +request.endsAt),
      );
      if (end) day.endsAt = new Date(end);
    }
    return isRepeatedGatePassage(direction, at, previous, day);
  }

  async confirmPassage(
    actor: WorkforceActor,
    siteId: string,
    attemptId: string,
    input: ConfirmPassageCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    uuid(attemptId);
    const value = command(ConfirmPassageCommand, input);
    const result = await this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `gate-confirmation:${value.idempotencyKey}`,
      ]);
      const boundEvent = await manager
        .getRepository(GateEventEntity)
        .findOneBy({ idempotencyKey: value.idempotencyKey });
      if (
        boundEvent &&
        (boundEvent.accessAttemptId !== attemptId ||
          boundEvent.siteId !== siteId ||
          boundEvent.recordedBy !== actor.id)
      )
        conflict('Confirmation request was used for a different passage');
      const attempt = await manager
        .getRepository(AccessAttemptEntity)
        .findOne({ where: { id: attemptId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!attempt) missing();
      if (attempt.operatorId !== actor.id)
        forbidden('Confirm the verification from your own gate session');
      const existing = await manager
        .getRepository(GateEventEntity)
        .findOneBy({ accessAttemptId: attempt.id });
      if (existing) {
        if (existing.idempotencyKey !== value.idempotencyKey)
          conflict('Passage has already been confirmed');
        return existing;
      }
      if (attempt.status === 'DENIED' && attempt.reasonCode === 'NO_SCHEDULE')
        return { deniedNoSchedule: true as const };
      if (
        attempt.expiresAt <= new Date() ||
        !['PENDING', 'READY'].includes(attempt.status) ||
        attempt.identityStatus !== 'MATCHED' ||
        !attempt.workerId
      )
        conflict('A current verified worker attempt is required');
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOne({ where: { id: attempt.workerId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!worker) forbidden();
      const evaluation = await evaluateWorkerAccess(
        manager,
        worker,
        siteId,
        attempt.gateId,
        attempt.direction,
        new Date(),
        true,
      );
      if (evaluation.decision.reasonCode === 'NO_SCHEDULE') {
        attempt.status = 'DENIED';
        attempt.authorizationStatus = 'DENIED';
        attempt.reasonCode = 'NO_SCHEDULE';
        attempt.scheduleStatus = 'NO_SCHEDULE';
        await manager.getRepository(AccessAttemptEntity).save(attempt);
        await this.notifications.recordNoScheduleDenial(manager, worker);
        await auditAccess(
          manager,
          actor.id,
          siteId,
          'GATE_ENTRY_DENIED_NO_SCHEDULE',
          'access_attempt',
          attempt.id,
          null,
          { workerId: worker.id },
        );
        // Commit the denial and warning before mapping it to an HTTP error.
        return { deniedNoSchedule: true as const };
      }
      if (evaluation.decision.authorization !== 'ALLOWED')
        conflict('Worker permission changed. Verify again');
      if (await this.repeatedPassage(manager, worker, attempt.direction, new Date())) {
        if (!value.separatePassage) {
          throw new PublicHttpException(HttpStatus.CONFLICT, {
            code: 'GATE_PASSAGE_ALREADY_RECORDED',
            message:
              attempt.direction === 'IN'
                ? 'Already checked in. No new attendance was recorded.'
                : 'Already checked out. No new attendance was recorded.',
          });
        }
        requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
        if (!value.reviewNote || value.reviewNote.trim().length < 5)
          invalid('Record a reason of at least 5 characters for a separate physical passage');
        attempt.reviewedBy = actor.id;
        attempt.reviewedAt = new Date();
        attempt.reviewNote = value.reviewNote;
      }
      if (attempt.direction === 'IN' && evaluation.scheduleStatus !== 'SCHEDULED') {
        requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
        if (!value.reviewNote && !attempt.reviewNote)
          invalid('Security must record a reason for entry without a current shift');
        attempt.reviewedBy = actor.id;
        attempt.reviewedAt = new Date();
        attempt.reviewNote = value.reviewNote ?? attempt.reviewNote;
      }
      if (attempt.credentialId) {
        const credential = await manager
          .getRepository(QrCredentialEntity)
          .findOne({ where: { id: attempt.credentialId }, lock: { mode: 'pessimistic_write' } });
        if (
          !credential ||
          credential.consumedAt ||
          credential.revokedAt ||
          credential.expiresAt <= new Date()
        )
          conflict('QR expired, refreshed or already used. Verify a new QR');
        credential.consumedAt = new Date();
        await manager.getRepository(QrCredentialEntity).save(credential);
      }
      const event = await manager.getRepository(GateEventEntity).save({
        id: randomUUID(),
        accessAttemptId: attempt.id,
        siteId,
        workerId: worker.id,
        visitId: null,
        direction: attempt.direction,
        occurredAt: new Date(),
        gateName: attempt.gateId,
        idempotencyKey: value.idempotencyKey,
        recordedBy: actor.id,
      });
      attempt.status = 'USED';
      attempt.usedAt = event.occurredAt;
      attempt.authorizationStatus = 'ALLOWED';
      attempt.scheduleStatus = evaluation.scheduleStatus;
      attempt.workerAssignmentId = evaluation.assignment?.id ?? null;
      attempt.assignmentVersion = evaluation.assignment?.version ?? null;
      const confirmedSite = await manager.getRepository(SiteEntity).findOneByOrFail({ id: siteId });
      attempt.sitePolicyVersion = confirmedSite.accessPolicyVersion;
      await manager.getRepository(AccessAttemptEntity).save(attempt);
      await this.reconciliation.recordPassage(manager, event, attempt, worker);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'GATE_PASSAGE_CONFIRMED',
        'gate_event',
        event.id,
        attempt.reviewNote,
        {
          attemptId: attempt.id,
          workerId: worker.id,
          direction: attempt.direction,
          method: attempt.method,
        },
      );
      return event;
    });
    if ('deniedNoSchedule' in result)
      throw new PublicHttpException(HttpStatus.CONFLICT, {
        code: 'WORKER_NO_SCHEDULE',
        message: 'Worker has no assigned shift for this workday. Entry is denied.',
      });
    return result;
  }
  async manualWorker(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: ManualWorkerVerificationCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    requireGate(gateId);
    const value = command(ManualWorkerVerificationCommand, input);
    return this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `manual-access:${value.requestId}`,
      ]);
      const existing = await manager
        .getRepository(AccessAttemptEntity)
        .findOneBy({ id: value.requestId });
      if (existing) {
        if (
          existing.operatorId !== actor.id ||
          existing.siteId !== siteId ||
          existing.gateId !== gateId ||
          existing.workerId !== value.workerId ||
          existing.direction !== value.direction ||
          existing.reviewNote !== value.reviewNote ||
          existing.method !== 'MANUAL'
        )
          conflict('Request was used for a different verification');
        return {
          id: existing.id,
          status: existing.status,
          scheduleStatus: existing.scheduleStatus,
          expiresAt: existing.expiresAt.toISOString(),
        };
      }
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneBy({ id: value.workerId, siteId });
      if (!worker) missing();
      const evaluation = await evaluateWorkerAccess(
        manager,
        worker,
        siteId,
        gateId,
        value.direction,
      );
      const attempt = await this.recordAttempt(manager, {
        actor,
        siteId,
        gateId,
        direction: value.direction,
        method: 'MANUAL',
        identityStatus: 'MATCHED',
        authorization: evaluation.decision.authorization,
        reasonCode: evaluation.decision.reasonCode,
        workerId: worker.id,
        assignmentId: evaluation.assignment?.id,
        assignmentVersion: evaluation.assignment?.version,
        scheduleStatus: evaluation.scheduleStatus,
        attemptId: value.requestId,
      });
      const status =
        evaluation.decision.authorization === 'ALLOWED' ? ('READY' as const) : ('DENIED' as const);
      await manager.getRepository(AccessAttemptEntity).update(attempt.id, {
        status,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNote: value.reviewNote,
      });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'WORKER_IDENTITY_MANUALLY_VERIFIED',
        'access_attempt',
        attempt.id,
        value.reviewNote,
        { workerId: worker.id, authorization: evaluation.decision.authorization },
      );
      return { ...attempt, status };
    });
  }
  async publicSites() {
    const sites = await this.source
      .getRepository(SiteEntity)
      .find({ order: { code: 'ASC' }, take: 100 });
    return { items: sites.map((s) => ({ id: s.id, name: s.name, code: s.code })) };
  }
  async manualVisitCheckout(
    actor: WorkforceActor,
    siteId: string,
    visitId: string,
    input: ManualVisitCheckoutCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    const value = command(ManualVisitCheckoutCommand, input);
    uuid(visitId);
    return this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `gate-confirmation:${value.requestId}`,
      ]);
      const visit = await manager
        .getRepository(VisitorVisitEntity)
        .findOne({ where: { id: visitId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!visit) missing();
      const existing = await manager
        .getRepository(GateEventEntity)
        .findOneBy({ idempotencyKey: value.requestId });
      if (existing) {
        const verification = await manager
          .getRepository(AccessAttemptEntity)
          .findOneBy({ id: existing.accessAttemptId });
        if (
          existing.visitId !== visitId ||
          existing.siteId !== siteId ||
          existing.recordedBy !== actor.id ||
          verification?.method !== 'MANUAL' ||
          verification.reviewNote !== value.reviewNote
        )
          conflict('Request was used for a different checkout');
        return visitResponse(visit);
      }
      const remaining = visit.enteredCount - visit.exitedCount;
      if (remaining <= 0) conflict('The group is already outside');
      const legacyPartial = remaining !== visit.groupSize;
      const now = new Date();
      const attempt = await this.recordAttempt(manager, {
        actor,
        siteId,
        gateId: visit.gateId,
        direction: 'OUT',
        method: 'MANUAL',
        identityStatus: 'MATCHED',
        authorization: 'ALLOWED',
        reasonCode: 'EXIT_RECORD_ONLY',
        visitId,
      });
      await manager.getRepository(AccessAttemptEntity).update(attempt.id, {
        status: 'USED',
        usedAt: now,
        reviewedBy: actor.id,
        reviewedAt: now,
        reviewNote: value.reviewNote,
      });
      const compatibilityEvent = await manager.getRepository(VisitorGateEventEntity).save({
        id: randomUUID(),
        visitId,
        operatorUserId: actor.id,
        gateId: visit.gateId,
        direction: 'OUT',
        count: remaining,
        attendees: (visit.members ?? [])
          .filter((m) => m.inside)
          .map((m) => ({
            memberId: m.id,
            fullName: m.fullName,
            identityNumber: m.identityNumber,
          })),
      });
      await manager.getRepository(GateEventEntity).save({
        id: compatibilityEvent.id,
        accessAttemptId: attempt.id,
        siteId,
        workerId: null,
        visitId,
        direction: 'OUT',
        occurredAt: now,
        gateName: visit.gateId,
        idempotencyKey: value.requestId,
        recordedBy: actor.id,
      });
      visit.exitedCount = visit.enteredCount;
      visit.members = (visit.members ?? []).map((m) => ({ ...m, inside: false }));
      visit.version += 1;
      await manager.getRepository(VisitorVisitEntity).save(visit);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        legacyPartial ? 'LEGACY_VISITOR_PRESENCE_RECONCILED' : 'VISITOR_MANUAL_CHECKOUT',
        'gate_event',
        compatibilityEvent.id,
        value.reviewNote,
        {
          visitId,
          headcount: visit.groupSize,
          previousRecordedInside: remaining,
          representativeConfirmed: true,
        },
      );
      return visitResponse(visit);
    });
  }
  async publicZones(siteId: string) {
    uuid(siteId);
    const zones = await this.source
      .getRepository(ZoneEntity)
      .find({ where: { siteId }, order: { name: 'ASC', id: 'ASC' }, take: 100 });
    return { items: zones.map((z) => ({ id: z.id, name: z.name })) };
  }
  async register(siteId: string, input: RegisterVisitCommand): Promise<VisitResponse> {
    uuid(siteId);
    const value = command(RegisterVisitCommand, input);
    const roster = createVisitorRoster(value.groupSize, value.members);
    const validFrom = new Date(value.validFrom),
      validUntil = new Date(value.validUntil);
    if (validUntil <= validFrom || validUntil.getTime() <= Date.now())
      invalid('Visit dates must be a future valid interval');
    if (!(await this.source.getRepository(SiteEntity).existsBy({ id: siteId }))) missing();
    // Requests are routed by persisted site_id, never by a client-supplied manager ID.
    const assignedManager = await this.source
      .getRepository(UserRoleAssignmentEntity)
      .createQueryBuilder('role')
      .innerJoin(
        UserEntity,
        'account',
        'account.id = role.user_id AND account.is_active = TRUE AND account.must_change_password = FALSE',
      )
      .where('role.site_id = :siteId AND role.role = :role', {
        siteId,
        role: UserRole.SITE_MANAGER,
      })
      .orderBy('role.created_at', 'ASC')
      .addOrderBy('role.id', 'ASC')
      .getOne();
    if (!assignedManager) conflict('This site has no active Site Manager to approve visits');
    const { requestId, accessKey, zoneIds = [], members: registeredMembers, ...details } = value;
    return this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `visit-registration:${requestId}`,
      ]);
      const zones = zoneIds.length
        ? await manager.getRepository(ZoneEntity).findBy({ id: In(zoneIds), siteId })
        : [];
      if (zones.length !== zoneIds.length)
        forbidden('Visitor zones must belong to the registered site');
      let visit = await manager.getRepository(VisitorVisitEntity).findOneBy({ id: requestId });
      if (!visit) {
        const activeManager = await manager
          .getRepository(UserRoleAssignmentEntity)
          .existsBy({ userId: assignedManager.userId, siteId, role: UserRole.SITE_MANAGER });
        const managerAccount = await manager
          .getRepository(UserEntity)
          .findOneBy({ id: assignedManager.userId, isActive: true, mustChangePassword: false });
        if (!activeManager || !managerAccount)
          conflict('Site Manager assignment changed. Retry registration');
        const representative = await manager.getRepository(VisitorEntity).save({
          id: randomUUID(),
          fullName: value.visitorName,
          contact: value.contact,
          organization: value.company,
          identityReference: null,
        });
        visit = await manager.getRepository(VisitorVisitEntity).save({
          ...details,
          members: roster,
          email: value.email ?? null,
          language: value.language ?? 'en',
          id: requestId,
          siteId,
          accessKeyHash: hash(accessKey),
          validFrom,
          validUntil,
          representativeVisitorId: representative.id,
          siteManagerId: assignedManager.userId,
          version: 1,
          reviewNote: null,
        });
        for (const zoneId of zoneIds)
          await manager.getRepository(VisitZoneEntity).save({
            id: randomUUID(),
            visitId: visit.id,
            zoneId,
            validFrom,
            validUntil,
            revokedAt: null,
          });
        await auditAccess(manager, null, siteId, 'VISIT_REGISTERED', 'visit', visit.id, null, {
          representativeVisitorId: representative.id,
          siteManagerId: assignedManager.userId,
          headcount: visit.groupSize,
        });
      }
      if (visit.siteId !== siteId || visit.accessKeyHash !== hash(accessKey)) {
        // access_key_hash is select:false; fetch the digest solely for retry binding.
        const binding = await manager
          .getRepository(VisitorVisitEntity)
          .createQueryBuilder('v')
          .addSelect('v.accessKeyHash')
          .where('v.id=:id', { id: requestId })
          .getOne();
        if (binding?.siteId !== siteId || binding.accessKeyHash !== hash(accessKey))
          conflict('Registration reference already exists');
      }
      const storedZones = await manager
        .getRepository(VisitZoneEntity)
        .findBy({ visitId: visit.id });
      const sameDetails =
        visit.visitorName === value.visitorName &&
        visit.company === value.company &&
        (visit.email ?? null) === (value.email ?? null) &&
        visit.language === (value.language ?? 'en') &&
        visit.contact === value.contact &&
        visit.hostName === value.hostName &&
        visit.purpose === value.purpose &&
        visit.targetArea === value.targetArea &&
        visit.groupSize === value.groupSize &&
        JSON.stringify(
          (visit.members ?? []).map((m) => ({
            fullName: m.registeredFullName,
            identityNumber: m.registeredIdentityNumber,
          })),
        ) ===
          JSON.stringify(
            (registeredMembers ?? []).map((m) => ({
              fullName: m.fullName,
              identityNumber: m.identityNumber,
            })),
          ) &&
        visit.gateId === value.gateId &&
        visit.validFrom.getTime() === validFrom.getTime() &&
        visit.validUntil.getTime() === validUntil.getTime() &&
        storedZones
          .map((z) => z.zoneId)
          .sort()
          .join(',') === [...zoneIds].sort().join(',');
      if (!sameDetails) conflict('Registration reference was used for different details');
      return visitResponse(visit, zoneIds);
    });
  }
  async listVisits(actor: WorkforceActor, siteId: string) {
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER]);
    const items = await this.source
      .getRepository(VisitorVisitEntity)
      .find({ where: { siteId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
    const zones = items.length
      ? await this.source
          .getRepository(VisitZoneEntity)
          .findBy({ visitId: In(items.map((v) => v.id)), revokedAt: IsNull() })
      : [];
    return {
      items: items.map((v) =>
        visitResponse(
          v,
          zones.filter((z) => z.visitId === v.id).map((z) => z.zoneId),
        ),
      ),
    };
  }
  async retryVisitorEmail(actor: WorkforceActor, siteId: string, visitId: string) {
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER], false);
    uuid(visitId);
    const visit = await this.source
      .getRepository(VisitorVisitEntity)
      .findOneBy({ id: visitId, siteId });
    if (!visit) missing();
    if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(visit.status) || !visit.email)
      conflict('Visit has no decision email');
    if (visit.emailStatus === 'FAILED')
      await this.source.getRepository(VisitorVisitEntity).update(
        { id: visit.id, status: visit.status, emailStatus: 'FAILED' },
        {
          emailStatus: 'PENDING',
          emailAttempts: 0,
          emailNextAttemptAt: null,
        },
      );
    if (visit.emailStatus === 'PENDING')
      await this.source
        .getRepository(VisitorVisitEntity)
        .update(
          { id: visit.id, status: visit.status, emailStatus: 'PENDING' },
          { emailNextAttemptAt: null },
        );
    await this.email?.deliver(visitId);
    return visitResponse(
      await this.source.getRepository(VisitorVisitEntity).findOneByOrFail({ id: visitId, siteId }),
    );
  }
  async decideVisit(
    actor: WorkforceActor,
    siteId: string,
    visitId: string,
    input: VisitDecisionCommand,
  ) {
    // Only the Site Manager assigned to the registered site can approve, including for global Admin accounts.
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER], false);
    const value = command(VisitDecisionCommand, input);
    uuid(visitId);
    const result = await this.source.transaction(async (manager) => {
      const repo = manager.getRepository(VisitorVisitEntity);
      const visit = await repo.findOne({
        where: { id: visitId, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) missing();
      const activeZones = await manager
        .getRepository(VisitZoneEntity)
        .findBy({ visitId: visit.id, revokedAt: IsNull() });
      if (
        visit.status === value.status &&
        visit.decidedByUserId === actor.id &&
        visit.reviewNote === (value.reviewNote ?? null)
      )
        return visitResponse(
          visit,
          activeZones.map((z) => z.zoneId),
        );
      if (value.expectedVersion !== undefined && value.expectedVersion !== visit.version)
        conflict('Visit changed. Reload before reviewing');
      if (value.status === 'CANCELLED') {
        if (!['PENDING', 'APPROVED'].includes(visit.status)) conflict('Visit cannot be cancelled');
        if (!value.reviewNote) invalid('A cancellation reason is required');
      } else {
        if (visit.status !== 'PENDING') conflict('Visit has already been reviewed');
        if (visit.validUntil.getTime() <= Date.now()) conflict('Visit schedule has expired');
      }
      visit.status = value.status;
      visit.decidedByUserId = actor.id;
      visit.decidedAt = new Date();
      visit.reviewNote = value.reviewNote ?? null;
      if (value.status === 'APPROVED') {
        await this.bookingCode(manager, visit);
      }
      if (visit.email) {
        visit.emailStatus = 'PENDING';
        visit.emailAttempts = 0;
        visit.emailAttemptedAt = null;
        visit.emailSentAt = null;
        visit.emailNextAttemptAt = null;
      }
      visit.version += 1;
      await repo.save(visit);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'VISIT_REVIEWED',
        'visit',
        visit.id,
        visit.reviewNote,
        { status: visit.status, version: visit.version },
      );
      if (value.status === 'CANCELLED') {
        await manager
          .getRepository(QrCredentialEntity)
          .update({ visitId: visit.id, consumedAt: IsNull() }, { revokedAt: new Date() });
        await manager
          .getRepository(VisitZoneEntity)
          .update({ visitId: visit.id, revokedAt: IsNull() }, { revokedAt: new Date() });
      }
      return visitResponse(
        visit,
        value.status === 'CANCELLED' ? [] : activeZones.map((z) => z.zoneId),
      );
    });
    if (this.email) {
      await this.email.deliver(result.id);
      return visitResponse(
        await this.source.getRepository(VisitorVisitEntity).findOneByOrFail({ id: result.id }),
        result.zoneIds,
      );
    }
    return result;
  }
  async visitorPass(input: LookupVisitorPassCommand): Promise<VisitorPassResponse> {
    const value = command(LookupVisitorPassCommand, input);
    return this.source.transaction(async (manager) => {
      const visit = await manager.getRepository(VisitorVisitEntity).findOne({
        where: { id: value.visitId, accessKeyHash: hash(value.accessKey) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) missing();
      const inside = visit.enteredCount - visit.exitedCount;
      if (
        visit.validUntil.getTime() <= Date.now() &&
        ['PENDING', 'APPROVED'].includes(visit.status)
      ) {
        visit.status = 'EXPIRED';
        visit.version += 1;
        await manager.getRepository(VisitorVisitEntity).save(visit);
      }
      const direction =
        inside > 0 && (visit.members?.length || inside === visit.groupSize)
          ? 'OUT'
          : inside === 0 && visit.status === 'APPROVED' && visit.validUntil.getTime() > Date.now()
            ? 'IN'
            : null;
      const pass: QrPassResponse | null =
        direction || (visit.status === 'EXPIRED' && visit.decidedByUserId)
          ? {
              token: await this.bookingCode(manager, visit),
              expiresAt: null,
              direction: direction ?? ('IN' as const),
            }
          : null;
      const zones = await manager
        .getRepository(VisitZoneEntity)
        .findBy({ visitId: visit.id, revokedAt: IsNull() });
      return {
        visit: visitResponse(
          visit,
          zones.map((z) => z.zoneId),
        ),
        pass,
      };
    });
  }
  async cameraFallback(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: CameraFallbackCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    requireGate(gateId);
    const value = command(CameraFallbackCommand, input);
    if (!(await this.source.getRepository(SiteEntity).existsBy({ id: siteId }))) missing();
    // This records an authorized operator's report of unavailable hardware, not AI evidence.
    return this.openFallback(actor, siteId, gateId, value.direction, value.reason);
  }
  async openFallback(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    direction: 'IN' | 'OUT',
    reason: string,
  ): Promise<QrFallbackResponse> {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    const session = await this.source.getRepository(QrFallbackSessionEntity).save({
      id: randomUUID(),
      siteId,
      gateId,
      operatorUserId: actor.id,
      direction,
      reason,
      expiresAt: expiresInFiveMinutes(),
    });
    return {
      id: session.id,
      siteId,
      gateId,
      direction,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
  async workerPass(
    actor: WorkforceActor,
    siteId: string,
    input: IssueWorkerQrCommand,
  ): Promise<QrPassResponse> {
    requireSiteRole(actor, siteId, [UserRole.WORKER], false);
    const value = command(IssueWorkerQrCommand, input);
    return this.source.transaction(async (manager) => {
      const session = await manager.getRepository(QrFallbackSessionEntity).findOne({
        where: { id: value.fallbackSessionId, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.consumedAt || session.expiresAt.getTime() <= Date.now())
        conflict('Fallback session is unavailable or expired');
      const worker = await manager.getRepository(WorkerEntity).findOneBy({
        siteId,
        userId: actor.id,
        ...(session.direction === 'IN' ? { isActive: true } : {}),
      });
      if (!worker) forbidden('No active worker linked to this account at this site');
      return this.issue(
        manager,
        { workerId: worker.id, fallbackSessionId: session.id },
        session.expiresAt,
      );
    });
  }
  async issue(
    manager: EntityManager,
    subject: { visitId?: string; workerId?: string; fallbackSessionId?: string },
    expiresAt = expiresInFiveMinutes(),
    context?: { siteId: string; direction: 'IN' | 'OUT' },
  ): Promise<QrPassResponse> {
    // Previously issued images expire when refreshed; consumed credentials retain retry results.
    await manager
      .getRepository(QrCredentialEntity)
      .update({ ...subject, consumedAt: IsNull() }, { revokedAt: new Date() });
    const fallback = subject.fallbackSessionId
      ? await manager
          .getRepository(QrFallbackSessionEntity)
          .findOneBy({ id: subject.fallbackSessionId })
      : null;
    const bound =
      context ?? (fallback ? { siteId: fallback.siteId, direction: fallback.direction } : null);
    if (!bound) conflict('QR requires a site and direction');
    const token = `SSQ-${randomBytes(32).toString('hex')}`;
    await manager.getRepository(QrCredentialEntity).save({
      id: randomUUID(),
      tokenHash: hash(token),
      ...subject,
      ...bound,
      expiresAt,
      revokedAt: null,
    });
    return { token, expiresAt: expiresAt.toISOString(), direction: bound.direction };
  }
  async credential(manager: EntityManager, token: string, fingerprint: string) {
    const credential = await manager
      .getRepository(QrCredentialEntity)
      .findOne({ where: { tokenHash: hash(token) }, lock: { mode: 'pessimistic_write' } });
    if (!credential) invalid('Invalid QR credential');
    if (credential.result && credential.requestHash !== fingerprint)
      conflict('QR has already been used. Request a new QR');
    if (credential.consumedAt) {
      if (credential.requestHash === fingerprint && credential.result) return credential;
      conflict('QR has already been used. Request a new QR');
    }
    if (credential.revokedAt || credential.expiresAt.getTime() <= Date.now())
      conflict('QR has expired or been revoked. Request a new QR');
    return credential;
  }
  async previewVisitorQr(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: PreviewVisitorQrCommand,
  ) {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    requireGate(gateId);
    const value = command(PreviewVisitorQrCommand, input);
    return this.source.transaction(async (manager) => {
      if (!value.token.startsWith('SSQ-')) {
        const visit = await manager.getRepository(VisitorVisitEntity).findOne({
          where: { bookingCodeHash: hash(value.token), siteId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!visit) invalid('Invalid QR credential');
        if (visit.gateId !== gateId) forbidden('Visit is not approved for this gate');
        const direction =
          visit.enteredCount > visit.exitedCount ? ('OUT' as const) : ('IN' as const);
        if (
          direction === 'IN' &&
          (visit.status !== 'APPROVED' ||
            visit.validFrom.getTime() > Date.now() ||
            visit.validUntil.getTime() <= Date.now())
        )
          conflict('Visit is outside its approved schedule');
        return { visit: visitResponse(visit), direction, expiresAt: null };
      }
      const subject = await manager
        .getRepository(QrCredentialEntity)
        .findOneBy({ tokenHash: hash(value.token) });
      if (!subject?.visitId) invalid('A visitor QR is required');
      const visit = await manager.getRepository(VisitorVisitEntity).findOne({
        where: { id: subject.visitId, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) forbidden();
      const credential = await this.credential(manager, value.token, 'preview');
      if (credential.siteId !== siteId || visit.gateId !== gateId)
        forbidden('Visit is not approved for this gate');
      if (
        credential.direction === 'IN' &&
        (visit.status !== 'APPROVED' ||
          visit.validFrom.getTime() > Date.now() ||
          visit.validUntil.getTime() <= Date.now())
      )
        conflict('Visit is outside its approved schedule');
      return {
        visit: visitResponse(visit),
        direction: credential.direction,
        expiresAt: credential.expiresAt.toISOString(),
      };
    });
  }
  async listVisitorEvents(actor: WorkforceActor, siteId: string) {
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER]);
    const events = await this.source
      .getRepository(VisitorGateEventEntity)
      .createQueryBuilder('event')
      .innerJoin(
        VisitorVisitEntity,
        'visit',
        'visit.id = event.visit_id AND visit.site_id = :siteId',
        { siteId },
      )
      .orderBy('event.created_at', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .take(100)
      .getMany();
    const visits = events.length
      ? await this.source
          .getRepository(VisitorVisitEntity)
          .findBy({ siteId, id: In(events.map((e) => e.visitId)) })
      : [];
    return {
      items: events.map((e) => ({
        id: e.id,
        visitId: e.visitId,
        gateId: e.gateId,
        direction: e.direction,
        count: e.count,
        createdAt: e.createdAt.toISOString(),
        attendees: e.attendees,
        visit: visitResponse(visits.find((v) => v.id === e.visitId)!),
      })),
    };
  }
  async visitorGate(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: VerifyVisitorQrCommand,
  ): Promise<VisitorGateEventResponse> {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    requireGate(gateId);
    const value = command(VerifyVisitorQrCommand, input);
    const fingerprint = hash(
      JSON.stringify([
        actor.id,
        siteId,
        gateId,
        value.requestId,
        value.direction,
        value.count ?? null,
        value.expectedVersion ?? null,
        value.attendees ?? null,
      ]),
    );
    return this.source.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `gate-confirmation:${value.requestId}`,
      ]);
      const permanent = !value.token.startsWith('SSQ-');
      const subject = permanent
        ? null
        : await manager
            .getRepository(QrCredentialEntity)
            .findOneBy({ tokenHash: hash(value.token) });
      if (!permanent && !subject?.visitId) invalid('A visitor QR is required');
      const visit = await manager.getRepository(VisitorVisitEntity).findOne({
        where: permanent
          ? { bookingCodeHash: hash(value.token), siteId }
          : { id: subject!.visitId!, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!visit) forbidden();
      const credential = permanent
        ? null
        : await this.credential(manager, value.token, fingerprint);
      if (visit.gateId !== gateId) forbidden('Visit is not approved for this gate');
      const bound = await manager
        .getRepository(GateEventEntity)
        .findOneBy({ idempotencyKey: value.requestId });
      if (bound) {
        const event = await manager
          .getRepository(VisitorGateEventEntity)
          .findOneBy({ id: bound.id });
        if (
          !event ||
          bound.visitId !== visit.id ||
          bound.siteId !== siteId ||
          bound.recordedBy !== actor.id ||
          event.requestHash !== fingerprint
        )
          conflict('Confirmation request was used for a different passage');
        return {
          id: event.id,
          visitId: visit.id,
          gateId: event.gateId,
          direction: event.direction,
          count: event.count,
          createdAt: event.createdAt.toISOString(),
          attendees: event.attendees,
          visit: visitResponse(visit),
        };
      }
      if (credential?.result) return credential.result as VisitorGateEventResponse;
      if (credential && (credential.siteId !== siteId || credential.direction !== value.direction))
        conflict('QR direction does not match this passage');
      let attendees: import('@smartsite/contracts').VisitorAttendanceResponse[] = [];
      let count = visit.groupSize;
      if (visit.members?.length) {
        if (value.expectedVersion !== visit.version)
          conflict('Visit changed. Reload before confirming');
        const selected =
          value.attendees ??
          (visit.groupSize === 1
            ? [
                {
                  memberId: visit.members[0]!.id,
                  fullName: visit.members[0]!.fullName,
                  identityNumber: visit.members[0]!.identityNumber,
                },
              ]
            : []);
        const attendance = applyVisitorAttendance(visit.members, value.direction, selected);
        if (value.count !== undefined && value.count !== attendance.attendees.length)
          invalid('VISITOR_ATTENDANCE_SIZE');
        visit.members = attendance.members;
        attendees = attendance.attendees;
        count = attendees.length;
      } else if (
        value.attendees?.length ||
        (value.count !== undefined && value.count !== visit.groupSize)
      ) {
        conflict('The representative checks the entire approved group in or out');
      }
      const inside = visit.enteredCount - visit.exitedCount;
      if (value.direction === 'IN') {
        if (visit.status !== 'APPROVED') conflict('Visit has not been approved');
        if (visit.validFrom.getTime() > Date.now() || visit.validUntil.getTime() <= Date.now())
          conflict('Visit is outside its approved schedule');
        if (inside + count > visit.groupSize)
          conflict('Visitor count exceeds the approved group size');
        if (visit.enteredCount > 2147483647 - count) conflict('Visit event counter exhausted');
        visit.enteredCount += count;
      } else {
        // Permit departure after the scheduled end; never add attendance time automatically.
        if (inside < count) conflict('Visitor count exceeds the people inside');
        visit.exitedCount += count;
      }
      visit.version += 1;
      await manager.getRepository(VisitorVisitEntity).save(visit);
      const event = await manager.getRepository(VisitorGateEventEntity).save({
        id: randomUUID(),
        visitId: visit.id,
        operatorUserId: actor.id,
        gateId,
        direction: value.direction,
        count,
        attendees,
        requestHash: fingerprint,
      });
      const attempt = await this.recordAttempt(manager, {
        actor,
        siteId,
        gateId,
        direction: value.direction,
        method: 'QR',
        identityStatus: 'MATCHED',
        authorization: 'ALLOWED',
        reasonCode: value.direction === 'OUT' ? 'EXIT_RECORD_ONLY' : 'VISIT_APPROVED',
        visitId: visit.id,
        credentialId: credential?.id,
      });
      await manager.getRepository(GateEventEntity).save({
        id: event.id,
        accessAttemptId: attempt.id,
        siteId,
        workerId: null,
        visitId: visit.id,
        direction: value.direction,
        occurredAt: event.createdAt,
        gateName: gateId,
        idempotencyKey: value.requestId,
        recordedBy: actor.id,
      });
      await manager
        .getRepository(AccessAttemptEntity)
        .update(attempt.id, { status: 'USED', usedAt: event.createdAt });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'GATE_PASSAGE_CONFIRMED',
        'gate_event',
        event.id,
        null,
        {
          visitId: visit.id,
          direction: value.direction,
          headcount: count,
          replacedMemberIds: attendees.filter((a) => a.replacedFrom).map((a) => a.memberId),
        },
      );
      const result = {
        id: event.id,
        visitId: visit.id,
        gateId,
        direction: event.direction,
        count: event.count,
        attendees,
        createdAt: event.createdAt.toISOString(),
        visit: visitResponse(
          visit,
          (
            await manager
              .getRepository(VisitZoneEntity)
              .findBy({ visitId: visit.id, revokedAt: IsNull() })
          ).map((z) => z.zoneId),
        ),
      };
      if (credential) {
        credential.consumedAt = new Date();
        credential.requestHash = fingerprint;
        credential.result = result;
        await manager.getRepository(QrCredentialEntity).save(credential);
      }
      return result;
    });
  }
  async workerGate(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: VerifyWorkerQrCommand,
  ): Promise<WorkerQrVerificationResponse> {
    requireSiteRole(actor, siteId, [UserRole.SECURITY_OFFICER], false);
    requireGate(gateId);
    const value = command(VerifyWorkerQrCommand, input);
    const fingerprint = hash(
      JSON.stringify([actor.id, siteId, gateId, value.requestId, value.direction]),
    );
    return this.source.transaction(async (manager) => {
      const subjectCredential = await manager
        .getRepository(QrCredentialEntity)
        .findOneBy({ tokenHash: hash(value.token) });
      if (!subjectCredential?.workerId || !subjectCredential.fallbackSessionId)
        invalid('A worker QR is required');
      const session = await manager.getRepository(QrFallbackSessionEntity).findOne({
        where: {
          id: subjectCredential.fallbackSessionId,
          siteId,
          gateId,
          operatorUserId: actor.id,
          direction: value.direction,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) forbidden('QR does not belong to this gate fallback session');
      const credential = await this.credential(manager, value.token, fingerprint);
      if (credential.result) return credential.result as WorkerQrVerificationResponse;
      if (credential.siteId !== siteId || credential.direction !== value.direction)
        invalid('QR Site or direction does not match');
      if (session.consumedAt || session.expiresAt.getTime() <= Date.now())
        conflict('Fallback session has expired or has been used');
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneBy({ id: subjectCredential.workerId, siteId });
      if (!worker || !worker.userId) forbidden();
      const account = await manager
        .getRepository(UserEntity)
        .findOneBy({ id: worker.userId, isActive: true });
      const role = await manager
        .getRepository(UserRoleAssignmentEntity)
        .findOneBy({ userId: worker.userId, siteId, role: UserRole.WORKER });
      if (!account || account.mustChangePassword || !role)
        forbidden('Worker account is unavailable');
      const contractor = worker.contractorId
        ? await manager.getRepository(ContractorEntity).findOneBy({ id: worker.contractorId })
        : null;
      const now = new Date();
      const evaluation = await evaluateWorkerAccess(
        manager,
        worker,
        siteId,
        gateId,
        value.direction,
        now,
      );
      const decision = evaluation.decision;
      const subject = {
        id: worker.id,
        userId: account.id,
        username: account.username,
        externalId: worker.externalId,
        displayName: worker.displayName,
        contractorName: contractor?.name ?? '',
        assignmentStatus: evaluation.assignment ? 'APPROVED' : 'MISSING',
      };
      const log = await manager.getRepository(GateAccessLogEntity).save({
        id: randomUUID(),
        siteId,
        gateId,
        operatorUserId: actor.id,
        direction: value.direction,
        method: 'QR',
        workerId: worker.id,
        userId: account.id,
        workerName: worker.displayName,
        workerExternalId: worker.externalId,
        contractorName: contractor?.name ?? null,
        username: account.username,
        decision,
      });
      const result = {
        ...decision,
        attempt: await this.recordAttempt(manager, {
          actor,
          siteId,
          gateId,
          direction: value.direction,
          method: 'QR',
          identityStatus: 'MATCHED',
          authorization: decision.authorization,
          reasonCode: decision.reasonCode,
          workerId: worker.id,
          credentialId: credential.id,
          assignmentId: evaluation.assignment?.id,
          assignmentVersion: evaluation.assignment?.version,
          scheduleStatus: evaluation.scheduleStatus,
        }),
        worker: subject,
        log: {
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          gateId: log.gateId,
          direction: log.direction,
          workerId: log.workerId,
          userId: log.userId,
          workerName: log.workerName,
          workerExternalId: log.workerExternalId,
          contractorName: log.contractorName,
          username: log.username,
          method: log.method,
          decision: log.decision,
        },
      };
      if (decision.authorization !== 'ALLOWED') credential.consumedAt = now;
      credential.requestHash = fingerprint;
      credential.result = result;
      session.consumedAt = now;
      await manager.getRepository(QrCredentialEntity).save(credential);
      await manager.getRepository(QrFallbackSessionEntity).save(session);
      return result;
    });
  }
}
