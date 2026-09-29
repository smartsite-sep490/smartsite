import { Body, Controller, Logger, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
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
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  ContractorOperationsService,
  CreateWorkerSiteZoneAssignmentCommand,
  SiteManagerDecisionCommand,
} from './contractor-operations.service.js';

@ApiTags('worker-site-zone-assignments')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard)
@Controller()
export class WorkerAssignmentController {
  private readonly logger = new Logger(WorkerAssignmentController.name);

  constructor(private readonly contractors: ContractorOperationsService) {}

  @Post('workers/:workerId/site-zone-assignment-requests')
  @ApiCreatedResponse()
  async requestAssignment(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @Body() input: CreateWorkerSiteZoneAssignmentCommand,
  ) {
    const assignment = await this.contractors.requestAssignment(request.user!, workerId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.assignment.request',
      resourceId: assignment.id,
      workerId: assignment.workerId,
      siteId: assignment.siteId,
    });
    return assignment;
  }

  @Post('site-zone-assignment-requests/:requestId/safety-review')
  @ApiOkResponse()
  async safetyReview(@Req() request: AuthenticatedRequest, @Param('requestId') requestId: string) {
    const assignment = await this.contractors.safetyReview(request.user!, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.assignment.safety-review',
      resourceId: assignment.id,
      workerId: assignment.workerId,
      siteId: assignment.siteId,
    });
    return assignment;
  }

  @Post('site-zone-assignment-requests/:requestId/site-manager-decision')
  @ApiOkResponse()
  async siteManagerDecision(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() input: SiteManagerDecisionCommand,
  ) {
    const assignment = await this.contractors.siteManagerDecision(request.user!, requestId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.assignment.site-manager-decision',
      resourceId: assignment.id,
      workerId: assignment.workerId,
      siteId: assignment.siteId,
      approved: input.approve,
    });
    return assignment;
  }
}
