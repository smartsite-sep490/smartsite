import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsUUID } from 'class-validator';
import { DataSource, IsNull, type EntityManager } from 'typeorm';
import { SITE_GATES, type WorkerGatePermissionsResponse } from '@smartsite/contracts';
import { command, conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  WorkerEntity,
  WorkerGatePermissionEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../../database/entities/index.js';
import type { WorkforceActor } from './contractor-operations.service.js';

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
  private requireAdmin(actor: WorkforceActor) {
    if (
      actor.mustChangePassword ||
      !actor.roleAssignments.some((role) => role.role === UserRole.ADMIN && role.siteId === null)
    )
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Admin access is required',
      });
  }
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
    this.requireAdmin(actor);
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
    this.requireAdmin(actor);
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
      if (value.gateIds.length > 0) {
        const account = worker.userId
          ? await manager.getRepository(UserEntity).findOneBy({ id: worker.userId, isActive: true })
          : null;
        const role = account
          ? await manager.getRepository(UserRoleAssignmentEntity).findOneBy([
              { userId: account.id, siteId },
              { userId: account.id, siteId: IsNull(), role: UserRole.ADMIN },
            ])
          : null;
        if (!worker.isActive || !account || !role)
          conflict('An active worker linked to an active site account is required');
      }
      const now = new Date();
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
          validFrom: now,
          validUntil: null,
          createdByUserId: actor.id,
          revokedAt: null,
          revokedByUserId: null,
        });
      return this.snapshot(manager, siteId, workerId);
    });
  }
}
