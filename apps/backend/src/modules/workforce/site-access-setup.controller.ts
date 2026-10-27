import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { MainZonePermissionCommandService } from '../zones/main-zone-permission-command.service.js';
import { SiteAccessSetupQueryService } from './site-access-setup-query.service.js';
import {
  GrantContractorZoneCommand,
  GrantWorkerZoneCommand,
} from './site-access-setup.commands.js';

@ApiTags('site-access-setup')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/access-setup')
export class SiteAccessSetupController {
  constructor(
    private readonly permissions: MainZonePermissionCommandService,
    private readonly auth: UserAuthGuard,
    private readonly queries: SiteAccessSetupQueryService,
  ) {}
  @Get()
  options(@Req() request: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.queries.options(siteId, configurationCommandContext(request, this.auth));
  }
  @Post('contractor-zone-permissions')
  contractor(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantContractorZoneCommand,
  ) {
    return this.permissions.publicGrantContractor(
      siteId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }
  @Post('worker-zone-permissions')
  worker(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: GrantWorkerZoneCommand,
  ) {
    return this.permissions.publicGrantWorker(
      siteId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }
  @Post('contractor-zone-permissions/:id/revoke')
  revokeContractor(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.permissions.publicRevoke(
      siteId,
      id,
      'contractor',
      configurationCommandContext(request, this.auth),
    );
  }
  @Post('worker-zone-permissions/:id/revoke')
  revokeWorker(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.permissions.publicRevoke(
      siteId,
      id,
      'worker',
      configurationCommandContext(request, this.auth),
    );
  }
}
