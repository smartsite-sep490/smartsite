import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { command, conflict, missing, page, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { AbsenceRequestEntity } from '../../database/entities/absence-request.entity.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { ContractorShiftAssignmentEntity } from '../../database/entities/contractor-shift-assignment.entity.js';
import { AbsenceRequestStatus, ShiftRequestStatus } from '../../database/entities/enums.js';
import { ShiftChangeRequestEntity } from '../../database/entities/shift-change-request.entity.js';
import { ShiftEntity } from '../../database/entities/shift.entity.js';
import { ShiftSwapRequestEntity } from '../../database/entities/shift-swap-request.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import { WorkerScheduleEntity } from '../../database/entities/worker-schedule.entity.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { hasActiveContractorParticipation } from './contractor-participation.js';
import {
  CreateAbsenceRequestDto,
  CreateShiftChangeRequestDto,
  CreateShiftSwapRequestDto,
  RejectSchedulingRequestDto,
} from './dto/scheduling-request.dto.js';

@Injectable()
export class SchedulingWorkflowService {
  constructor(private readonly dataSource: DataSource) {}

  private forbidden(): never {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }

  private assertPasswordChanged(actor: AuthenticatedUser): void {
    if (actor.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
  }

  private hasSiteRole(actor: AuthenticatedUser, role: UserRole, siteId: string): boolean {
    return actor.roleAssignments.some(
      (assignment) => assignment.role === role && assignment.siteId === siteId,
    );
  }

  private async lockedSchedule(manager: EntityManager, id: string): Promise<WorkerScheduleEntity | null> {
    return manager
      .getRepository(WorkerScheduleEntity)
      .createQueryBuilder('schedule')
      .setLock('pessimistic_write')
      .where('schedule.id = :id', { id })
      .getOne();
  }

  private async lockedSchedules(
    manager: EntityManager,
    ids: string[],
  ): Promise<Array<WorkerScheduleEntity | null>> {
    const lockedById = new Map<string, WorkerScheduleEntity>();
    for (const id of [...new Set(ids)].sort()) {
      const schedule = await this.lockedSchedule(manager, id);
      if (schedule) lockedById.set(schedule.id, schedule);
    }
    return ids.map((id) => lockedById.get(id) ?? null);
  }

  private async assertNoPendingRequests(
    manager: EntityManager,
    siteId: string,
    scheduleIds: string[],
  ): Promise<void> {
    const pendingStatuses = [
      ShiftRequestStatus.PENDING_COWORKER,
      ShiftRequestStatus.PENDING_MANAGER,
    ];
    const pendingChange = await manager
      .getRepository(ShiftChangeRequestEntity)
      .createQueryBuilder('request')
      .where('request.site_id = :siteId', { siteId })
      .andWhere('request.worker_schedule_id IN (:...scheduleIds)', { scheduleIds })
      .andWhere('request.status IN (:...pendingStatuses)', { pendingStatuses })
      .getOne();
    if (pendingChange) conflict('A request for this shift is already pending review');

    const pendingSwap = await manager
      .getRepository(ShiftSwapRequestEntity)
      .createQueryBuilder('request')
      .where('request.site_id = :siteId', { siteId })
      .andWhere(
        '(request.requester_worker_schedule_id IN (:...scheduleIds) OR request.coworker_worker_schedule_id IN (:...scheduleIds))',
        { scheduleIds },
      )
      .andWhere('request.status IN (:...pendingStatuses)', { pendingStatuses })
      .getOne();
    if (pendingSwap) conflict('A request for this shift is already pending review');
  }

  private async scheduleForSite(
    manager: EntityManager,
    siteId: string,
    scheduleId: string,
  ): Promise<WorkerScheduleEntity> {
    const schedule = await manager.getRepository(WorkerScheduleEntity).findOneBy({
      id: scheduleId,
      siteId,
      isActive: true,
    });
    return schedule ?? missing();
  }

  private async workerForSchedule(manager: EntityManager, schedule: WorkerScheduleEntity) {
    const worker = await manager.getRepository(WorkerEntity).findOneBy({
      id: schedule.workerId,
      siteId: schedule.siteId,
      isActive: true,
    });
    return worker ?? missing();
  }

  private async assertRequestAuthority(
    manager: EntityManager,
    actor: AuthenticatedUser,
    worker: WorkerEntity,
  ): Promise<'WORKER' | 'CONTRACTOR_REPRESENTATIVE'> {
    this.assertPasswordChanged(actor);
    if (
      this.hasSiteRole(actor, UserRole.WORKER, worker.siteId) &&
      worker.userId === actor.id
    )
      return 'WORKER';
    if (!this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, worker.siteId))
      this.forbidden();
    if (!worker.contractorId) this.forbidden();
    const representative = await manager
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .findOneBy({ siteId: worker.siteId, contractorId: worker.contractorId, userId: actor.id });
    if (!representative) this.forbidden();
    if (!(await hasActiveContractorParticipation(manager, worker.contractorId, worker.siteId)))
      this.forbidden();
    return 'CONTRACTOR_REPRESENTATIVE';
  }

  private assertManagerAuthority(actor: AuthenticatedUser, siteId: string): void {
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, UserRole.SITE_MANAGER, siteId)) this.forbidden();
  }

  private async assertContractorRepresentativeAuthority(
    manager: EntityManager,
    actor: AuthenticatedUser,
    siteId: string,
    contractorId: string | null,
  ): Promise<void> {
    this.assertPasswordChanged(actor);
    if (!contractorId || !this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, siteId))
      this.forbidden();
    const assignment = await manager
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .findOneBy({ siteId, contractorId, userId: actor.id });
    if (!assignment) this.forbidden();
    if (!(await hasActiveContractorParticipation(manager, contractorId, siteId))) this.forbidden();
  }

  private async assertTargetShift(manager: EntityManager, siteId: string, shiftId: string) {
    const shift = await manager.getRepository(ShiftEntity).findOneBy({ id: shiftId, siteId });
    return shift ?? missing();
  }

  private async assertContractorShiftAssignment(
    manager: EntityManager,
    siteId: string,
    shiftId: string,
    contractorId: string | null,
  ): Promise<void> {
    if (!contractorId) this.forbidden();
    const assignment = await manager.getRepository(ContractorShiftAssignmentEntity).findOneBy({
      siteId,
      shiftId,
      contractorId,
    });
    if (!assignment) conflict('Shift is not assigned to the worker contractor');
  }

  private async assertShiftAvailable(
    manager: EntityManager,
    schedule: WorkerScheduleEntity,
    targetShiftId: string,
  ): Promise<void> {
    const existing = await manager
      .getRepository(WorkerScheduleEntity)
      .createQueryBuilder('schedule')
      .where('schedule.site_id = :siteId', { siteId: schedule.siteId })
      .andWhere('schedule.worker_id = :workerId', { workerId: schedule.workerId })
      .andWhere('schedule.shift_id = :shiftId', { shiftId: targetShiftId })
      .andWhere('schedule.work_date = :workDate', { workDate: schedule.workDate })
      .andWhere('schedule.is_active = true')
      .andWhere('schedule.id <> :scheduleId', { scheduleId: schedule.id })
      .getOne();
    if (existing) conflict('Worker already has the target shift assigned on this date');
  }

  private scheduleStillMatches(
    schedule: WorkerScheduleEntity | null,
    request: Pick<ShiftChangeRequestEntity, 'siteId' | 'workerId' | 'workerScheduleId' | 'fromShiftId' | 'expectedScheduleVersionId'>,
  ): boolean {
    return !!schedule &&
      schedule.isActive &&
      schedule.id === request.workerScheduleId &&
      schedule.siteId === request.siteId &&
      schedule.workerId === request.workerId &&
      schedule.shiftId === request.fromShiftId &&
      schedule.scheduleVersionId === request.expectedScheduleVersionId;
  }

  async createShiftChange(
    actor: AuthenticatedUser,
    siteId: string,
    input: CreateShiftChangeRequestDto,
  ): Promise<ShiftChangeRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const value = command(CreateShiftChangeRequestDto, input);
    return this.dataSource.transaction(async (manager) => {
      const schedule = await this.lockedSchedule(manager, value.workerScheduleId);
      if (!schedule || schedule.siteId !== scopedSiteId || !schedule.isActive) missing();
      const worker = await this.workerForSchedule(manager, schedule);
      await this.assertRequestAuthority(manager, actor, worker);
      await this.assertNoPendingRequests(manager, scopedSiteId, [schedule.id]);
      await this.assertTargetShift(manager, scopedSiteId, value.toShiftId);
      await this.assertContractorShiftAssignment(
        manager,
        scopedSiteId,
        value.toShiftId,
        worker.contractorId,
      );
      if (schedule.shiftId === value.toShiftId) conflict('Shift change must select a different shift');
      await this.assertShiftAvailable(manager, schedule, value.toShiftId);
      return manager.getRepository(ShiftChangeRequestEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        workerId: worker.id,
        workerScheduleId: schedule.id,
        fromShiftId: schedule.shiftId,
        toShiftId: value.toShiftId,
        expectedScheduleVersionId: schedule.scheduleVersionId,
        status: ShiftRequestStatus.PENDING_MANAGER,
        requestedByUserId: actor.id,
        reason: value.reason,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReason: null,
        appliedAt: null,
      });
    });
  }

  async approveShiftChange(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
  ): Promise<ShiftChangeRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId))
      this.forbidden();
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftChangeRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
      })
        .getOne();
      if (!request) missing();
      const worker = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.workerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      await this.assertContractorRepresentativeAuthority(
        manager,
        actor,
        scopedSiteId,
        worker?.contractorId ?? null,
      );
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== ShiftRequestStatus.PENDING_MANAGER) conflict('Request is not pending contractor review');
      const schedule = await this.lockedSchedule(manager, request.workerScheduleId);
      if (!schedule || !this.scheduleStillMatches(schedule, request)) {
        request.status = ShiftRequestStatus.CONFLICTED;
        return manager.getRepository(ShiftChangeRequestEntity).save(request);
      }
      await this.assertTargetShift(manager, scopedSiteId, request.toShiftId);
      await this.assertContractorShiftAssignment(
        manager,
        scopedSiteId,
        request.toShiftId,
        worker?.contractorId ?? null,
      );
      await this.assertShiftAvailable(manager, schedule, request.toShiftId);
      schedule.shiftId = request.toShiftId;
      await manager.getRepository(WorkerScheduleEntity).save(schedule);
      const now = new Date();
      request.status = ShiftRequestStatus.APPLIED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = now;
      request.appliedAt = now;
      return manager.getRepository(ShiftChangeRequestEntity).save(request);
    });
  }

  async rejectShiftChange(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
    input: RejectSchedulingRequestDto,
  ): Promise<ShiftChangeRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    const value = command(RejectSchedulingRequestDto, input);
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId))
      this.forbidden();
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftChangeRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
      })
        .getOne();
      if (!request) missing();
      const worker = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.workerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      await this.assertContractorRepresentativeAuthority(
        manager,
        actor,
        scopedSiteId,
        worker?.contractorId ?? null,
      );
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== ShiftRequestStatus.PENDING_MANAGER) conflict('Request is not pending contractor review');
      request.status = ShiftRequestStatus.REJECTED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = new Date();
      request.reviewReason = value.reason;
      return manager.getRepository(ShiftChangeRequestEntity).save(request);
    });
  }

  async createShiftSwap(
    actor: AuthenticatedUser,
    siteId: string,
    input: CreateShiftSwapRequestDto,
  ): Promise<ShiftSwapRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const value = command(CreateShiftSwapRequestDto, input);
    if (value.requesterWorkerScheduleId === value.coworkerWorkerScheduleId)
      conflict('Shift swap requires two different worker schedules');
    return this.dataSource.transaction(async (manager) => {
      const [requesterSchedule, coworkerSchedule] = await this.lockedSchedules(manager, [
        value.requesterWorkerScheduleId,
        value.coworkerWorkerScheduleId,
      ]);
      if (
        !requesterSchedule ||
        !coworkerSchedule ||
        !requesterSchedule.isActive ||
        !coworkerSchedule.isActive ||
        requesterSchedule.siteId !== scopedSiteId ||
        coworkerSchedule.siteId !== scopedSiteId
      )
        missing();
      const [requester, coworker] = await Promise.all([
        this.workerForSchedule(manager, requesterSchedule),
        this.workerForSchedule(manager, coworkerSchedule),
      ]);
      await this.assertRequestAuthority(manager, actor, requester);
      if (
        requester.id === coworker.id ||
        requesterSchedule.workDate !== coworkerSchedule.workDate ||
        requesterSchedule.scheduleVersionId !== coworkerSchedule.scheduleVersionId ||
        requesterSchedule.shiftId === coworkerSchedule.shiftId
      )
        conflict('Worker schedules cannot be swapped');
      if (!requester.contractorId || requester.contractorId !== coworker.contractorId)
        conflict('Workers must belong to the same contractor to swap shifts');
      await Promise.all([
        this.assertContractorShiftAssignment(
          manager,
          scopedSiteId,
          requesterSchedule.shiftId,
          requester.contractorId,
        ),
        this.assertContractorShiftAssignment(
          manager,
          scopedSiteId,
          coworkerSchedule.shiftId,
          coworker.contractorId,
        ),
      ]);
      await this.assertNoPendingRequests(manager, scopedSiteId, [
        requesterSchedule.id,
        coworkerSchedule.id,
      ]);
      await this.assertShiftAvailable(manager, requesterSchedule, coworkerSchedule.shiftId);
      await this.assertShiftAvailable(manager, coworkerSchedule, requesterSchedule.shiftId);
      return manager.getRepository(ShiftSwapRequestEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        requesterWorkerId: requester.id,
        requesterWorkerScheduleId: requesterSchedule.id,
        coworkerWorkerId: coworker.id,
        coworkerWorkerScheduleId: coworkerSchedule.id,
        requesterShiftId: requesterSchedule.shiftId,
        coworkerShiftId: coworkerSchedule.shiftId,
        expectedScheduleVersionId: requesterSchedule.scheduleVersionId,
        status: ShiftRequestStatus.PENDING_COWORKER,
        requestedByUserId: actor.id,
        reason: value.reason,
        coworkerConfirmedAt: null,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReason: null,
        appliedAt: null,
      });
    });
  }

  async confirmShiftSwap(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
  ): Promise<ShiftSwapRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    this.assertPasswordChanged(actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftSwapRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
        })
        .getOne();
      if (!request) missing();
      if (request.status !== ShiftRequestStatus.PENDING_COWORKER)
        conflict('Request is not pending coworker confirmation');
      const coworker = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.coworkerWorkerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      if (
        !coworker ||
        coworker.userId !== actor.id ||
        !this.hasSiteRole(actor, UserRole.WORKER, scopedSiteId)
      )
        this.forbidden();
      request.status = ShiftRequestStatus.PENDING_MANAGER;
      request.coworkerConfirmedAt = new Date();
      return manager.getRepository(ShiftSwapRequestEntity).save(request);
    });
  }

  async declineShiftSwap(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
    input: RejectSchedulingRequestDto,
  ): Promise<ShiftSwapRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    const value = command(RejectSchedulingRequestDto, input);
    this.assertPasswordChanged(actor);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftSwapRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
        })
        .getOne();
      if (!request) missing();
      if (request.status !== ShiftRequestStatus.PENDING_COWORKER)
        conflict('Request is not pending coworker confirmation');
      const coworker = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.coworkerWorkerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      if (
        !coworker ||
        coworker.userId !== actor.id ||
        !this.hasSiteRole(actor, UserRole.WORKER, scopedSiteId)
      )
        this.forbidden();
      request.status = ShiftRequestStatus.REJECTED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = new Date();
      request.reviewReason = value.reason;
      return manager.getRepository(ShiftSwapRequestEntity).save(request);
    });
  }

  private async lockedSwapSchedules(
    manager: EntityManager,
    request: ShiftSwapRequestEntity,
  ): Promise<[WorkerScheduleEntity | null, WorkerScheduleEntity | null]> {
    const [requester = null, coworker = null] = await this.lockedSchedules(manager, [
      request.requesterWorkerScheduleId,
      request.coworkerWorkerScheduleId,
    ]);
    return [requester, coworker];
  }

  private swapSchedulesStillMatch(
    requester: WorkerScheduleEntity | null,
    coworker: WorkerScheduleEntity | null,
    request: ShiftSwapRequestEntity,
  ): requester is WorkerScheduleEntity {
    return !!requester &&
      !!coworker &&
      requester.isActive &&
      coworker.isActive &&
      requester.siteId === request.siteId &&
      coworker.siteId === request.siteId &&
      requester.workerId === request.requesterWorkerId &&
      coworker.workerId === request.coworkerWorkerId &&
      requester.shiftId === request.requesterShiftId &&
      coworker.shiftId === request.coworkerShiftId &&
      requester.workDate === coworker.workDate &&
      requester.scheduleVersionId === request.expectedScheduleVersionId &&
      coworker.scheduleVersionId === request.expectedScheduleVersionId;
  }

  async approveShiftSwap(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
  ): Promise<ShiftSwapRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId))
      this.forbidden();
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftSwapRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
      })
        .getOne();
      if (!request) missing();
      const requester = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.requesterWorkerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      await this.assertContractorRepresentativeAuthority(
        manager,
        actor,
        scopedSiteId,
        requester?.contractorId ?? null,
      );
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== ShiftRequestStatus.PENDING_MANAGER) conflict('Request is not pending contractor review');
      const [requesterSchedule, coworkerSchedule] = await this.lockedSwapSchedules(manager, request);
      if (
        !requesterSchedule ||
        !coworkerSchedule ||
        !this.swapSchedulesStillMatch(requesterSchedule, coworkerSchedule, request)
      ) {
        request.status = ShiftRequestStatus.CONFLICTED;
        return manager.getRepository(ShiftSwapRequestEntity).save(request);
      }
      const coworker = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.coworkerWorkerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      if (!requester || !coworker || requester.contractorId !== coworker.contractorId) {
        request.status = ShiftRequestStatus.CONFLICTED;
        return manager.getRepository(ShiftSwapRequestEntity).save(request);
      }
      await Promise.all([
        this.assertContractorShiftAssignment(
          manager,
          scopedSiteId,
          request.coworkerShiftId,
          requester.contractorId,
        ),
        this.assertContractorShiftAssignment(
          manager,
          scopedSiteId,
          request.requesterShiftId,
          coworker.contractorId,
        ),
      ]);
      await this.assertShiftAvailable(manager, requesterSchedule, request.coworkerShiftId);
      await this.assertShiftAvailable(manager, coworkerSchedule, request.requesterShiftId);
      requesterSchedule.shiftId = request.coworkerShiftId;
      coworkerSchedule.shiftId = request.requesterShiftId;
      await manager.getRepository(WorkerScheduleEntity).save([requesterSchedule, coworkerSchedule]);
      const now = new Date();
      request.status = ShiftRequestStatus.APPLIED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = now;
      request.appliedAt = now;
      return manager.getRepository(ShiftSwapRequestEntity).save(request);
    });
  }

  async rejectShiftSwap(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
    input: RejectSchedulingRequestDto,
  ): Promise<ShiftSwapRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    const value = command(RejectSchedulingRequestDto, input);
    this.assertPasswordChanged(actor);
    if (!this.hasSiteRole(actor, UserRole.CONTRACTOR_REPRESENTATIVE, scopedSiteId))
      this.forbidden();
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(ShiftSwapRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
      })
        .getOne();
      if (!request) missing();
      const requester = await manager.getRepository(WorkerEntity).findOneBy({
        id: request.requesterWorkerId,
        siteId: scopedSiteId,
        isActive: true,
      });
      await this.assertContractorRepresentativeAuthority(
        manager,
        actor,
        scopedSiteId,
        requester?.contractorId ?? null,
      );
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== ShiftRequestStatus.PENDING_MANAGER) conflict('Request is not pending contractor review');
      request.status = ShiftRequestStatus.REJECTED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = new Date();
      request.reviewReason = value.reason;
      return manager.getRepository(ShiftSwapRequestEntity).save(request);
    });
  }

  async createAbsence(
    actor: AuthenticatedUser,
    siteId: string,
    input: CreateAbsenceRequestDto,
  ): Promise<AbsenceRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const value = command(CreateAbsenceRequestDto, input);
    return this.dataSource.transaction(async (manager) => {
      const schedule = await this.scheduleForSite(manager, scopedSiteId, value.workerScheduleId);
      const worker = await this.workerForSchedule(manager, schedule);
      const authority = await this.assertRequestAuthority(manager, actor, worker);
      let replacementWorkerId: string | null = null;
      if (value.replacementWorkerId) {
        if (authority !== 'CONTRACTOR_REPRESENTATIVE') this.forbidden();
        if (!worker.contractorId) this.forbidden();
        const replacement = await manager.getRepository(WorkerEntity).findOneBy({
          id: value.replacementWorkerId,
          siteId: scopedSiteId,
          contractorId: worker.contractorId,
          isActive: true,
        });
        if (!replacement) missing();
        if (replacement.id === worker.id) conflict('Replacement worker must be different');
        const existing = await manager.getRepository(WorkerScheduleEntity).findOneBy({
          siteId: scopedSiteId,
          scheduleVersionId: schedule.scheduleVersionId,
          workerId: replacement.id,
          workDate: schedule.workDate,
          isActive: true,
        });
        if (existing) conflict('Replacement worker already has an active shift');
        replacementWorkerId = replacement.id;
      }
      return manager.getRepository(AbsenceRequestEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        workerId: worker.id,
        workerScheduleId: schedule.id,
        shiftId: schedule.shiftId,
        expectedScheduleVersionId: schedule.scheduleVersionId,
        replacementWorkerId,
        requestedByUserId: actor.id,
        reason: value.reason,
        status: AbsenceRequestStatus.PENDING_MANAGER,
        isUnderstaffed: false,
        reviewedByUserId: null,
        reviewedAt: null,
      });
    });
  }

  private absenceScheduleStillMatches(
    schedule: WorkerScheduleEntity | null,
    request: AbsenceRequestEntity,
  ): schedule is WorkerScheduleEntity {
    return !!schedule &&
      schedule.isActive &&
      schedule.id === request.workerScheduleId &&
      schedule.siteId === request.siteId &&
      schedule.workerId === request.workerId &&
      schedule.shiftId === request.shiftId &&
      schedule.scheduleVersionId === request.expectedScheduleVersionId;
  }

  async approveAbsence(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
  ): Promise<AbsenceRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    this.assertManagerAuthority(actor, scopedSiteId);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(AbsenceRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
        })
        .getOne();
      if (!request) missing();
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== AbsenceRequestStatus.PENDING_MANAGER)
        conflict('Request is not pending manager review');
      const schedule = await this.lockedSchedule(manager, request.workerScheduleId);
      if (!this.absenceScheduleStillMatches(schedule, request)) {
        request.status = AbsenceRequestStatus.CONFLICTED;
        request.isUnderstaffed = false;
        request.reviewedByUserId = actor.id;
        request.reviewedAt = new Date();
        return manager.getRepository(AbsenceRequestEntity).save(request);
      }
      schedule.isActive = false;
      await manager.getRepository(WorkerScheduleEntity).save(schedule);
      if (request.replacementWorkerId) {
        const replacement = await manager.getRepository(WorkerEntity).findOneBy({
          id: request.replacementWorkerId,
          siteId: scopedSiteId,
          isActive: true,
        });
        const absentWorker = await this.workerForSchedule(manager, schedule);
        if (!replacement || replacement.contractorId !== absentWorker.contractorId)
          conflict('Replacement worker is no longer eligible');
        const existing = await manager.getRepository(WorkerScheduleEntity).findOneBy({
          siteId: scopedSiteId,
          scheduleVersionId: schedule.scheduleVersionId,
          workerId: replacement.id,
          workDate: schedule.workDate,
          isActive: true,
        });
        if (existing) conflict('Replacement worker already has an active shift');
        await manager.getRepository(WorkerScheduleEntity).insert({
          id: randomUUID(),
          siteId: scopedSiteId,
          scheduleVersionId: schedule.scheduleVersionId,
          workerId: replacement.id,
          shiftId: schedule.shiftId,
          workDate: schedule.workDate,
          isActive: true,
        });
      }
      request.status = AbsenceRequestStatus.APPROVED;
      request.isUnderstaffed = request.replacementWorkerId === null;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = new Date();
      return manager.getRepository(AbsenceRequestEntity).save(request);
    });
  }

  async rejectAbsence(
    actor: AuthenticatedUser,
    siteId: string,
    requestId: string,
  ): Promise<AbsenceRequestEntity> {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedRequestId = uuid(requestId);
    this.assertManagerAuthority(actor, scopedSiteId);
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .getRepository(AbsenceRequestEntity)
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :id AND request.site_id = :siteId', {
          id: scopedRequestId,
          siteId: scopedSiteId,
        })
        .getOne();
      if (!request) missing();
      if (request.requestedByUserId === actor.id) this.forbidden();
      if (request.status !== AbsenceRequestStatus.PENDING_MANAGER)
        conflict('Request is not pending manager review');
      request.status = AbsenceRequestStatus.REJECTED;
      request.reviewedByUserId = actor.id;
      request.reviewedAt = new Date();
      return manager.getRepository(AbsenceRequestEntity).save(request);
    });
  }

  private async getRequestScope(actor: AuthenticatedUser, siteId: string) {
    if (actor.roleAssignments.some(a => a.role === UserRole.ADMIN || (a.role === UserRole.SITE_MANAGER && a.siteId === siteId))) {
      return { type: 'ALL' };
    }
    const rep = actor.roleAssignments.some(a =>
      a.role === UserRole.CONTRACTOR_REPRESENTATIVE && a.siteId === siteId)
      ? await this.dataSource.getRepository(ContractorRepresentativeAssignmentEntity).findOneBy({ siteId, userId: actor.id })
      : null;
    if (rep && await hasActiveContractorParticipation(this.dataSource.manager, rep.contractorId, siteId)) {
      return { type: 'CONTRACTOR', contractorId: rep.contractorId };
    }
    const worker = this.hasSiteRole(actor, UserRole.WORKER, siteId)
      ? await this.dataSource.getRepository(WorkerEntity).findOneBy({ siteId, userId: actor.id, isActive: true })
      : null;
    if (worker) {
      return { type: 'WORKER', workerId: worker.id };
    }
    this.forbidden();
  }

  async listShiftChangeRequests(actor: AuthenticatedUser, siteId: string, offset = '0', limit = '50') {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const pagination = page(Number(offset), Number(limit));
    const scope = await this.getRequestScope(actor, scopedSiteId);

    const query = this.dataSource.getRepository(ShiftChangeRequestEntity).createQueryBuilder('req')
      .where('req.site_id = :siteId', { siteId: scopedSiteId });

    if (scope.type === 'CONTRACTOR') {
      query.innerJoin('worker', 'w', 'req.worker_id = w.id')
           .andWhere('w.contractor_id = :contractorId', { contractorId: scope.contractorId });
    } else if (scope.type === 'WORKER') {
      query.andWhere('req.worker_id = :workerId', { workerId: scope.workerId });
    }

    const [items, total] = await query
      .orderBy('req.createdAt', 'DESC')
      .addOrderBy('req.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listShiftSwapRequests(actor: AuthenticatedUser, siteId: string, offset = '0', limit = '50') {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const pagination = page(Number(offset), Number(limit));
    const scope = await this.getRequestScope(actor, scopedSiteId);

    const query = this.dataSource.getRepository(ShiftSwapRequestEntity).createQueryBuilder('req')
      .where('req.site_id = :siteId', { siteId: scopedSiteId });

    if (scope.type === 'CONTRACTOR') {
      query.innerJoin('worker', 'wReq', 'req.requester_worker_id = wReq.id')
           .innerJoin('worker', 'wCow', 'req.coworker_worker_id = wCow.id')
           .andWhere('(wReq.contractor_id = :contractorId OR wCow.contractor_id = :contractorId)', { contractorId: scope.contractorId });
    } else if (scope.type === 'WORKER') {
      query.andWhere('(req.requester_worker_id = :workerId OR req.coworker_worker_id = :workerId)', { workerId: scope.workerId });
    }

    const [items, total] = await query
      .orderBy('req.createdAt', 'DESC')
      .addOrderBy('req.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();
    return { items, total };
  }

  async listAbsenceRequests(actor: AuthenticatedUser, siteId: string, offset = '0', limit = '50') {
    const scopedSiteId = uuid(siteId).toLowerCase();
    const pagination = page(Number(offset), Number(limit));
    const scope = await this.getRequestScope(actor, scopedSiteId);

    const query = this.dataSource.getRepository(AbsenceRequestEntity).createQueryBuilder('req')
      .where('req.site_id = :siteId', { siteId: scopedSiteId });

    if (scope.type === 'CONTRACTOR') {
      query.innerJoin('worker', 'w', 'req.worker_id = w.id')
           .andWhere('w.contractor_id = :contractorId', { contractorId: scope.contractorId });
    } else if (scope.type === 'WORKER') {
      query.andWhere('req.worker_id = :workerId', { workerId: scope.workerId });
    }

    const [items, total] = await query
      .orderBy('req.createdAt', 'DESC')
      .addOrderBy('req.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit)
      .getManyAndCount();
    return { items, total };
  }
}
