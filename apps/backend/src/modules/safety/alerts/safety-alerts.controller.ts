import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';
import {
  SafetyAlertDetailResponseDto,
  SafetyAlertPageResponseDto,
  SafetyAlertReviewMutationResponseDto,
} from '../../../common/http/management-response.dto.js';
import { pagination } from '../../../common/http/pagination.js';
import { alertResponse } from './safety-alert-response.js';
import type { SafetyAlertReviewEntity } from '../../../database/entities/safety-alert-review.entity.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyAlertAccessGuard } from './safety-alert-access.guard.js';
import { SafetyAlertEvidenceService } from './safety-alert-evidence.service.js';
import {
  ReviewSafetyAlertCommand,
  SafetyAlertReviewService,
} from './safety-alert-review.service.js';
import {
  SafetyAlertQueryService,
  type SafetyAlertDetectionSummary,
} from './safety-alert-query.service.js';

function reviewResponse(review: SafetyAlertReviewEntity) {
  return {
    id: review.id,
    alertId: review.alertId,
    siteId: review.siteId,
    actorUserId: review.actorUserId,
    fromStatus: review.fromStatus,
    toStatus: review.toStatus,
    reason: review.reason,
    alertRevision: review.alertRevision,
    createdAt: review.createdAt,
  };
}

function detectionResponse(detection: SafetyAlertDetectionSummary) {
  return {
    eventId: detection.eventId,
    cameraExternalId: detection.cameraExternalId,
    capturedAt: detection.capturedAt,
    processingStatus: detection.processingStatus,
    evidence: detection.evidence,
  };
}

@ApiTags('safety-alerts')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, SafetyAlertAccessGuard)
@Controller('sites/:siteId/safety-alerts')
export class SafetyAlertsController {
  constructor(
    private readonly alerts: SafetyAlertQueryService,
    private readonly reviews: SafetyAlertReviewService,
    private readonly evidence: SafetyAlertEvidenceService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SafetyAlertPageResponseDto })
  async list(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.alerts.list(siteId, value.offset, value.limit, { status, type });
    return { items: result.items.map(alertResponse), total: result.total };
  }

  @Get(':alertId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: SafetyAlertDetailResponseDto })
  async get(@Param('siteId') siteId: string, @Param('alertId') alertId: string) {
    const result = await this.alerts.get(siteId, alertId);
    return {
      ...alertResponse(result.alert),
      detections: result.detections.map(detectionResponse),
      detectionsTotal: result.detectionsTotal,
      reviews: result.reviews.map(reviewResponse),
      reviewsTotal: result.reviewsTotal,
    };
  }

  @Get(':alertId/detections/:eventId/evidence/:evidenceIndex')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg')
  @ApiOkResponse({
    description: 'Exact JPEG frame associated with the selected alert detection.',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  async getEvidence(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Param('evidenceIndex') evidenceIndex: string,
  ) {
    const result = await this.evidence.read(siteId, alertId, eventId, evidenceIndex);
    return new StreamableFile(result.bytes, {
      type: 'image/jpeg',
      disposition: `inline; filename="${result.fileName}"`,
      length: result.bytes.length,
    });
  }

  @Post(':alertId/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ type: SafetyAlertReviewMutationResponseDto })
  @ApiConflictResponse({ type: ErrorResponseDto })
  async review(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Body() input: ReviewSafetyAlertCommand,
  ) {
    const result = await this.reviews.review(siteId, alertId, request.user!.id, input);
    return {
      alert: alertResponse(result.alert),
      review: reviewResponse(result.review),
      replayed: result.replayed,
    };
  }
}
