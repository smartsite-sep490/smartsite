import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import {
  SafetyAlertAccessGuard,
  assertSafetySiteAccess,
} from '../alerts/safety-alert-access.guard.js';
import { Mf06RequestStatusQueryService } from './mf06-request-status-query.service.js';
import { invalid, uuid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';

const safeAssessmentSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'requestId',
    'siteId',
    'eventId',
    'cameraId',
    'zoneId',
    'capturedAt',
    'requestedAt',
    'purpose',
    'jobStatus',
    'attemptCount',
    'deadlineAt',
    'deadlinePassed',
    'assessmentId',
  ],
  properties: {
    requestId: { type: 'string' as const, format: 'uuid' },
    siteId: { type: 'string' as const, format: 'uuid' },
    eventId: { type: 'string' as const, format: 'uuid' },
    cameraId: { type: 'string' as const, format: 'uuid' },
    zoneId: { type: 'string' as const, format: 'uuid' },
    capturedAt: { type: 'string' as const, format: 'date-time' },
    requestedAt: { type: 'string' as const, format: 'date-time' },
    purpose: {
      type: 'string' as const,
      enum: ['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW'],
    },
    jobStatus: {
      type: 'string' as const,
      enum: ['NOT_QUEUED', 'PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
    },
    attemptCount: { type: 'integer' as const, nullable: true, minimum: 0, maximum: 2147483647 },
    deadlineAt: { type: 'string' as const, format: 'date-time', nullable: true },
    deadlinePassed: { type: 'boolean' as const },
    assessmentId: { type: 'string' as const, format: 'uuid', nullable: true },
  },
  description:
    'Persisted request/job state; CLAIMED does not prove a live worker and deadlinePassed does not change the stored status. Not Worker identity, permission or an alert.',
};
@Controller('sites/:siteId/mf06-assessment-requests')
@UseGuards(UserAuthGuard, SafetyAlertAccessGuard)
@ApiTags('mf06-assessment-requests')
@ApiBearerAuth('user-token')
@ApiParam({ name: 'siteId', type: String, format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
export class Mf06RequestStatusesController {
  constructor(
    private readonly query: Mf06RequestStatusQueryService,
    private readonly auth: UserAuthGuard,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({
    description: 'Safe persisted request statuses; excludes synthetic-test assessments',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'total', 'offset', 'limit'],
      properties: {
        items: { type: 'array', items: safeAssessmentSchema },
        total: { type: 'integer', minimum: 0 },
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    schema: { type: 'integer', minimum: 0, default: 0 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  async list(
    @Param('siteId') siteId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (
      Object.keys(query).some((key) => !['offset', 'limit'].includes(key)) ||
      ['offset', 'limit'].some((key) => query[key] !== undefined && typeof query[key] !== 'string')
    )
      invalid('Invalid request status query');
    const scope = uuid(siteId).toLowerCase(),
      paging = pagination(query.offset as string | undefined, query.limit as string | undefined);
    const result = await this.query.list(scope, paging.offset, paging.limit);
    await this.auth.authenticateRequest(request);
    assertSafetySiteAccess(request.user, scope);
    return result;
  }
  @Get(':requestId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({
    description: 'Safe persisted request status in the original Site',
    schema: safeAssessmentSchema,
  })
  @ApiParam({ name: 'requestId', type: String, format: 'uuid' })
  async get(
    @Param('siteId') siteId: string,
    @Param('requestId') requestId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (Object.keys(query).length) invalid('Invalid request status query');
    const scope = uuid(siteId).toLowerCase(),
      result = await this.query.get(scope, uuid(requestId).toLowerCase());
    await this.auth.authenticateRequest(request);
    assertSafetySiteAccess(request.user, scope);
    return result;
  }
}
