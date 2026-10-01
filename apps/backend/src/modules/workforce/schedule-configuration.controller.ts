import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import {
  EligibleShiftPageResponseDto,
  SwapCandidatePageResponseDto,
} from '../../common/http/management-response.dto.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
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
  @ApiCreatedResponse()
  async createShift(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateShiftDto,
  ) {
    const shift = await this.schedules.createShift(request.user!, siteId, input);
    this.logger.log({ actorId: request.user!.id, action: 'shift.create', siteId, resourceId: shift.id });
    return shift;
  }

  @Delete('shifts/:shiftId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deleteShift(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('shiftId') shiftId: string,
  ): Promise<void> {
    await this.schedules.deleteShift(request.user!, siteId, shiftId);
    this.logger.log({ actorId: request.user!.id, action: 'shift.delete', siteId, resourceId: shiftId });
  }

  @Post('schedule-versions')
  @ApiCreatedResponse()
  async createScheduleVersion(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateScheduleVersionDto,
  ) {
    const version = await this.schedules.createScheduleVersion(request.user!, siteId, input);
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
    @Body() input: CreateWorkerScheduleDto,
  ) {
    const schedule = await this.schedules.createWorkerSchedule(
      request.user!,
      siteId,
      scheduleVersionId,
      input,
    );
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

  @Get('worker-schedules/:workerScheduleId/eligible-shifts')
  @ApiOkResponse({ type: EligibleShiftPageResponseDto })
  async listEligibleShifts(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerScheduleId') workerScheduleId: string,
  ) {
    return this.schedules.listEligibleShifts(request.user!, siteId, workerScheduleId);
  }

  @Get('worker-schedules/:workerScheduleId/swap-candidates')
  @ApiOkResponse({ type: SwapCandidatePageResponseDto })
  async listSwapCandidates(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerScheduleId') workerScheduleId: string,
  ) {
    return this.schedules.listSwapCandidates(request.user!, siteId, workerScheduleId);
  }
}
