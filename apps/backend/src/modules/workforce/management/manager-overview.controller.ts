import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SiteManagerGuard } from '../../auth/site-manager.guard.js';
import { ManagerOverviewService } from './manager-overview.service.js';

@ApiTags('site-manager-overview')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteManagerGuard)
@Controller('sites/:siteId/management')
export class ManagerOverviewController {
  constructor(private readonly overview: ManagerOverviewService) {}
  @Get('overview') summary(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const paging = pagination(offset, limit);
    return this.overview.overview(req.user!, siteId, paging.offset, paging.limit);
  }
  @Get('contractors/:contractorId') detail(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Query('date') date: string,
    @Query('timezone') timezone: string,
  ) {
    return this.overview.detail(req.user!, siteId, contractorId, { date, timezone });
  }
}
