import {
  Controller,
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
import type { Response } from 'express';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
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
    const allowed = this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true });
    if (!isUUID(cameraId) || !allowed.includes(cameraId.toLowerCase()))
      throw new PublicHttpException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Configuration resource not found',
      });
    const configuration = await this.cameras.buildConfigurationForCamera(cameraId);
    const etag = configurationEtag(configuration);
    response.setHeader('ETag', etag);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return configuration;
  }
}
