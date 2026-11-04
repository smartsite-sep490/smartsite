import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiProduces,
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
import { Mf06AssessmentQueryService } from './mf06-assessment-query.service.js';
import { invalid, uuid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';

const safeAssessmentSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: [
    'assessmentId',
    'requestId',
    'siteId',
    'eventId',
    'cameraId',
    'zoneId',
    'capturedAt',
    'assessedAt',
    'purpose',
    'outcome',
    'reasonCode',
    'evaluatorVersion',
    'provenance',
  ],
  properties: {
    assessmentId: { type: 'string' as const, format: 'uuid' },
    requestId: { type: 'string' as const, format: 'uuid' },
    siteId: { type: 'string' as const, format: 'uuid' },
    eventId: { type: 'string' as const, format: 'uuid' },
    cameraId: { type: 'string' as const, format: 'uuid' },
    zoneId: { type: 'string' as const, format: 'uuid' },
    capturedAt: { type: 'string' as const, format: 'date-time' },
    assessedAt: { type: 'string' as const, format: 'date-time' },
    purpose: {
      type: 'string' as const,
      enum: ['INITIAL_OBSERVATION_ASSESSMENT', 'RETROSPECTIVE_REVIEW'],
    },
    outcome: { type: 'string' as const, enum: ['ALLOWED', 'DENIED', 'UNAVAILABLE'] },
    reasonCode: {
      type: 'string' as const,
      enum: [
        'INVALID_BINDING',
        'IDENTITY_UNAVAILABLE',
        'MEDIA_UNAVAILABLE',
        'PROFILE_REVOKED',
        'AUTHORITY_UNAVAILABLE',
        'SERVICE_DISABLED',
        'ABORTED',
        'POLICY_NONE',
        'POLICY_PROHIBITED',
        'AUTHORIZED',
        'UNAUTHORIZED',
      ],
    },
    evaluatorVersion: { type: 'string' as const, minLength: 1, maxLength: 128 },
    provenance: { type: 'string' as const, enum: ['UNAVAILABLE', 'TRUSTED_SERVICE'] },
    frameDelivery: {
      type: 'object' as const,
      additionalProperties: false,
      required: ['frameId', 'sequenceNumber', 'partCount', 'receivedParts', 'status'],
      properties: {
        frameId: { type: 'string' as const, format: 'uuid' },
        sequenceNumber: {
          type: 'string' as const,
          pattern: '^(0|[1-9][0-9]{0,19})$',
          description: 'Exact decimal uint64, at most18446744073709551615; never a JSON number.',
        },
        partCount: { type: 'integer' as const, minimum: 1, maximum: 1024 },
        receivedParts: { type: 'integer' as const, minimum: 1, maximum: 1024 },
        status: { type: 'string' as const, enum: ['PARTIAL', 'COMPLETE'] },
      },
      description:
        'Distinct persisted parts for one camera/session/frame in the read snapshot. COMPLETE requires receivedParts=partCount; PARTIAL requires fewer. Missing metadata never means complete. Not evaluation, media, identity or authorization completeness.',
    },
  },
  description:
    'Recorded assessment at the original scope and time; not current permission, Worker identity or a persisted alert.',
};

@Controller('sites/:siteId/mf06-assessments')
@UseGuards(UserAuthGuard, SafetyAlertAccessGuard)
@ApiTags('mf06-assessments')
@ApiBearerAuth('user-token')
@ApiParam({ name: 'siteId', type: String, format: 'uuid' })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
export class Mf06AssessmentsController {
  constructor(
    private readonly query: Mf06AssessmentQueryService,
    private readonly auth: UserAuthGuard,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({
    description: 'Safe recorded assessments; excludes synthetic-test provenance',
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
      invalid('Invalid assessment query');
    const scope = uuid(siteId).toLowerCase(),
      paging = pagination(query.offset as string | undefined, query.limit as string | undefined);
    const result = await this.query.list(scope, paging.offset, paging.limit);
    await this.auth.authenticateRequest(request);
    assertSafetySiteAccess(request.user, scope, 'GET');
    return result;
  }
  @Get(':assessmentId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({
    description: 'Safe recorded assessment in the requested original Site',
    schema: safeAssessmentSchema,
  })
  @ApiParam({ name: 'assessmentId', type: String, format: 'uuid' })
  async get(
    @Param('siteId') siteId: string,
    @Param('assessmentId') assessmentId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (Object.keys(query).length) invalid('Invalid assessment query');
    const scope = uuid(siteId).toLowerCase(),
      result = await this.query.get(scope, uuid(assessmentId).toLowerCase());
    await this.auth.authenticateRequest(request);
    assertSafetySiteAccess(request.user, scope, 'GET');
    return result;
  }

  @Get(':assessmentId/frame')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg')
  @ApiParam({ name: 'assessmentId', type: String, format: 'uuid' })
  @ApiQuery({ name: 'requestId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiQuery({ name: 'eventId', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({
    description: 'Observation frame bound to this recorded assessment; not identity proof.',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  async getFrame(
    @Param('siteId') siteId: string,
    @Param('assessmentId') assessmentId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (
      Object.keys(query).length !== 2 ||
      !Object.hasOwn(query, 'requestId') ||
      !Object.hasOwn(query, 'eventId')
    )
      invalid('Invalid assessment frame query');
    const scope = uuid(siteId).toLowerCase();
    const result = await this.query.readFrame(scope, uuid(assessmentId).toLowerCase(), {
      requestId: uuid(query.requestId as string).toLowerCase(),
      eventId: uuid(query.eventId as string).toLowerCase(),
    });
    await this.auth.authenticateRequest(request);
    assertSafetySiteAccess(request.user, scope, 'GET');
    return new StreamableFile(result.bytes, {
      type: 'image/jpeg',
      disposition: `inline; filename="${result.fileName}"`,
      length: result.bytes.length,
    });
  }
}
