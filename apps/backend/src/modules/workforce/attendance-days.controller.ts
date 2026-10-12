import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AttendanceDaysService } from './attendance-days.service.js';
import {
  AttendanceDaysDto,
  AttendanceTimeRequestsDto,
  AttendanceTimeRequestDto,
  ReviewAttendanceDayDto,
  IgnoreDuplicateAttendanceDto,
  ReviewAttendanceTimeDto,
} from './dto/attendance.dto.js';
@ApiTags('attendance')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class AttendanceDaysController {
  constructor(private readonly days: AttendanceDaysService) {}
  @Get('attendance-time-requests') timeRequests(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: AttendanceTimeRequestsDto,
  ) {
    return this.days.timeRequests(req.user!, siteId, query);
  }
  @Post('attendance-sessions/:id/ignore-duplicate') ignoreDuplicate(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: IgnoreDuplicateAttendanceDto,
  ) {
    return this.days.ignoreDuplicate(req.user!, siteId, id, input);
  }
  @Get('attendance-days/:id') detail(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.days.detail(req.user!, siteId, id);
  }
  @Get('attendance-timesheets') timesheets(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: AttendanceDaysDto,
  ) {
    return this.days.timesheets(req.user!, siteId, query);
  }
  @Get('attendance-days') list(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: AttendanceDaysDto,
  ) {
    return this.days.list(req.user!, siteId, query);
  }
  @Post('attendance-time-requests') request(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: AttendanceTimeRequestDto,
  ) {
    return this.days.request(req.user!, siteId, input);
  }
  @Post('attendance-time-requests/:kind/:id/review') review(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('kind') kind: 'OVERTIME' | 'LEAVE',
    @Body() input: ReviewAttendanceTimeDto,
  ) {
    return this.days.review(req.user!, siteId, id, kind, input);
  }
  @Post('attendance-days/:id/confirm') confirm(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: ReviewAttendanceDayDto,
  ) {
    return this.days.acknowledge(req.user!, siteId, id, input);
  }
}
