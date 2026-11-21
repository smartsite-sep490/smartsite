import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { TeamAttendanceService } from './team-attendance.service.js';
import { SubmitTeamAttendanceDto } from './dto/team-attendance.dto.js';

@ApiTags('team-attendance')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/worker-schedules/:scheduleId/zone-attendance')
export class TeamAttendanceController {
  constructor(private readonly attendance: TeamAttendanceService) {}
  @Get() get(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('scheduleId') scheduleId: string,
  ) {
    return this.attendance.get(req.user!, siteId, scheduleId);
  }
  @Put() submit(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('scheduleId') scheduleId: string,
    @Body() input: SubmitTeamAttendanceDto,
  ) {
    return this.attendance.submit(req.user!, siteId, scheduleId, input);
  }
}
