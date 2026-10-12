import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { pagination } from '../../common/http/pagination.js';
import { ScheduleAssignmentService } from './schedule-assignment.service.js';
import {
  ChangeScheduleAssignmentDto,
  CreateScheduleAssignmentDto,
  ScheduleAssignmentDto,
} from './dto/schedule-assignment.dto.js';

@ApiTags('schedule assignments')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/schedule-assignments')
export class ScheduleAssignmentController {
  constructor(private readonly assignments: ScheduleAssignmentService) {}
  @Post('preview') preview(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: ScheduleAssignmentDto,
  ) {
    return this.assignments.preview(request.user!, siteId, input);
  }
  @Post() create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateScheduleAssignmentDto,
  ) {
    return this.assignments.create(request.user!, siteId, input);
  }
  @Get() list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('contractorId') contractorId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    return this.assignments.list(request.user!, siteId, contractorId, value.offset, value.limit);
  }
  @Post(':id/change') change(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: ChangeScheduleAssignmentDto,
  ) {
    return this.assignments.change(request.user!, siteId, id, input);
  }
}
