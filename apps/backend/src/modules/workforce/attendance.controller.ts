import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  AttendanceService,
  RecordAttendanceCommand,
  RequestAttendanceCorrectionCommand,
  ReviewAttendanceCorrectionCommand,
} from './attendance.service.js';
@ApiTags('attendance')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}
  @Get('attendance') overview(@Req() req: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.attendance.overview(req.user!, siteId);
  }
  @Post('gate-events/:id/attendance') record(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: RecordAttendanceCommand,
  ) {
    return this.attendance.record(req.user!, siteId, id, input);
  }
  @Post('attendance-sessions/:id/corrections') request(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: RequestAttendanceCorrectionCommand,
  ) {
    return this.attendance.requestCorrection(req.user!, siteId, id, input);
  }
  @Post('attendance-corrections/:id/review') review(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() input: ReviewAttendanceCorrectionCommand,
  ) {
    return this.attendance.reviewCorrection(req.user!, siteId, id, input);
  }
}
