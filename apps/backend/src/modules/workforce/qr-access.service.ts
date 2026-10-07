import type { EntityManager } from 'typeorm';
import type { WorkforceActor } from './contractor-operations.service.js';
import type {
  QrFallbackResponse,
  QrPassResponse,
  VisitorPassResponse,
  VisitResponse,
  VisitorGateEventResponse,
  WorkerQrVerificationResponse,
} from '@smartsite/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { SITE_GATES } from '@smartsite/contracts';
import { command, conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
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
} from '../../database/entities/index.js';
import { evaluateWorkerAccess } from './worker-access-evaluation.js';
import { auditAccess } from './access-audit.js';
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
} from './qr-access.commands.js';
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
const operators = [UserRole.SECURITY_OFFICER, UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER];
export function visitResponse(v: VisitorVisitEntity, zoneIds: string[] = []): VisitResponse {
  return {
    id: v.id,
    siteId: v.siteId,
    visitorName: v.visitorName,
    company: v.company,
    contact: v.contact,
    hostName: v.hostName,
    purpose: v.purpose,
    targetArea: v.targetArea,
    groupSize: v.groupSize,
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
        : v.enteredCount - v.exitedCount === v.groupSize
          ? 'INSIDE'
          : 'NEEDS_REVIEW',
  };
}
@Injectable()
export class QrAccessService {
  constructor(private readonly source: DataSource) {}
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
    return {
      id: attempt.id,
      status: attempt.status,
      scheduleStatus: attempt.scheduleStatus,
      expiresAt: attempt.expiresAt.toISOString(),
    };
  }
  async confirmPassage(
    actor: WorkforceActor,
    siteId: string,
    attemptId: string,
    input: ConfirmPassageCommand,
  ) {
    requireSiteRole(actor, siteId, operators);
    uuid(attemptId);
    const value = command(ConfirmPassageCommand, input);
    return this.source.transaction(async (manager) => {
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
      if (evaluation.decision.authorization !== 'ALLOWED')
        conflict('Worker permission changed. Verify again');
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
    const { requestId, accessKey, zoneIds = [], ...details } = value;
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
        visit.contact === value.contact &&
        visit.hostName === value.hostName &&
        visit.purpose === value.purpose &&
        visit.targetArea === value.targetArea &&
        visit.groupSize === value.groupSize &&
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
    requireSiteRole(actor, siteId, operators);
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
    return this.source.transaction(async (manager) => {
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
        inside === visit.groupSize
          ? 'OUT'
          : inside === 0 && visit.status === 'APPROVED' && visit.validUntil.getTime() > Date.now()
            ? 'IN'
            : null;
      const pass = direction
        ? await this.issue(manager, { visitId: visit.id }, undefined, {
            siteId: visit.siteId,
            direction,
          })
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
    requireSiteRole(actor, siteId, operators);
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
  async visitorGate(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: VerifyVisitorQrCommand,
  ): Promise<VisitorGateEventResponse> {
    requireSiteRole(actor, siteId, operators);
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
      ]),
    );
    return this.source.transaction(async (manager) => {
      const subject = await manager
        .getRepository(QrCredentialEntity)
        .findOneBy({ tokenHash: hash(value.token) });
      if (!subject?.visitId) invalid('A visitor QR is required');
      const visit = await manager
        .getRepository(VisitorVisitEntity)
        .findOne({ where: { id: subject.visitId, siteId }, lock: { mode: 'pessimistic_write' } });
      if (!visit) forbidden();
      const credential = await this.credential(manager, value.token, fingerprint);
      if (visit.gateId !== gateId) forbidden('Visit is not approved for this gate');
      if (credential.result) return credential.result as VisitorGateEventResponse;
      if (credential.siteId !== siteId || credential.direction !== value.direction)
        conflict('QR direction does not match this passage');
      if (value.count !== undefined && value.count !== visit.groupSize)
        conflict('The representative checks the entire approved group in or out');
      const inside = visit.enteredCount - visit.exitedCount;
      if (value.direction === 'IN') {
        if (visit.status !== 'APPROVED') conflict('Visit has not been approved');
        if (visit.validFrom.getTime() > Date.now() || visit.validUntil.getTime() <= Date.now())
          conflict('Visit is outside its approved schedule');
        if (inside !== 0) conflict('The group is already inside');
        if (visit.enteredCount > 2147483647 - visit.groupSize)
          conflict('Visit event counter exhausted');
        visit.enteredCount += visit.groupSize;
      } else {
        // Permit departure after the scheduled end; never add attendance time automatically.
        if (inside !== visit.groupSize) conflict('The entire group must be inside before checkout');
        visit.exitedCount += visit.groupSize;
      }
      visit.version += 1;
      await manager.getRepository(VisitorVisitEntity).save(visit);
      const event = await manager.getRepository(VisitorGateEventEntity).save({
        id: randomUUID(),
        visitId: visit.id,
        operatorUserId: actor.id,
        gateId,
        direction: value.direction,
        count: visit.groupSize,
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
        credentialId: credential.id,
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
        { visitId: visit.id, direction: value.direction, headcount: visit.groupSize },
      );
      const result = {
        id: event.id,
        visitId: visit.id,
        gateId,
        direction: event.direction,
        count: event.count,
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
      credential.consumedAt = new Date();
      credential.requestHash = fingerprint;
      credential.result = result;
      await manager.getRepository(QrCredentialEntity).save(credential);
      return result;
    });
  }
  async workerGate(
    actor: WorkforceActor,
    siteId: string,
    gateId: string,
    input: VerifyWorkerQrCommand,
  ): Promise<WorkerQrVerificationResponse> {
    requireSiteRole(actor, siteId, operators);
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
