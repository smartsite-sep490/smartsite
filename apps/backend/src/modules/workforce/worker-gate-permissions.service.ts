import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { SITE_GATES, type WorkerGatePermissionsResponse } from '@smartsite/contracts';
import { command, conflict, missing, uuid } from '../../common/configuration/commands.js';
import {
  WorkerEntity,
  WorkerGatePermissionEntity,
  UserRole,
  WorkerSiteZoneAssignmentEntity,
  ContractorSiteParticipationEntity,
} from '../../database/entities/index.js';
import { requireSiteRole } from './qr-access.service.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { auditAccess } from './access-audit.js';

export class SetGatePermissionsCommand {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(SITE_GATES.length)
  @IsIn(SITE_GATES.map((gate) => gate.id), { each: true })
  gateIds!: string[];
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  expectedPermissionIds!: string[];
}

@Injectable()
export class WorkerGatePermissionsService {
  constructor(private readonly dataSource: DataSource) {}
  private async requireWorker(
    manager: EntityManager,
    siteId: string,
    workerId: string,
    lock = false,
  ) {
    const query = manager
      .getRepository(WorkerEntity)
      .createQueryBuilder('worker')
      .where('worker.id = :workerId AND worker.site_id = :siteId', { workerId, siteId });
    if (lock) query.setLock('pessimistic_write');
    const worker = await query.getOne();
    if (!worker) missing();
    return worker;
  }
  private async snapshot(
    manager: EntityManager,
    siteId: string,
    workerId: string,
  ): Promise<WorkerGatePermissionsResponse> {
    const items = await manager.getRepository(WorkerGatePermissionEntity).find({
      where: { workerId, siteId, revokedAt: IsNull() },
      order: { gateId: 'ASC', id: 'ASC' },
    });
    return {
      workerId,
      items: items.map((item) => ({
        id: item.id,
        gateId: item.gateId,
        validFrom: item.validFrom.toISOString(),
        validUntil: item.validUntil?.toISOString() ?? null,
      })),
    };
  }
  async list(actor: WorkforceActor, siteIdValue: string, workerIdValue: string) {
    requireSiteRole(actor, siteIdValue, [UserRole.SITE_MANAGER]);
    const siteId = uuid(siteIdValue),
      workerId = uuid(workerIdValue);
    return this.dataSource.transaction(async (manager) => {
      await this.requireWorker(manager, siteId, workerId);
      return this.snapshot(manager, siteId, workerId);
    });
  }
  async set(
    actor: WorkforceActor,
    siteIdValue: string,
    workerIdValue: string,
    input: SetGatePermissionsCommand,
  ) {
    requireSiteRole(actor, siteIdValue, [UserRole.SITE_MANAGER]);
    const siteId = uuid(siteIdValue),
      workerId = uuid(workerIdValue);
    const value = command(SetGatePermissionsCommand, input);
    return this.dataSource.transaction(async (manager) => {
      const worker = await this.requireWorker(manager, siteId, workerId, true);
      const current = await this.snapshot(manager, siteId, workerId);
      if (
        current.items
          .map((item) => item.id)
          .sort()
          .join(',') !== [...value.expectedPermissionIds].sort().join(',')
      )
        conflict('Gate permissions changed. Reload before saving.');
      const now = new Date();
      const assignments = await manager
        .getRepository(WorkerSiteZoneAssignmentEntity)
        .find({ where: { workerId, siteId }, order: { validFrom: 'DESC', id: 'ASC' } });
      const assignment = assignments.find(
        (a) => a.status === 'APPROVED' && a.siteContractorId && a.validUntil && a.validUntil > now,
      );
      if (value.gateIds.length && (!worker.isActive || !assignment))
        conflict('An approved worker assignment with an expiry is required');
      if (value.gateIds.length && assignment) {
        const participation = await manager
          .getRepository(ContractorSiteParticipationEntity)
          .findOneBy({ id: assignment.siteContractorId!, siteId, isActive: true });
        if (
          !participation ||
          participation.contractorId !== worker.contractorId ||
          participation.validFrom > assignment.validFrom ||
          (participation.validUntil && participation.validUntil < assignment.validUntil!)
        )
          conflict('Assignment exceeds active contractor participation');
      }
      await manager
        .getRepository(WorkerGatePermissionEntity)
        .update(
          { workerId, siteId, revokedAt: IsNull() },
          { revokedAt: now, revokedByUserId: actor.id },
        );
      for (const gateId of value.gateIds)
        await manager.getRepository(WorkerGatePermissionEntity).save({
          id: randomUUID(),
          workerId,
          siteId,
          gateId,
          validFrom: assignment!.validFrom > now ? assignment!.validFrom : now,
          validUntil: assignment!.validUntil,
          workerAssignmentId: assignment!.id,
          createdByUserId: actor.id,
          revokedAt: null,
          revokedByUserId: null,
        });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'GATE_PERMISSIONS_CHANGED',
        'worker',
        worker.id,
        null,
        { gateIds: value.gateIds, assignmentId: assignment?.id ?? null },
      );
      return this.snapshot(manager, siteId, workerId);
    });
  }
}
