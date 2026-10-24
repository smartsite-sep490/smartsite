import { Body, Controller, Get, Logger, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';
import type { ContractorEntity } from '../../../database/entities/contractor.entity.js';
import type { ContractorRepresentativeAssignmentEntity } from '../../../database/entities/contractor-representative-assignment.entity.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { SiteManagerGuard } from '../../auth/site-manager.guard.js';
import { AdminGuard, UserAuthGuard } from '../../auth/user-auth.guard.js';
import { pagination } from '../../../common/http/pagination.js';
import { AssignContractorRepresentativeDto, CreateContractorDto } from './dto/workforce.dto.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { MainWorkforceCreateService } from '../main-workforce-create.service.js';
import { MainRepresentativeCommandService } from '../main-representative-command.service.js';

function contractorResponse(contractor: ContractorEntity, siteId: string) {
  return {
    id: contractor.id,
    siteId,
    code: contractor.code,
    name: contractor.name,
    isActive: contractor.isActive,
    createdAt: contractor.createdAt,
  };
}

function representativeAssignmentResponse(assignment: ContractorRepresentativeAssignmentEntity) {
  return {
    id: assignment.id,
    siteId: assignment.siteId,
    contractorId: assignment.contractorId,
    userId: assignment.userId,
    createdAt: assignment.createdAt,
  };
}

@ApiTags('contractors')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class ContractorsController {
  private readonly logger = new Logger(ContractorsController.name);

  constructor(
    private readonly workforce: WorkforceConfigurationService,
    private readonly creation: MainWorkforceCreateService,
    private readonly auth: UserAuthGuard,
    private readonly representatives: MainRepresentativeCommandService,
  ) {}

  @Post('contractors')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateContractorDto,
  ) {
    const contractor = await this.creation.createSiteContractor(
      siteId,
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.create',
      siteId,
      resourceId: contractor.id,
    });
    return contractorResponse(contractor, siteId);
  }

  @Get('contractor-participation-options')
  @UseGuards(SiteManagerGuard)
  participationOptions(@Param('siteId') siteId: string) {
    return this.workforce.participationOptions(siteId);
  }

  @Post('contractors/:contractorId/representatives')
  @UseGuards(SiteManagerGuard)
  @ApiCreatedResponse()
  async assignRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() input: AssignContractorRepresentativeDto,
  ) {
    const assignment = await this.representatives.assign(
      siteId,
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.assign',
      siteId,
      resourceId: assignment.id,
    });
    return assignment;
  }

  @Get('contractors')
  @ApiOkResponse()
  async list(@Req() request: AuthenticatedRequest, @Param('siteId') siteId: string) {
    const result = await this.workforce.listContractors(request.user!, siteId);
    return {
      items: result.items.map((contractor) => contractorResponse(contractor, siteId)),
      total: result.total,
    };
  }

  @Get('contractor-representative-assignments')
  @UseGuards(SiteManagerGuard)
  @ApiOkResponse()
  async listRepresentativeAssignments(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.workforce.listRepresentativeAssignments(
      siteId,
      value.offset,
      value.limit,
    );
    return {
      items: result.items.map(representativeAssignmentResponse),
      total: result.total,
    };
  }
}
