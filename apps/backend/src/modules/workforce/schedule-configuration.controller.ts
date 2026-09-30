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
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateScheduleVersionCommand,
  CreateShiftCommand,
  CreateWorkerScheduleCommand,
  ScheduleConfigurationService,
} from './schedule-configuration.service.js';

@ApiTags('schedule configuration')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId')
export class ScheduleConfigurationController {
  private readonly logger = new Logger(ScheduleConfigurationController.name);

  constructor(private readonly schedules: ScheduleConfigurationService) {}

  @Post('shifts')
  @ApiCreatedResponse()
  async createShift(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateShiftCommand,
  ) {
    const shift = await this.schedules.createShift(siteId, input);
    this.logger.log({ actorId: request.user!.id, action: 'shift.create', siteId, resourceId: shift.id });
    return shift;
  }

  @Post('schedule-versions')
  @ApiCreatedResponse()
  async createScheduleVersion(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateScheduleVersionCommand,
  ) {
    const version = await this.schedules.createScheduleVersion(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'schedule-version.create',
      siteId,
      resourceId: version.id,
    });
    return version;
  }

  @Post('schedule-versions/:scheduleVersionId/worker-schedules')
  @ApiCreatedResponse()
  async createWorkerSchedule(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('scheduleVersionId') scheduleVersionId: string,
    @Body() input: CreateWorkerScheduleCommand,
  ) {
    const schedule = await this.schedules.createWorkerSchedule(siteId, scheduleVersionId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker-schedule.create',
      siteId,
      resourceId: schedule.id,
    });
    return schedule;
  }
}
