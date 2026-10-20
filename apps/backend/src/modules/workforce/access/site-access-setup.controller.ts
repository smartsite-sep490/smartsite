import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { SiteAccessSetupQueryService } from '../site-access-setup-query.service.js';
import { MainZonePermissionCommandService } from '../../zones/main-zone-permission-command.service.js';
import {
  SiteAccessSetupService,
  GrantContractorZoneCommand,
  GrantContractorZoneDatesCommand,
  GrantWorkerZoneCommand,
} from './site-access-setup.service.js';

@ApiTags('site-access-setup')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/access-setup')
export class SiteAccessSetupController {
  constructor(
    private readonly setup: SiteAccessSetupService,
    private readonly auth: UserAuthGuard,
    private readonly queries: SiteAccessSetupQueryService,
    private readonly permissions: MainZonePermissionCommandService,
  ) {}
  @Post('contractor-zone-permissions/dates') contractorDates(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantContractorZoneDatesCommand,
  ) {
    return this.setup.grantContractor(
      req.user!,
      siteId,
      input,
      configurationCommandContext(req, this.auth),
    );
  }
  @Get() options(@Req() req: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.queries.options(siteId, configurationCommandContext(req, this.auth));
  }
  @Post('contractor-zone-permissions') contractor(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantContractorZoneCommand,
  ) {
    return this.permissions.publicGrantContractor(
      siteId,
      input,
      configurationCommandContext(req, this.auth),
    );
  }
  @Post('worker-zone-permissions') worker(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantWorkerZoneCommand,
  ) {
    return this.permissions.publicGrantWorker(
      siteId,
      input,
      configurationCommandContext(req, this.auth),
    );
  }
  @Post('contractor-zone-permissions/:id/revoke') revokeContractor(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.permissions.publicRevoke(
      siteId,
      id,
      'contractor',
      configurationCommandContext(req, this.auth),
    );
  }
  @Post('worker-zone-permissions/:id/revoke') revokeWorker(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.permissions.publicRevoke(
      siteId,
      id,
      'worker',
      configurationCommandContext(req, this.auth),
    );
  }
}
