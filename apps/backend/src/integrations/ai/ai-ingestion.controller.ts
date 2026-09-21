import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
  ApiServiceUnavailableResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { AiIngestionService, type AiIngestionResult } from './ai-ingestion.service.js';

@ApiTags('ai-ingestion')
@Controller('integrations/ai')
@UseGuards(ServiceAuthGuard)
export class AiIngestionController {
  constructor(private readonly service: AiIngestionService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ingest technical observation event from SmartSite AI' })
  @ApiAcceptedResponse({ description: 'Event accepted for processing or skipped per policy.' })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Contract schema or geometry validation failed.',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Event ID already exists with a different payload hash.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid service token.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorResponseDto,
    description: 'Retry after the Retry-After header duration.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'Persistence is unavailable.',
  })
  async ingest(@Body() payload: unknown): Promise<AiIngestionResult> {
    return await this.service.ingestEvent(payload);
  }
}
