import {
  Controller,
  Body,
  Post,
  Req,
  HttpCode,
  Get,
  Header,
  Headers,
  HttpStatus,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiNotModifiedResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  computeCanonicalPayloadHash,
  parseCameraConfigurationAcknowledgementPayload,
} from '@smartsite/contracts';
import { invalid } from '../../common/configuration/commands.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { isUUID } from 'class-validator';
import type { BackendEnvironment } from '../../config/environment.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraConfigurationService } from '../../modules/cameras/camera-configuration.service.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';

function configurationEtag(configuration: unknown): string {
  return `"sha256:${computeCanonicalPayloadHash(configuration)}"`;
}

function matchesIfNoneMatch(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(',').some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === '*' || trimmed === etag || trimmed === `W/${etag}`;
  });
}

@ApiTags('ai-configuration')
@ApiBearerAuth('ai-service-token')
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(ServiceAuthGuard)
@Controller('integrations/ai/cameras')
export class AiConfigurationController {
  constructor(
    private readonly cameras: CameraConfigurationService,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  @Get(':cameraId/configuration')
  @ApiOkResponse({
    description: 'Canonical CameraRegionConfiguration 1.0.0 snapshot; active regions only.',
  })
  @ApiNotModifiedResponse({ description: 'Configuration version has not changed.' })
  @Header('Cache-Control', 'no-store')
  async configuration(
    @Param('cameraId') cameraId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertCameraAllowed(cameraId);
    const configuration = await this.cameras.buildConfigurationForCamera(cameraId);
    const etag = configurationEtag(configuration);
    response.setHeader('ETag', etag);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return configuration;
  }

  private assertCameraAllowed(cameraId: string): void {
    const allowed = this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true });
    if (!isUUID(cameraId) || !allowed.includes(cameraId.toLowerCase()))
      throw new PublicHttpException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Configuration resource not found',
      });
  }

  @Post(':cameraId/configuration-ack')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async configurationAck(
    @Param('cameraId') cameraId: string,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    this.assertCameraAllowed(cameraId);
    const secret = request.headers['x-worker-generation-secret'];
    let occurrences = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2)
      if (request.rawHeaders[i]?.toLowerCase() === 'x-worker-generation-secret') occurrences++;
    if (occurrences !== 1 || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw new PublicHttpException(401, {
        code: 'UNAUTHORIZED',
        message: 'Worker credential is invalid',
      });
    const serialized = JSON.stringify(body);
    if (typeof serialized !== 'string') invalid();
    const parsed = parseCameraConfigurationAcknowledgementPayload(serialized);
    if (!parsed.isValid || !parsed.value) invalid();
    return this.cameras.acknowledgeConfigurationForCamera(
      cameraId.toLowerCase(),
      secret,
      parsed.value,
    );
  }

  @Get(':cameraId/configuration-bundle')
  @ApiOkResponse({
    description:
      'Persisted CameraConfigurationBundle 1.0.0; not worker application or camera health.',
  })
  @ApiNotModifiedResponse({
    description: 'The validated current issued bundle matches the supplied ETag.',
  })
  @Header('Cache-Control', 'no-store')
  async configurationBundle(
    @Param('cameraId') cameraId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertCameraAllowed(cameraId);
    const bundle = await this.cameras.readConfigurationBundleForCamera(cameraId.toLowerCase());
    const etag = `"sha256:${bundle.bundleSha256}"`;
    response.setHeader('ETag', etag);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return bundle;
  }
}
