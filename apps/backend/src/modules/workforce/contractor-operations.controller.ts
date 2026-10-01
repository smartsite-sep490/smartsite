import { Body, Controller, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  ContractorOperationsService,
  CreateContractorCommand,
  CreateContractorParticipationCommand,
  CreateContractorWorkerCommand,
  GrantContractorRepresentativeCommand,
} from './contractor-operations.service.js';

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
@Controller('contractors')
export class ContractorOperationsController {
  private readonly logger = new Logger(ContractorOperationsController.name);

  constructor(private readonly contractors: ContractorOperationsService) {}

  @Post()
  @ApiCreatedResponse()
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateContractorCommand) {
    const contractor = await this.contractors.createContractor(request.user!, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.create',
      resourceId: contractor.id,
    });
    return contractor;
  }

  @Post(':contractorId/participations')
  @ApiCreatedResponse()
  async createParticipation(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateContractorParticipationCommand,
  ) {
    const participation = await this.contractors.createParticipation(
      request.user!,
      contractorId,
      input,
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.participation.create',
      contractorId,
      resourceId: participation.id,
      siteId: participation.siteId,
    });
    return participation;
  }

  @Post(':contractorId/representative-grants')
  @ApiCreatedResponse()
  async grantRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: GrantContractorRepresentativeCommand,
  ) {
    const grant = await this.contractors.grantRepresentative(request.user!, contractorId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.representative.grant',
      contractorId,
      resourceId: grant.id,
      userId: grant.userId,
    });
    return grant;
  }

  @Post(':contractorId/workers')
  @ApiCreatedResponse()
  async createWorker(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateContractorWorkerCommand,
  ) {
    const worker = await this.contractors.createWorker(request.user!, contractorId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.worker.create',
      contractorId,
      resourceId: worker.id,
      siteId: worker.siteId,
    });
    return worker;
  }
}
