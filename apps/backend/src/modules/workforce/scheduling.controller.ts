import { Body, Controller, Logger, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateAbsenceRequestCommand,
  CreateShiftChangeRequestCommand,
  CreateShiftSwapRequestCommand,
  SchedulingWorkflowService,
} from './scheduling-workflow.service.js';

@ApiTags('scheduling')
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
export class SchedulingController {
  private readonly logger = new Logger(SchedulingController.name);

  constructor(private readonly scheduling: SchedulingWorkflowService) {}

  @Post('shift-change-requests')
  @ApiCreatedResponse()
  async createShiftChange(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateShiftChangeRequestCommand,
  ) {
    const result = await this.scheduling.createShiftChange(request.user!, siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-change.create',
      siteId,
      resourceId: result.id,
    });
    return result;
  }

  @Patch('shift-change-requests/:requestId/approve')
  @ApiOkResponse()
  async approveShiftChange(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.approveShiftChange(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-change.approve',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Patch('shift-change-requests/:requestId/reject')
  @ApiOkResponse()
  async rejectShiftChange(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.rejectShiftChange(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-change.reject',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Post('shift-swap-requests')
  @ApiCreatedResponse()
  async createShiftSwap(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateShiftSwapRequestCommand,
  ) {
    const result = await this.scheduling.createShiftSwap(request.user!, siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-swap.create',
      siteId,
      resourceId: result.id,
    });
    return result;
  }

  @Patch('shift-swap-requests/:requestId/confirm')
  @ApiOkResponse()
  async confirmShiftSwap(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.confirmShiftSwap(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-swap.confirm',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Patch('shift-swap-requests/:requestId/approve')
  @ApiOkResponse()
  async approveShiftSwap(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.approveShiftSwap(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-swap.approve',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Patch('shift-swap-requests/:requestId/reject')
  @ApiOkResponse()
  async rejectShiftSwap(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.rejectShiftSwap(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.shift-swap.reject',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Post('absence-requests')
  @ApiCreatedResponse()
  async createAbsence(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateAbsenceRequestCommand,
  ) {
    const result = await this.scheduling.createAbsence(request.user!, siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.absence.create',
      siteId,
      resourceId: result.id,
    });
    return result;
  }

  @Patch('absence-requests/:requestId/approve')
  @ApiOkResponse()
  async approveAbsence(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.approveAbsence(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.absence.approve',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }

  @Patch('absence-requests/:requestId/reject')
  @ApiOkResponse()
  async rejectAbsence(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
  ) {
    const result = await this.scheduling.rejectAbsence(request.user!, siteId, requestId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'scheduling.absence.reject',
      siteId,
      resourceId: result.id,
      status: result.status,
    });
    return result;
  }
}
