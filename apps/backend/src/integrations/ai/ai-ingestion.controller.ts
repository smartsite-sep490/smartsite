import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
  @ApiBadRequestResponse({ description: 'Contract schema or geometry validation failed.' })
  @ApiConflictResponse({ description: 'Event ID already exists with a different payload hash.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid service token.' })
  async ingest(@Body() payload: unknown): Promise<AiIngestionResult> {
    return await this.service.ingestEvent(payload);
  }
}
