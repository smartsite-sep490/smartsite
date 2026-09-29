import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
import type { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import type { SafetyAlertReviewEntity } from '../../../database/entities/safety-alert-review.entity.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyAlertAccessGuard } from './safety-alert-access.guard.js';
import {
  ReviewSafetyAlertCommand,
  SafetyAlertReviewService,
} from './safety-alert-review.service.js';
import {
  SafetyAlertQueryService,
  type SafetyAlertDetectionSummary,
} from './safety-alert-query.service.js';

function alertResponse(alert: SafetyAlertEntity) {
  return {
    id: alert.id,
    siteId: alert.siteId,
    zoneId: alert.zoneId,
    candidateWorkerId: alert.candidateWorkerId,
    alertType: alert.alertType,
    candidateSubtype: alert.candidateSubtype,
    status: alert.status,
    firstDetectedAt: alert.firstDetectedAt,
    lastDetectedAt: alert.lastDetectedAt,
    detectionCount: alert.detectionCount,
    revision: alert.revision,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}

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
