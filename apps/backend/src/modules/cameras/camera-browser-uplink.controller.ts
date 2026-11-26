import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES } from '@smartsite/contracts/browser-camera-uplink';
import { invalid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { CameraBrowserUplinkService } from './camera-browser-uplink.service.js';

function singleHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1) return value[0];
  return undefined;
}

export async function readBoundedJpegBody(request: Request, maxBytes: number): Promise<Buffer> {
  const contentType = singleHeader(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'image/jpeg') {
    throw new PublicHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
      code: 'INVALID_MEDIA_TYPE',
      message: 'Browser uplink frames must use Content-Type: image/jpeg',
    });
  }

  const declaredLength = singleHeader(request, 'content-length');
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      throw new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        code: 'FRAME_TOO_LARGE',
        message: 'Browser uplink frame exceeds maximum size limit',
      });
    }
  }

  if (Buffer.isBuffer(request.body)) {
    if (request.body.byteLength > maxBytes) {
      throw new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        code: 'FRAME_TOO_LARGE',
        message: 'Browser uplink frame exceeds maximum size limit',
      });
    }
    return request.body;
  }

  if (request.destroyed || (request as { aborted?: boolean }).aborted) {
    throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
      code: 'BAD_REQUEST',
      message: 'Browser uplink frame upload was aborted',
    });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
      request.off('close', onClose);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onData = (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        request.pause();
        fail(
          new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
            code: 'FRAME_TOO_LARGE',
            message: 'Browser uplink frame exceeds maximum size limit',
          }),
        );
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, total));
    };

    const onError = () => {
      fail(
        new PublicHttpException(HttpStatus.BAD_REQUEST, {
          code: 'BAD_REQUEST',
          message: 'Could not read browser uplink frame body',
        }),
      );
    };

    const onAborted = () => {
      fail(
        new PublicHttpException(HttpStatus.BAD_REQUEST, {
          code: 'BAD_REQUEST',
          message: 'Browser uplink frame upload was aborted',
        }),
      );
    };

    const onClose = () => {
      if (!request.complete) {
        onAborted();
      }
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
    request.on('close', onClose);
  });
}

@ApiTags('camera-browser-uplink')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/cameras/:cameraId/browser-uplink')
export class CameraBrowserUplinkController {
  constructor(private readonly uplinks: CameraBrowserUplinkService) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length !== 0) {
      invalid('Browser uplink status accepts no query parameters');
    }
    return this.uplinks.status(request.headers.authorization!.slice(7), siteId, cameraId);
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  start(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() input: unknown,
  ) {
    if (Object.keys(request.query).length !== 0) {
      invalid('Browser uplink start accepts no query parameters');
    }
    return this.uplinks.start(request.headers.authorization!.slice(7), siteId, cameraId, input);
  }

  @Post('frames')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async uploadFrame(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
  ) {
    if (Object.keys(request.query).length !== 0) {
      invalid('Browser uplink frame upload accepts no query parameters');
    }
    if (!this.uplinks.isEnabled()) {
      throw new PublicHttpException(HttpStatus.NOT_IMPLEMENTED, {
        code: 'UNSUPPORTED_CAPABILITY',
        message: 'Browser camera uplink is not enabled',
      });
    }
    const jpegBytes = await readBoundedJpegBody(
      request,
      BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
    );
    return this.uplinks.uploadFrame(
      request.headers.authorization!.slice(7),
      siteId,
      cameraId,
      {
        contentType: singleHeader(request, 'content-type'),
        leaseId: singleHeader(request, 'x-uplink-lease-id'),
        sequence: singleHeader(request, 'x-uplink-sequence'),
        capturedAt: singleHeader(request, 'x-uplink-captured-at'),
        width: singleHeader(request, 'x-uplink-width'),
        height: singleHeader(request, 'x-uplink-height'),
      },
      jpegBytes,
    );
  }

  @Post('stop')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  stop(
    @Req() request: Request,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() input: unknown,
  ) {
    if (Object.keys(request.query).length !== 0) {
      invalid('Browser uplink stop accepts no query parameters');
    }
    return this.uplinks.stop(request.headers.authorization!.slice(7), siteId, cameraId, input);
  }
}
