import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { invalid } from '../../common/configuration/commands.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { CameraApplicationStatusService } from './camera-application-status.service.js';

@ApiTags('camera-configuration')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/cameras/:cameraId')
export class CameraApplicationStatusController {
  constructor(private readonly status: CameraApplicationStatusService) {}

  @Get('application-status')
  @Header('Cache-Control', 'no-store')
  read(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length)
      invalid('Application status accepts no query configuration');
    return this.status.read(siteId, cameraId);
  }
}
