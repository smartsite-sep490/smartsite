import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiTooManyRequestsResponse,
  ApiServiceUnavailableResponse,
  ApiProperty,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { AiIngestionService, type AiIngestionResult } from './ai-ingestion.service.js';
import { EventProcessingStatus } from '../../database/entities/enums.js';

class AiIngestionResponseDto implements AiIngestionResult {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ enum: [...Object.values(EventProcessingStatus), 'DUPLICATE_ACCEPTED'] })
  status!: AiIngestionResult['status'];

  @ApiProperty({ type: [String], format: 'uuid' })
  alertIds!: string[];
}

@ApiTags('ai-ingestion')
@Controller('integrations/ai')
@UseGuards(ServiceAuthGuard)
export class AiIngestionController {
  constructor(private readonly service: AiIngestionService) {}

  @Post('events')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ingest technical observation event from SmartSite AI' })
  @ApiAcceptedResponse({
    type: AiIngestionResponseDto,
    description: 'Event accepted for processing or skipped per policy.',
  })
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

  @Post('worker-events')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestWorker(
    @Req() request: Request,
    @Body() payload: unknown,
  ): Promise<AiIngestionResult> {
    const secret = request.headers['x-worker-generation-secret'];
    let count = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2)
      if (request.rawHeaders[i]?.toLowerCase() === 'x-worker-generation-secret') count++;
    if (count !== 1 || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
      throw new PublicHttpException(401, {
        code: 'UNAUTHORIZED',
        message: 'Worker credential is invalid',
      });
    return this.service.ingestWorkerEvent(payload, secret);
  }
}
