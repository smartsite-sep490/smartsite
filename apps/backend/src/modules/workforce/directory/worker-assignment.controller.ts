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
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { MainAssignmentCommandService } from '../../zones/main-assignment-command.service.js';
import {
  CreateWorkerSiteZoneAssignmentCommand,
  SiteManagerDecisionCommand,
  RevokeWorkerAssignmentCommand,
} from '../worker-assignment.commands.js';

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

  constructor(
    private readonly assignments: MainAssignmentCommandService,
    private readonly auth: UserAuthGuard,
  ) {}

  @Post('site-zone-assignment-requests/:requestId/revoke')
  @ApiCreatedResponse()
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() input: RevokeWorkerAssignmentCommand,
  ) {
    return this.assignments.publicRevoke(
      requestId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }

  @Post('workers/:workerId/site-zone-assignment-requests')
  @ApiCreatedResponse()
  async requestAssignment(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @Body() input: CreateWorkerSiteZoneAssignmentCommand,
  ) {
    const assignment = await this.assignments.publicRequest(
      workerId,
      input,
      configurationCommandContext(request, this.auth),
    );
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
  @ApiCreatedResponse()
  async safetyReview(@Req() request: AuthenticatedRequest, @Param('requestId') requestId: string) {
    const assignment = await this.assignments.publicSafetyReview(
      requestId,
      configurationCommandContext(request, this.auth),
    );
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
  @ApiCreatedResponse()
  async siteManagerDecision(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() input: SiteManagerDecisionCommand,
  ) {
    const assignment = await this.assignments.publicDecision(
      requestId,
      input,
      configurationCommandContext(request, this.auth),
    );
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
