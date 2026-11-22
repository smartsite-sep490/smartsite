import { Body, Controller, Get, Header, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { CameraSourceService } from './camera-source.service.js';

@ApiTags('camera-source-setup')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/cameras/:cameraId/source-hosts')
export class CameraSourceController {
  constructor(private readonly sources: CameraSourceService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    return this.sources.list(request.headers.authorization!.slice(7), siteId, cameraId);
  }

  @Post(':hostId/probe')
  @Header('Cache-Control', 'no-store')
  async probe(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('hostId') hostId: string,
    @Body() input: unknown,
  ) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    request.on('aborted', abort);
    response.on('close', abort);
    try {
      return await this.sources.probe(
        request.headers.authorization!.slice(7),
        siteId,
        cameraId,
        hostId,
        input,
        controller.signal,
      );
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }

  @Post(':hostId/apply')
  @Header('Cache-Control', 'no-store')
  apply(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('hostId') hostId: string,
    @Body() input: unknown,
  ) {
    // Once a source transition begins it must finish or persist an explicit failure;
    // browser disconnect cannot silently roll back a committed generation.
    return this.sources.apply(
      request.headers.authorization!.slice(7),
      siteId,
      cameraId,
      hostId,
      input,
    );
  }

  @Post(':hostId/resume')
  @Header('Cache-Control', 'no-store')
  resume(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('hostId') hostId: string,
    @Body() input: unknown,
  ) {
    // A disconnect cannot undo an already committed generation transition.
    return this.sources.resume(
      request.headers.authorization!.slice(7),
      siteId,
      cameraId,
      hostId,
      input,
    );
  }
}
