import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsISO8601, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiBearerAuth, ApiTags, OmitType } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import {
  command,
  conflict,
  missing,
  knownUnique,
  uuid,
} from '../../common/configuration/commands.js';
import { RenameSiteProfileDto } from '../workforce/directory/dto/workforce.dto.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { pagination } from '../../common/http/pagination.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { SiteManagerGuard } from '../auth/site-manager.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { WorkforceConfigurationService } from '../workforce/directory/workforce-configuration.service.js';
import { CreateUserDto, UsersService } from './users.service.js';
import { Injectable } from '@nestjs/common';

export class CreateSiteRepresentativeDto extends OmitType(CreateUserDto, [
  'roleAssignments',
] as const) {}

export class CreateContractorRepresentativeDto extends CreateSiteRepresentativeDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  contractorName!: string;
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  validFrom!: string;
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  validUntil!: string | null;
}

@Injectable()
export class SiteRepresentativesService {
  constructor(
    private readonly source: DataSource,
    private readonly users: UsersService,
    private readonly workforce: WorkforceConfigurationService,
  ) {}

  async createWithContractor(siteId: string, input: CreateContractorRepresentativeDto) {
    const value = command(CreateContractorRepresentativeDto, input);
    const account = command(CreateUserDto, {
      username: value.username,
      displayName: value.displayName,
      temporaryPassword: value.temporaryPassword,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: uuid(siteId) }],
    });
    const hash = await hashPassword(value.temporaryPassword);
    try {
      return await this.source.transaction(async (manager) => {
        const contractor = await this.workforce.createContractorWithParticipation(
          manager,
          siteId,
          value.contractorName,
          new Date(value.validFrom),
          value.validUntil === null ? null : new Date(value.validUntil),
        );
        const user = await this.users.createInTransaction(manager, account, hash);
        await this.workforce.assignRepresentativeInTransaction(manager, siteId, contractor.id, {
          userId: user.id,
        });
        return user;
      });
    } catch (error) {
      knownUnique(error, ['uq_app_user_username', 'uq_contractor_code']);
    }
  }

  async rename(siteId: string, userId: string, input: RenameSiteProfileDto) {
    const value = command(RenameSiteProfileDto, input);
    return this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .findOne({ where: { id: uuid(userId) }, lock: { mode: 'pessimistic_write' } });
      if (!user) missing();
      await this.workforce.requireExclusiveRepresentativeSite(manager, siteId, userId);
      const roles = await manager.getRepository(UserRoleAssignmentEntity).findBy({ userId });
      if (!roles.some((r) => r.siteId === siteId && r.role === UserRole.CONTRACTOR_REPRESENTATIVE))
        missing();
      if (roles.some((r) => r.siteId !== siteId))
        conflict('Shared profiles must be edited by an administrator');
      if (user.displayName !== value.expectedName)
        conflict('Profile changed. Refresh before editing');
      await manager.getRepository(UserEntity).update(user.id, { displayName: value.name });
      return { id: user.id, name: value.name };
    });
  }

  async create(siteId: string, contractorId: string, input: CreateSiteRepresentativeDto) {
    const value = command(CreateSiteRepresentativeDto, input);
    const account = command(CreateUserDto, {
      ...value,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: uuid(siteId) }],
    });
    uuid(contractorId);
    const hash = await hashPassword(value.temporaryPassword);
    try {
      return await this.source.transaction(async (manager) => {
        const user = await this.users.createInTransaction(manager, account, hash);
        await this.workforce.assignRepresentativeInTransaction(manager, siteId, contractorId, {
          userId: user.id,
        });
        return user;
      });
    } catch (error) {
      knownUnique(error, [
        'uq_app_user_username',
        'uq_contractor_representative_assignment',
        'uq_contractor_representative_grant',
      ]);
    }
  }
}

@ApiTags('site-representatives')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteManagerGuard)
@Controller('sites/:siteId')
export class SiteRepresentativesController {
  private readonly logger = new Logger(SiteRepresentativesController.name);
  constructor(
    private readonly representatives: SiteRepresentativesService,
    private readonly users: UsersService,
  ) {}

  @Post('contractor-representative-accounts')
  async createWithContractor(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateContractorRepresentativeDto,
  ) {
    const result = await this.representatives.createWithContractor(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.create-combined',
      siteId,
      resourceId: result!.id,
    });
    return result;
  }

  @Patch('representative-accounts/:userId/name')
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('userId') userId: string,
    @Body() input: RenameSiteProfileDto,
  ) {
    const result = await this.representatives.rename(siteId, userId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.rename',
      siteId,
      resourceId: userId,
    });
    return result;
  }

  @Get('representative-accounts')
  list(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const paging = pagination(offset, limit);
    return this.users.listSiteRepresentatives(siteId, paging.offset, paging.limit);
  }

  @Post('contractors/:contractorId/representative-accounts')
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateSiteRepresentativeDto,
  ) {
    const user = await this.representatives.create(siteId, contractorId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.create',
      siteId,
      contractorId,
      resourceId: user.id,
    });
    return user;
  }
}
