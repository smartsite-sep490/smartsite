import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { command, knownUnique, missing, page, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ContractorRepresentativeAssignmentEntity } from '../../database/entities/contractor-representative-assignment.entity.js';
import { ContractorEntity } from '../../database/entities/contractor.entity.js';
import { SiteEntity } from '../../database/entities/site.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { WorkerEntity } from '../../database/entities/worker.entity.js';
import {
  AssignContractorRepresentativeDto,
  CreateContractorDto,
  CreateWorkerDto,
} from './dto/workforce.dto.js';

@Injectable()
export class WorkforceConfigurationService {
  constructor(private readonly dataSource: DataSource) {}

  private async assertWorkerAssignment(siteId: string, contractorId: string, userId: string) {
    const [contractor, user, assignment] = await Promise.all([
      this.dataSource
        .getRepository(ContractorEntity)
        .findOneBy({ id: contractorId, siteId, isActive: true }),
      this.dataSource.getRepository(UserEntity).findOneBy({ id: userId, isActive: true }),
      this.dataSource
        .getRepository(UserRoleAssignmentEntity)
        .findOneBy({ userId, role: UserRole.WORKER, siteId }),
    ]);
    if (!contractor || !user || !assignment) missing();
  }

  async create(siteId: string, input: CreateWorkerDto): Promise<WorkerEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateWorkerDto, input);
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
    if (!site) missing();
    if (!!value.contractorId !== !!value.userId)
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Worker contractor and user assignments must be set together',
      });
    if (value.contractorId && value.userId)
      await this.assertWorkerAssignment(scopedSiteId, value.contractorId, value.userId);
    try {
      return await this.dataSource.getRepository(WorkerEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        contractorId: value.contractorId ?? null,
        userId: value.userId ?? null,
        externalId: value.externalId,
        displayName: value.displayName,
        isActive: true,
      });
    } catch (error) {
      knownUnique(error, ['uq_worker_site_external_id', 'uq_worker_site_user']);
    }
  }

  async createContractor(siteId: string, input: CreateContractorDto): Promise<ContractorEntity> {
    const scopedSiteId = uuid(siteId);
    const value = command(CreateContractorDto, input);
    const site = await this.dataSource.getRepository(SiteEntity).findOneBy({ id: scopedSiteId });
    if (!site) missing();
    try {
      return await this.dataSource.getRepository(ContractorEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        code: value.code,
        name: value.name,
        isActive: true,
      });
    } catch (error) {
      knownUnique(error, ['uq_contractor_site_code']);
    }
  }

  async assignRepresentative(
    siteId: string,
    contractorId: string,
    input: AssignContractorRepresentativeDto,
  ): Promise<ContractorRepresentativeAssignmentEntity> {
    const scopedSiteId = uuid(siteId);
    const scopedContractorId = uuid(contractorId);
    const value = command(AssignContractorRepresentativeDto, input);
    const [contractor, user, assignment] = await Promise.all([
      this.dataSource
        .getRepository(ContractorEntity)
        .findOneBy({ id: scopedContractorId, siteId: scopedSiteId, isActive: true }),
      this.dataSource.getRepository(UserEntity).findOneBy({ id: value.userId, isActive: true }),
      this.dataSource.getRepository(UserRoleAssignmentEntity).findOneBy({
        userId: value.userId,
        role: UserRole.CONTRACTOR_REPRESENTATIVE,
        siteId: scopedSiteId,
      }),
    ]);
    if (!contractor || !user || !assignment) missing();
    try {
      return await this.dataSource.getRepository(ContractorRepresentativeAssignmentEntity).save({
        id: randomUUID(),
        siteId: scopedSiteId,
        contractorId: scopedContractorId,
        userId: value.userId,
      });
    } catch (error) {
      knownUnique(error, ['uq_contractor_representative_assignment']);
    }
  }

  async list(
    siteId: string,
    offset = 0,
    limit = 20,
  ): Promise<{ items: WorkerEntity[]; total: number }> {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(WorkerEntity).findAndCount({
      where: { siteId: uuid(siteId) },
      order: { externalId: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }
}
