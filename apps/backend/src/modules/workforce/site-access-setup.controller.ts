import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  SiteAccessSetupService,
  GrantContractorZoneCommand,
  GrantWorkerZoneCommand,
} from './site-access-setup.service.js';

@ApiTags('site-access-setup')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/access-setup')
export class SiteAccessSetupController {
  constructor(private readonly setup: SiteAccessSetupService) {}
  @Get() options(@Req() req: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.setup.options(req.user!, siteId);
  }
  @Post('contractor-zone-permissions') contractor(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantContractorZoneCommand,
  ) {
    return this.setup.grantContractor(req.user!, siteId, input);
  }
  @Post('worker-zone-permissions') worker(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantWorkerZoneCommand,
  ) {
    return this.setup.grantWorker(req.user!, siteId, input);
  }
  @Post('contractor-zone-permissions/:id/revoke') revokeContractor(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.setup.revoke(req.user!, siteId, id, 'contractor');
  }
  @Post('worker-zone-permissions/:id/revoke') revokeWorker(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.setup.revoke(req.user!, siteId, id, 'worker');
  }
}
