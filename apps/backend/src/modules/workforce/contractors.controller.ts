import { Body, Controller, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import type { ContractorEntity } from '../../database/entities/contractor.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  AssignContractorRepresentativeCommand,
  CreateContractorCommand,
  WorkforceConfigurationService,
} from './workforce-configuration.service.js';

function contractorResponse(contractor: ContractorEntity) {
  return {
    id: contractor.id,
    siteId: contractor.siteId,
    code: contractor.code,
    name: contractor.name,
    isActive: contractor.isActive,
    createdAt: contractor.createdAt,
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
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId/contractors')
export class ContractorsController {
  private readonly logger = new Logger(ContractorsController.name);

  constructor(private readonly workforce: WorkforceConfigurationService) {}

  @Post()
  @ApiCreatedResponse()
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateContractorCommand,
  ) {
    const contractor = await this.workforce.createContractor(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.create',
      siteId,
      resourceId: contractor.id,
    });
    return contractorResponse(contractor);
  }

  @Post(':contractorId/representatives')
  @ApiCreatedResponse()
  async assignRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() input: AssignContractorRepresentativeCommand,
  ) {
    const assignment = await this.workforce.assignRepresentative(siteId, contractorId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.assign',
      siteId,
      resourceId: assignment.id,
    });
    return assignment;
  }
}
