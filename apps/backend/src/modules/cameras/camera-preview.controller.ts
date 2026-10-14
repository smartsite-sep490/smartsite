import { Controller, Get, Header, Query, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { invalid } from '../../common/configuration/commands.js';
import { pagination } from '../../common/http/pagination.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { CameraPreviewService } from './camera-preview.service.js';

@ApiTags('camera-preview')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class CameraPreviewController {
  constructor(private readonly previews: CameraPreviewService) {}

  @Get('cameras/:cameraId/recorded-video')
  async recordedVideo(
    @Req() request: Request,
    @Res() response: Response,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length) invalid('Recorded video accepts no query configuration');
    const controller = new AbortController(),
      abort = () => controller.abort();
    request.on('aborted', abort);
    response.on('close', abort);
    try {
      const media = await this.previews.recordedVideo(
        request.headers.authorization!.slice(7),
        siteId,
        cameraId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'video/mp4');
      response.setHeader('X-Camera-External-Id', media.externalId);
      response.setHeader('X-Source-Sha256', media.sha256);
      response.setHeader(
        'Access-Control-Expose-Headers',
        'X-Request-Id, Retry-After, X-Camera-External-Id, X-Source-Sha256',
      );
      response.send(media.bytes);
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }

  @Get('cameras/:cameraId/video-stream')
  async video(
    @Req() request: Request,
    @Res() response: Response,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length !== 0)
      invalid('Camera stream accepts no query configuration');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.on('aborted', abort);
    response.on('close', abort);
    const stream = this.previews.video(
      request.headers.authorization!.slice(7),
      siteId,
      cameraId,
      controller.signal,
    );
    try {
      // Keep normal HTTP error handling until the first scoped, fresh frame is available.
      let next = await stream.next();
      if (controller.signal.aborted) return;
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Accel-Buffering', 'no');
      while (!next.done && !controller.signal.aborted) {
        // Allow one large JPEG to drain; never enqueue a second image behind it.
        if (!response.write(JSON.stringify(next.value) + '\n')) {
          const drained = await new Promise<boolean>((resolve) => {
            const done = (value: boolean) => {
              clearTimeout(timer);
              response.off('drain', onDrain);
              controller.signal.removeEventListener('abort', onAbort);
              resolve(value);
            };
            const onDrain = () => done(true);
            const onAbort = () => done(false);
            const timer = setTimeout(() => done(false), 250);
            response.once('drain', onDrain);
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (controller.signal.aborted) done(false);
          });
          if (!drained) {
            controller.abort();
            response.destroy();
            return;
          }
        }
        next = await stream.next();
      }
      if (!response.destroyed) response.end();
    } catch (error) {
      if (response.headersSent) response.destroy();
      else if (!controller.signal.aborted) throw error;
    } finally {
      controller.abort();
      await stream.return(undefined);
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }

  @Get('cameras/:cameraId/preview')
  @Header('Cache-Control', 'no-store')
  async read(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length !== 0) invalid('Preview accepts no query configuration');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.on('aborted', abort);
    response.on('close', abort);
    try {
      return await this.previews.read(
        request.headers.authorization!.slice(7),
        siteId,
        cameraId,
        controller.signal,
      );
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  }

  @Get('preview-cameras')
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    if (Object.keys(request.query).some((key) => !['offset', 'limit'].includes(key))) invalid();
    const page = pagination(offset, limit);
    return this.previews.list(
      request.headers.authorization!.slice(7),
      siteId,
      page.offset,
      page.limit,
    );
  }
}
