import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, OmitType } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { command, knownUnique, uuid } from '../../common/configuration/commands.js';
import { pagination } from '../../common/http/pagination.js';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { authorizeMainSiteManager } from '../../common/configuration/main-site-manager-authority.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { hashPassword } from '../auth/password.js';
import { SiteManagerGuard } from '../auth/site-manager.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import { WorkforceConfigurationService } from '../workforce/directory/workforce-configuration.service.js';
import { CreateUserDto, UsersService } from './users.service.js';
import { Injectable } from '@nestjs/common';

export class CreateSiteRepresentativeDto extends OmitType(CreateUserDto, [
  'roleAssignments',
] as const) {}

@Injectable()
export class SiteRepresentativesService {
  constructor(
    private readonly source: DataSource,
    private readonly users: UsersService,
    private readonly workforce: WorkforceConfigurationService,
  ) {}

  async create(
    siteId: string,
    contractorId: string,
    input: CreateSiteRepresentativeDto,
    context: MainConfigurationCommandContext,
  ) {
    if (!context?.actorUserId) throw new UnauthorizedException();
    const scopedSiteId = uuid(siteId).toLowerCase();
    const scopedContractorId = uuid(contractorId).toLowerCase();
    const value = command(CreateSiteRepresentativeDto, input);
    const account = command(CreateUserDto, {
      ...value,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: scopedSiteId }],
    });
    const hash = await hashPassword(value.temporaryPassword);
    try {
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'USER_SITE_REPRESENTATIVE_CREATE',
        {
          siteId: scopedSiteId,
          contractorId: scopedContractorId,
          username: account.username,
          displayName: account.displayName,
          roleAssignments: account.roleAssignments,
        },
        async (manager) => {
          const user = await this.users.createInTransaction(manager, account, hash);
          await this.workforce.assignRepresentativeInTransaction(
            manager,
            scopedSiteId,
            scopedContractorId,
            { userId: user.id },
          );
          return user;
        },
        (manager) => authorizeMainSiteManager(manager, context.actorUserId, scopedSiteId),
      );
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
    private readonly auth: UserAuthGuard,
  ) {}

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
    const user = await this.representatives.create(
      siteId,
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
    );
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
