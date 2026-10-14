import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pagination } from '../../common/http/pagination.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { SafetyOverviewService } from './safety-overview.service.js';
@ApiTags('Safety overview')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class SafetyOverviewController {
  constructor(private readonly service: SafetyOverviewService) {}
  @Get('safety-overview/contractors')
  @Header('Cache-Control', 'private, no-store')
  contractors(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('date') date: string,
    @Query('timezone') timezone: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.contractors(req.user!, siteId, {
      date,
      timezone,
      ...pagination(offset, limit),
    });
  }
  @Get('safety-overview')
  @Header('Cache-Control', 'private, no-store')
  overview(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('date') date: string,
    @Query('timezone') timezone: string,
    @Query('contractorId') contractorId?: string,
    @Query('teamId') teamId?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('unassignedOffset') unassignedOffset?: string,
    @Query('unassignedLimit') unassignedLimit?: string,
  ) {
    const unassigned = pagination(unassignedOffset, unassignedLimit);
    return this.service.overview(req.user!, siteId, {
      date,
      timezone,
      contractorId,
      teamId,
      unassignedOffset: unassigned.offset,
      unassignedLimit: unassigned.limit,
      ...pagination(offset, limit),
    });
  }
  @Get('safety-overview/teams/:id')
  @Header('Cache-Control', 'private, no-store')
  team(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Query('date') date: string,
    @Query('timezone') timezone: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.team(req.user!, siteId, id, {
      date,
      timezone,
      ...pagination(offset, limit),
    });
  }
  @Get('safety-alerts/:alertId/work-context')
  @Header('Cache-Control', 'private, no-store')
  alert(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('alertId') id: string,
  ) {
    return this.service.alert(req.user!, siteId, id);
  }
}
