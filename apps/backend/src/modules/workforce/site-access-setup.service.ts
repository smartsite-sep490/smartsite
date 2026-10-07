import { Injectable } from '@nestjs/common';
import { IsISO8601, IsUUID, Matches } from 'class-validator';
import { DataSource, In, type EntityManager } from 'typeorm';
import type { AccessSetupResponse } from '@smartsite/contracts';
import { command, conflict, missing, uuid } from '../../common/configuration/commands.js';
import {
  ContractorZonePermissionEntity,
  WorkerZonePermissionEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeGrantEntity,
  ContractorEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  ZoneEntity,
  UserRole,
} from '../../database/entities/index.js';
import type { WorkforceActor } from './contractor-operations.service.js';
import { requireSiteRole } from './qr-access.service.js';
import { auditAccess } from './access-audit.js';

class PermissionIntervalCommand {
  @IsUUID() requestId!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validFrom!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  validUntil!: string;
}
export class GrantContractorZoneCommand extends PermissionIntervalCommand {
  @IsUUID() siteContractorId!: string;
  @IsUUID() zoneId!: string;
}
export class GrantWorkerZoneCommand extends PermissionIntervalCommand {
  @IsUUID() workerAssignmentId!: string;
  @IsUUID() contractorZonePermissionId!: string;
}
export function containedInterval(
  from: Date,
  until: Date,
  parentFrom: Date,
  parentUntil: Date | null,
) {
  return (
    [from, until, parentFrom, ...(parentUntil ? [parentUntil] : [])].every((d) =>
      Number.isFinite(d.getTime()),
    ) &&
    until > from &&
    from >= parentFrom &&
    (!parentUntil || until <= parentUntil)
  );
}
@Injectable()
export class SiteAccessSetupService {
  constructor(private readonly source: DataSource) {}
  private isAdmin(actor: WorkforceActor) {
    return actor.roleAssignments.some((r) => r.role === UserRole.ADMIN && r.siteId === null);
  }
  private async requireRepresentative(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    contractorId: string,
  ) {
    requireSiteRole(actor, siteId, [UserRole.CONTRACTOR_REPRESENTATIVE]);
    if (
      !this.isAdmin(actor) &&
      !(await manager
        .getRepository(ContractorRepresentativeGrantEntity)
        .existsBy({ userId: actor.id, contractorId }))
    )
      conflict('Representative does not manage this contractor');
  }
  async options(actor: WorkforceActor, siteId: string): Promise<AccessSetupResponse> {
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER, UserRole.CONTRACTOR_REPRESENTATIVE]);
    const siteManager =
      this.isAdmin(actor) ||
      actor.roleAssignments.some((r) => r.siteId === siteId && r.role === UserRole.SITE_MANAGER);
    let participations = await this.source
      .getRepository(ContractorSiteParticipationEntity)
      .findBy({ siteId, isActive: true });
    if (!siteManager) {
      const grants = await this.source
        .getRepository(ContractorRepresentativeGrantEntity)
        .findBy({ userId: actor.id });
      participations = participations.filter((p) =>
        grants.some((g) => g.contractorId === p.contractorId),
      );
    }
    const contractors = await this.source.getRepository(ContractorEntity).find();
    const workers = await this.source.getRepository(WorkerEntity).findBy({ siteId });
    const scopedWorkers = siteManager
      ? workers
      : workers.filter((w) => participations.some((p) => p.contractorId === w.contractorId));
    const assignments = (
      await this.source.getRepository(WorkerSiteZoneAssignmentEntity).findBy({ siteId })
    ).filter((a) => scopedWorkers.some((w) => w.id === a.workerId));
    const contractorPermissions = participations.length
      ? await this.source
          .getRepository(ContractorZonePermissionEntity)
          .findBy({ siteContractorId: In(participations.map((p) => p.id)) })
      : [];
    const workerPermissions = assignments.length
      ? await this.source
          .getRepository(WorkerZonePermissionEntity)
          .findBy({ workerAssignmentId: In(assignments.map((a) => a.id)) })
      : [];
    return {
      canReviewAssignments: siteManager,
      canGrantContractorZones: siteManager,
      canGrantWorkerZones:
        this.isAdmin(actor) ||
        actor.roleAssignments.some(
          (r) => r.siteId === siteId && r.role === UserRole.CONTRACTOR_REPRESENTATIVE,
        ),
      participations: participations.map((p) => ({
        id: p.id,
        contractorId: p.contractorId,
        name: contractors.find((c) => c.id === p.contractorId)?.name ?? p.contractorId,
        validFrom: p.validFrom.toISOString(),
        validUntil: p.validUntil?.toISOString() ?? null,
      })),
      workers: scopedWorkers.map((w) => ({
        id: w.id,
        name: w.displayName,
        contractorId: w.contractorId,
      })),
      zones: (await this.source.getRepository(ZoneEntity).findBy({ siteId })).map((z) => ({
        id: z.id,
        name: z.name,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        workerId: a.workerId,
        workerName: workers.find((w) => w.id === a.workerId)?.displayName ?? a.workerId,
        siteContractorId: a.siteContractorId,
        status: a.status,
        validFrom: a.validFrom.toISOString(),
        validUntil: a.validUntil?.toISOString() ?? null,
        version: a.version,
        reviewNote: a.reviewNote,
      })),
      contractorPermissions: contractorPermissions.map((p) => ({
        id: p.id,
        siteContractorId: p.siteContractorId,
        zoneId: p.zoneId,
        validFrom: p.validFrom.toISOString(),
        validUntil: p.validUntil.toISOString(),
        revokedAt: p.revokedAt?.toISOString() ?? null,
      })),
      workerPermissions: workerPermissions.map((p) => ({
        id: p.id,
        workerAssignmentId: p.workerAssignmentId,
        contractorZonePermissionId: p.contractorZonePermissionId,
        validFrom: p.validFrom.toISOString(),
        validUntil: p.validUntil.toISOString(),
        revokedAt: p.revokedAt?.toISOString() ?? null,
      })),
    };
  }
  async grantContractor(actor: WorkforceActor, siteId: string, input: GrantContractorZoneCommand) {
    requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER]);
    const value = command(GrantContractorZoneCommand, input);
    return this.source.transaction(async (manager) => {
      const participation = await manager.getRepository(ContractorSiteParticipationEntity).findOne({
        where: { id: value.siteContractorId, siteId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      const zone = await manager.getRepository(ZoneEntity).findOneBy({ id: value.zoneId, siteId });
      if (!participation || !zone) missing();
      const from = new Date(value.validFrom),
        until = new Date(value.validUntil);
      if (!containedInterval(from, until, participation.validFrom, participation.validUntil))
        conflict('Zone permission must fit the contractor participation interval');
      const existing = await manager
        .getRepository(ContractorZonePermissionEntity)
        .findOneBy({ id: value.requestId });
      if (existing) {
        if (
          existing.siteContractorId !== participation.id ||
          existing.zoneId !== zone.id ||
          +existing.validFrom !== +from ||
          +existing.validUntil !== +until ||
          existing.grantedBy !== actor.id
        )
          conflict('Request was used for another permission');
        return existing;
      }
      const permission = await manager.getRepository(ContractorZonePermissionEntity).save({
        id: value.requestId,
        siteContractorId: participation.id,
        zoneId: zone.id,
        validFrom: from,
        validUntil: until,
        grantedBy: actor.id,
        revokedAt: null,
      });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'CONTRACTOR_ZONE_GRANTED',
        'contractor_zone_permission',
        permission.id,
        null,
        {
          siteContractorId: participation.id,
          zoneId: zone.id,
          validFrom: from.toISOString(),
          validUntil: until.toISOString(),
        },
      );
      return permission;
    });
  }
  async grantWorker(actor: WorkforceActor, siteId: string, input: GrantWorkerZoneCommand) {
    requireSiteRole(actor, siteId, [UserRole.CONTRACTOR_REPRESENTATIVE]);
    const value = command(GrantWorkerZoneCommand, input);
    return this.source.transaction(async (manager) => {
      const assignment = await manager.getRepository(WorkerSiteZoneAssignmentEntity).findOne({
        where: { id: value.workerAssignmentId, siteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !assignment?.siteContractorId ||
        assignment.status !== 'APPROVED' ||
        !assignment.validUntil
      )
        conflict('An approved worker assignment with an expiry is required');
      const permission = await manager.getRepository(ContractorZonePermissionEntity).findOne({
        where: {
          id: value.contractorZonePermissionId,
          siteContractorId: assignment.siteContractorId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const participation = await manager
        .getRepository(ContractorSiteParticipationEntity)
        .findOneBy({ id: assignment.siteContractorId, siteId, isActive: true });
      const worker = await manager
        .getRepository(WorkerEntity)
        .findOneBy({ id: assignment.workerId, isActive: true });
      if (
        !permission ||
        permission.revokedAt ||
        !participation ||
        !worker ||
        participation.contractorId !== worker.contractorId
      )
        conflict('Worker and contractor zone scopes do not match');
      await this.requireRepresentative(manager, actor, siteId, participation.contractorId);
      const from = new Date(value.validFrom),
        until = new Date(value.validUntil);
      if (
        !containedInterval(from, until, assignment.validFrom, assignment.validUntil) ||
        !containedInterval(from, until, permission.validFrom, permission.validUntil) ||
        !containedInterval(from, until, participation.validFrom, participation.validUntil)
      )
        conflict('Worker zone permission must fit both assignment and contractor permission');
      const existing = await manager
        .getRepository(WorkerZonePermissionEntity)
        .findOneBy({ id: value.requestId });
      if (existing) {
        if (
          existing.workerAssignmentId !== assignment.id ||
          existing.contractorZonePermissionId !== permission.id ||
          +existing.validFrom !== +from ||
          +existing.validUntil !== +until ||
          existing.grantedBy !== actor.id
        )
          conflict('Request was used for another permission');
        return existing;
      }
      const result = await manager.getRepository(WorkerZonePermissionEntity).save({
        id: value.requestId,
        workerAssignmentId: assignment.id,
        contractorZonePermissionId: permission.id,
        validFrom: from,
        validUntil: until,
        grantedBy: actor.id,
        revokedAt: null,
      });
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'WORKER_ZONE_GRANTED',
        'worker_zone_permission',
        result.id,
        null,
        {
          workerAssignmentId: assignment.id,
          contractorZonePermissionId: permission.id,
          validFrom: from.toISOString(),
          validUntil: until.toISOString(),
        },
      );
      return result;
    });
  }
  async revoke(
    actor: WorkforceActor,
    siteId: string,
    permissionId: string,
    kind: 'contractor' | 'worker',
  ) {
    requireSiteRole(
      actor,
      siteId,
      kind === 'contractor' ? [UserRole.SITE_MANAGER] : [UserRole.CONTRACTOR_REPRESENTATIVE],
    );
    uuid(permissionId);
    return this.source.transaction(async (manager) => {
      if (kind === 'contractor') {
        requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER]);
        const permission = await manager
          .getRepository(ContractorZonePermissionEntity)
          .findOne({ where: { id: permissionId }, lock: { mode: 'pessimistic_write' } });
        if (
          !permission ||
          !(await manager
            .getRepository(ContractorSiteParticipationEntity)
            .existsBy({ id: permission.siteContractorId, siteId }))
        )
          missing();
        if (permission.revokedAt) return { id: permissionId };
        if (!permission.revokedAt) {
          permission.revokedAt = new Date();
          await manager.getRepository(ContractorZonePermissionEntity).save(permission);
        }
      } else {
        const permission = await manager
          .getRepository(WorkerZonePermissionEntity)
          .findOne({ where: { id: permissionId }, lock: { mode: 'pessimistic_write' } });
        if (!permission) missing();
        const assignment = await manager
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .findOneBy({ id: permission.workerAssignmentId, siteId });
        const participation = assignment?.siteContractorId
          ? await manager
              .getRepository(ContractorSiteParticipationEntity)
              .findOneBy({ id: assignment.siteContractorId, siteId })
          : null;
        if (!participation) missing();
        await this.requireRepresentative(manager, actor, siteId, participation.contractorId);
        if (permission.revokedAt) return { id: permissionId };
        if (!permission.revokedAt) {
          permission.revokedAt = new Date();
          await manager.getRepository(WorkerZonePermissionEntity).save(permission);
        }
      }
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'ZONE_PERMISSION_REVOKED',
        `${kind}_zone_permission`,
        permissionId,
        null,
        {},
      );
      return { id: permissionId };
    });
  }
}
