import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
} from '../../../common/http/management-response.dto.js';
import { pagination } from '../../../common/http/pagination.js';
import type { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { AdminGuard, UserAuthGuard } from '../../auth/user-auth.guard.js';
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
    createdAt: alert.createdAt,
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
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId/safety-alerts')
export class SafetyAlertsController {
  constructor(private readonly alerts: SafetyAlertQueryService) {}

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
    };
  }
}
