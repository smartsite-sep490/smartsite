import { Body, Controller, Get, Header, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readSavedPpePolicy } from './camera-ppe-policy-management-read.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { CameraPpePolicyService } from './camera-ppe-policy.service.js';

@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/cameras/:cameraId/ppe-policy')
export class CameraPpePolicyController {
  constructor(
    private readonly policies: CameraPpePolicyService,
    private readonly auth: UserAuthGuard,
    private readonly source: DataSource,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  readCamera(@Param('siteId') siteId: string, @Param('cameraId') cameraId: string) {
    return readSavedPpePolicy(this.source, siteId, cameraId);
  }

  @Get('regions/:regionId')
  @Header('Cache-Control', 'no-store')
  readRegion(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
  ) {
    return readSavedPpePolicy(this.source, siteId, cameraId, regionId);
  }

  @Post('initialize')
  @Header('Cache-Control', 'no-store')
  initialize(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.policies.initialize(
      siteId,
      cameraId,
      body,
      configurationCommandContext(request, this.auth),
    );
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  setCameraPolicy(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.policies.setCameraPolicy(
      siteId,
      cameraId,
      body,
      configurationCommandContext(request, this.auth),
    );
  }

  @Patch('regions/:regionId')
  @Header('Cache-Control', 'no-store')
  setRegionPolicy(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.policies.setRegionPolicy(
      siteId,
      cameraId,
      regionId,
      body,
      configurationCommandContext(request, this.auth),
    );
  }

  @Post('regions/:regionId/activate')
  @Header('Cache-Control', 'no-store')
  activateRegion(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.policies.activateRegionWithPolicy(
      siteId,
      cameraId,
      regionId,
      body,
      configurationCommandContext(request, this.auth),
    );
  }
}
