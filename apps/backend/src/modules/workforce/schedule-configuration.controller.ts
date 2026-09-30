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
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateScheduleVersionDto,
  CreateShiftDto,
  CreateWorkerScheduleDto,
} from './dto/schedule-configuration.dto.js';
import { ScheduleConfigurationService } from './schedule-configuration.service.js';

@ApiTags('schedule configuration')
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
export class ScheduleConfigurationController {
  private readonly logger = new Logger(ScheduleConfigurationController.name);

  constructor(private readonly schedules: ScheduleConfigurationService) {}

  @Post('shifts')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async createShift(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateShiftDto,
  ) {
    const shift = await this.schedules.createShift(siteId, input);
    this.logger.log({ actorId: request.user!.id, action: 'shift.create', siteId, resourceId: shift.id });
    return shift;
  }

  @Post('schedule-versions')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async createScheduleVersion(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateScheduleVersionDto,
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
  @UseGuards(AdminGuard)
  @ApiCreatedResponse()
  async createWorkerSchedule(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('scheduleVersionId') scheduleVersionId: string,
    @Body() input: CreateWorkerScheduleDto,
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

  @Get('shifts')
  @ApiOkResponse()
  async listShifts(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    const result = await this.schedules.listShifts(request.user!, siteId);
    return { items: result.items, total: result.total };
  }

  @Get('schedule-versions')
  @ApiOkResponse()
  async listScheduleVersions(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    const result = await this.schedules.listScheduleVersions(request.user!, siteId);
    return { items: result.items, total: result.total };
  }

  @Get('worker-schedules')
  @ApiOkResponse()
  async listWorkerSchedules(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.schedules.listWorkerSchedules(request.user!, siteId, offset, limit);
    return { items: result.items, total: result.total };
  }
}
