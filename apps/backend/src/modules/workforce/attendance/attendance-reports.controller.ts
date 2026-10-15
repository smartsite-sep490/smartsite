import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { AttendanceReportDto, AttendanceWorkersDto } from './dto/attendance-report.dto.js';

@ApiTags('attendance')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class AttendanceReportsController {
  constructor(private readonly reports: AttendanceReportsService) {}
  @Get('attendance-summary') summary(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: AttendanceReportDto,
  ) {
    return this.reports.summary(req.user!, siteId, query);
  }
  @Get('attendance-workers') workers(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: AttendanceWorkersDto,
  ) {
    return this.reports.list(req.user!, siteId, query);
  }
}
