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
import { DataSource, IsNull } from 'typeorm';
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
  ContractorSiteParticipationEntity,
  FaceProfileEntity,
  WorkerGatePermissionEntity,
  GateAccessLogEntity,
  VisitorVisitEntity,
  VisitorGateEventEntity,
  QrCredentialEntity,
  QrFallbackSessionEntity,
} from '../../database/entities/index.js';
import { authorizeGateEntry } from './gate-authorization-policy.js';
import {
  RegisterVisitCommand,
  VisitDecisionCommand,
  LookupVisitorPassCommand,
  CameraFallbackCommand,
  IssueWorkerQrCommand,
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
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
export function visitResponse(v: VisitorVisitEntity): VisitResponse {
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
  };
}
@Injectable()
export class QrAccessService {
  constructor(private readonly source: DataSource) {}
  async publicSites() {
    const sites = await this.source
      .getRepository(SiteEntity)
      .find({ order: { code: 'ASC' }, take: 100 });
    return { items: sites.map((s) => ({ id: s.id, name: s.name, code: s.code })) };
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
    const manager = await this.source
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
      .getOne();
    if (!manager) conflict('This site has no active Site Manager to approve visits');
    const { requestId, accessKey, ...details } = value;
    await this.source
      .getRepository(VisitorVisitEntity)
      .createQueryBuilder()
      .insert()
      .values({
        ...details,
        id: requestId,
        siteId,
        accessKeyHash: hash(accessKey),
        validFrom,
        validUntil,
      })
      .orIgnore()
      .execute();
    const visit = await this.source
      .getRepository(VisitorVisitEntity)
      .findOneBy({ id: requestId, siteId, accessKeyHash: hash(accessKey) });
    if (!visit) conflict('Registration reference already exists');
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
      visit.validUntil.getTime() === validUntil.getTime();
    if (!sameDetails) conflict('Registration reference was used for different details');
    return visitResponse(visit);
  }
  async listVisits(actor: WorkforceActor, siteId: string) {
    requireSiteRole(actor, siteId, operators);
    const items = await this.source
      .getRepository(VisitorVisitEntity)
      .find({ where: { siteId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
    return { items: items.map(visitResponse) };
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
      if (visit.status === value.status && visit.decidedByUserId === actor.id)
        return visitResponse(visit);
      if (visit.status !== 'PENDING') conflict('Visit has already been reviewed');
      if (visit.validUntil.getTime() <= Date.now()) conflict('Visit schedule has expired');
      visit.status = value.status;
      visit.decidedByUserId = actor.id;
      visit.decidedAt = new Date();
      await repo.save(visit);
      return visitResponse(visit);
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
      const pass =
        visit.status === 'APPROVED' &&
        ((visit.validUntil.getTime() > Date.now() && visit.enteredCount < visit.groupSize) ||
          visit.enteredCount > visit.exitedCount)
          ? await this.issue(manager, { visitId: visit.id })
          : null;
      return { visit: visitResponse(visit), pass };
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
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneBy({ siteId, userId: actor.id, isActive: true });
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
  ): Promise<QrPassResponse> {
    // Previously issued images expire when refreshed; consumed credentials retain retry results.
    await manager
      .getRepository(QrCredentialEntity)
      .update({ ...subject, consumedAt: IsNull() }, { expiresAt: new Date(0) });
    const token = `SSQ-${randomBytes(32).toString('hex')}`;
    await manager
      .getRepository(QrCredentialEntity)
      .save({ id: randomUUID(), tokenHash: hash(token), ...subject, expiresAt });
    return { token, expiresAt: expiresAt.toISOString() };
  }
  async credential(manager: EntityManager, token: string, fingerprint: string) {
    const credential = await manager
      .getRepository(QrCredentialEntity)
      .findOne({ where: { tokenHash: hash(token) }, lock: { mode: 'pessimistic_write' } });
    if (!credential) invalid('Invalid QR credential');
    if (credential.consumedAt) {
      if (credential.requestHash === fingerprint && credential.result) return credential;
      conflict('QR has already been used. Request a new QR');
    }
    if (credential.expiresAt.getTime() <= Date.now()) conflict('QR has expired. Request a new QR');
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
      JSON.stringify([actor.id, siteId, gateId, value.requestId, value.direction, value.count]),
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
      if (visit.status !== 'APPROVED') conflict('Visit has not been approved');
      if (value.direction === 'IN') {
        if (visit.validFrom.getTime() > Date.now() || visit.validUntil.getTime() <= Date.now())
          conflict('Visit is outside its approved schedule');
        if (visit.enteredCount + value.count > visit.groupSize)
          conflict('Entry count exceeds the approved group size');
        visit.enteredCount += value.count;
      } else {
        // Permit departure after the scheduled end; never add attendance time automatically.
        if (visit.exitedCount + value.count > visit.enteredCount)
          conflict('Exit count exceeds the number inside the site');
        visit.exitedCount += value.count;
      }
      await manager.getRepository(VisitorVisitEntity).save(visit);
      const event = await manager.getRepository(VisitorGateEventEntity).save({
        id: randomUUID(),
        visitId: visit.id,
        operatorUserId: actor.id,
        gateId,
        direction: value.direction,
        count: value.count,
      });
      const result = {
        id: event.id,
        visitId: visit.id,
        gateId,
        direction: event.direction,
        count: event.count,
        createdAt: event.createdAt.toISOString(),
        visit: visitResponse(visit),
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
      const participation = contractor
        ? await manager
            .getRepository(ContractorSiteParticipationEntity)
            .findOneBy({ contractorId: contractor.id, siteId, isActive: true })
        : null;
      const profile = await manager
        .getRepository(FaceProfileEntity)
        .findOneBy({ workerId: worker.id, userId: account.id });
      const permissions = await manager
        .getRepository(WorkerGatePermissionEntity)
        .find({ where: { workerId: worker.id, siteId, gateId, revokedAt: IsNull() } });
      const now = new Date();
      const assignment = permissions.find(
        (p) => p.validFrom <= now && (!p.validUntil || p.validUntil > now),
      );
      const decision = authorizeGateEntry({
        authorizationDataAvailable: !!contractor && !!profile,
        workerActive: worker.isActive,
        contractorActive: contractor?.isActive ?? false,
        contractorParticipatesAtSite:
          !!participation &&
          participation.validFrom <= now &&
          (!participation.validUntil || participation.validUntil > now),
        faceProfileStatus: profile?.status ?? 'NEEDS_REENROLL',
        assignment: assignment ? { ...assignment, status: 'APPROVED' } : undefined,
        siteId,
        gateId,
        evaluatedAt: now,
      });
      const subject = {
        id: worker.id,
        userId: account.id,
        username: account.username,
        externalId: worker.externalId,
        displayName: worker.displayName,
        contractorName: contractor?.name ?? '',
        assignmentStatus: assignment ? 'APPROVED' : 'MISSING',
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
      credential.consumedAt = now;
      credential.requestHash = fingerprint;
      credential.result = result;
      session.consumedAt = now;
      await manager.getRepository(QrCredentialEntity).save(credential);
      await manager.getRepository(QrFallbackSessionEntity).save(session);
      return result;
    });
  }
}
