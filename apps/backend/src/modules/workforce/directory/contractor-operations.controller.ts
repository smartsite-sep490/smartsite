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
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { MainParticipationCommandService } from '../../zones/main-participation-command.service.js';
import { MainWorkforceCreateService } from '../main-workforce-create.service.js';
import { MainRepresentativeCommandService } from '../main-representative-command.service.js';
import {
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

  constructor(
    private readonly representatives: MainRepresentativeCommandService,
    private readonly participations: MainParticipationCommandService,
    private readonly auth: UserAuthGuard,
    private readonly creation: MainWorkforceCreateService,
  ) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateContractorCommand) {
    const contractor = await this.creation.createContractor(
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'contractor.create',
      resourceId: contractor.id,
    });
    return contractor;
  }

  @Post(':contractorId/participations')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async createParticipation(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateContractorParticipationCommand,
  ) {
    const participation = await this.participations.publicCreate(
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
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
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async grantRepresentative(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: GrantContractorRepresentativeCommand,
  ) {
    const grant = await this.representatives.grant(
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
    );
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
    const worker = await this.creation.createWorker(
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
    );
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
