import { Controller, Get, Header, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { invalid } from '../../common/configuration/commands.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { CameraConfigurationImageService } from './camera-configuration-image.service.js';

@ApiTags('camera-configuration')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/cameras/:cameraId')
export class CameraConfigurationImageController {
  constructor(private readonly images: CameraConfigurationImageService) {}

  @Get('configuration-image')
  @Header('Cache-Control', 'no-store')
  async read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length)
      invalid('Configuration image accepts no query configuration');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.on('aborted', abort);
    response.on('close', abort);
    if (request.aborted || response.destroyed) abort();
    try {
      const image = await this.images.read(
        request.headers.authorization!.slice(7),
        siteId,
        cameraId,
        controller.signal,
      );
      if (!controller.signal.aborted) return image;
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }
}
