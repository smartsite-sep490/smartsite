import { Controller, Get, Header, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { isUUID } from 'class-validator';
import type { BackendEnvironment } from '../../config/environment.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraConfigurationService } from '../../modules/cameras/camera-configuration.service.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';

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
  @Header('Cache-Control', 'no-store')
  configuration(@Param('cameraId') cameraId: string) {
    const allowed = this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true });
    if (!isUUID(cameraId) || !allowed.includes(cameraId.toLowerCase()))
      throw new PublicHttpException(HttpStatus.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Configuration resource not found',
      });
    return this.cameras.buildConfigurationForCamera(cameraId);
  }
}
