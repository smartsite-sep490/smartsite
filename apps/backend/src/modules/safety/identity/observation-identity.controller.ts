import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { invalid, uuid } from '../../../common/configuration/commands.js';
import { ErrorResponseDto } from '../../../common/http/error-response.dto.js';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { ObservationIdentityAccessGuard } from './observation-identity-access.guard.js';
import { parseObservationIdentityCommand } from './observation-identity-command.js';
import { ObservationIdentityContextService } from './observation-identity-context.service.js';
import { ObservationIdentityResolutionService } from './observation-identity-resolution.service.js';
import {
  identityContextResponse,
  identityDecisionPageResponse,
  identityMutationResponse,
  ObservationIdentityContextDto,
  ObservationIdentityDecisionPageDto,
  ObservationIdentityMutationDto,
  ObservationIdentityWorkerPageDto,
} from './observation-identity-response.dto.js';

const commonCommandProperties = {
  commandId: { type: 'string', format: 'uuid' },
  expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 },
  expectedEventHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  reason: { type: 'string', minLength: 5, maxLength: 1000 },
} as const;
const commonCommandKeys = Object.keys(commonCommandProperties);
function personIndex(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > 255)
    invalid('Invalid observation PERSON index');
  return Number(value);
}
function queryPage(query: Record<string, unknown>, paginated: boolean) {
  if (
    Object.keys(query).some((k) => !paginated || !['offset', 'limit'].includes(k)) ||
    (query.offset !== undefined && typeof query.offset !== 'string') ||
    (query.limit !== undefined && typeof query.limit !== 'string')
  )
    invalid('Invalid identity query');
  return pagination(query.offset as string | undefined, query.limit as string | undefined);
}
function scope(siteId: string, alertId: string, eventId: string): [string, string, string] {
  return [uuid(siteId).toLowerCase(), uuid(alertId).toLowerCase(), uuid(eventId).toLowerCase()];
}

/** Not registered in SafetyModule until Workforce supplies the approved reader/export. */
@ApiTags('observation-identity-review')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, ObservationIdentityAccessGuard)
@Controller('sites/:siteId/safety-alerts/:alertId/detections/:eventId/identity-subjects')
export class ObservationIdentityController {
  constructor(
    private readonly context: ObservationIdentityContextService,
    private readonly resolutions: ObservationIdentityResolutionService,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: ObservationIdentityContextDto })
  async get(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Query() query: Record<string, unknown>,
  ) {
    queryPage(query, false);
    return identityContextResponse(await this.context.get(...scope(siteId, alertId, eventId)));
  }

  @Get('workers')
  @Header('Cache-Control', 'private, no-store')
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: ObservationIdentityWorkerPageDto })
  async workers(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const paging = queryPage(query, true);
    return this.context.listWorkers(
      ...scope(siteId, alertId, eventId),
      paging.offset,
      paging.limit,
    );
  }

  @Get(':personObservationIndex/decisions')
  @Header('Cache-Control', 'private, no-store')
  @ApiQuery({ name: 'offset', required: false, type: Number, minimum: 0 })
  @ApiQuery({ name: 'limit', required: false, type: Number, minimum: 1, maximum: 100 })
  @ApiOkResponse({ type: ObservationIdentityDecisionPageDto })
  async history(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Param('personObservationIndex') index: string,
    @Query() query: Record<string, unknown>,
  ) {
    const paging = queryPage(query, true),
      keys = scope(siteId, alertId, eventId),
      selected = personIndex(index);
    const result = await this.resolutions.listDecisions(
      ...keys,
      selected,
      paging.offset,
      paging.limit,
    );
    const records = result.items.length ? await this.resolutions.readContextRecords(...keys) : null;
    const ref =
      records?.heads.find((r) => r.head.personObservationIndex === selected)?.head.subjectRef ??
      null;
    return identityDecisionPageResponse(result, ref);
  }

  @Post(':personObservationIndex/decisions')
  @Header('Cache-Control', 'private, no-store')
  @ApiCreatedResponse({ type: ObservationIdentityMutationDto })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: [
            ...commonCommandKeys,
            'action',
            'workerId',
            'evidenceIndex',
            'expectedEvidenceSha256',
          ],
          properties: {
            ...commonCommandProperties,
            action: { type: 'string', enum: ['RESOLVE'] },
            workerId: { type: 'string', format: 'uuid' },
            evidenceIndex: { type: 'integer', minimum: 0, maximum: 255 },
            expectedEvidenceSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: [...commonCommandKeys, 'action'],
          properties: { ...commonCommandProperties, action: { type: 'string', enum: ['CLEAR'] } },
        },
      ],
    },
  })
  async decide(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Param('personObservationIndex') index: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    queryPage(query, false);
    const command = parseObservationIdentityCommand(body);
    return identityMutationResponse(
      await this.resolutions.decide(
        ...scope(siteId, alertId, eventId),
        personIndex(index),
        request.user!.id,
        command,
      ),
    );
  }
}
