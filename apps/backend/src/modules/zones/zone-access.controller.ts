import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import {
  ZoneAccessGrantPageResponseDto,
  ZoneAccessGrantResponseDto,
  ZoneEntryDecisionPageResponseDto,
} from '../../common/http/management-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import type { ZoneAccessGrantEntity } from '../../database/entities/zone-access-grant.entity.js';
import type { ZoneEntryDecisionEntity } from '../../database/entities/zone-entry-decision.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateZoneAccessGrantCommand,
  ZoneAccessManagementService,
} from './zone-access-management.service.js';

function grantResponse(grant: ZoneAccessGrantEntity) {
  return {
    id: grant.id,
    siteId: grant.siteId,
    zoneId: grant.zoneId,
    workerId: grant.workerId,
    effect: grant.effect,
    validFrom: grant.validFrom,
    validUntil: grant.validUntil,
    revokedAt: grant.revokedAt,
    createdAt: grant.createdAt,
  };
}

function decisionResponse(decision: ZoneEntryDecisionEntity) {
  return {
    id: decision.id,
    eventId: decision.eventId,
    siteId: decision.siteId,
    zoneId: decision.zoneId,
    workerId: decision.workerId,
    candidateWorkerId: decision.candidateWorkerId,
    trackId: decision.trackId,
    status: decision.status,
    reasonCode: decision.reasonCode,
    evaluatedAt: decision.evaluatedAt,
    createdAt: decision.createdAt,
  };
}

const commonResponses = {
  badRequest: ApiBadRequestResponse({ type: ErrorResponseDto }),
  unauthorized: ApiUnauthorizedResponse({ type: ErrorResponseDto }),
  forbidden: ApiForbiddenResponse({ type: ErrorResponseDto }),
  notFound: ApiNotFoundResponse({ type: ErrorResponseDto }),
  tooManyRequests: ApiTooManyRequestsResponse({ type: ErrorResponseDto }),
  unavailable: ApiServiceUnavailableResponse({ type: ErrorResponseDto }),
};

@ApiTags('zone-access')
@ApiBearerAuth('user-token')
@commonResponses.badRequest
@commonResponses.unauthorized
@commonResponses.forbidden
@commonResponses.notFound
@commonResponses.tooManyRequests
@commonResponses.unavailable
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId/zones/:zoneId/access-grants')
export class ZoneAccessController {
  private readonly logger = new Logger(ZoneAccessController.name);

  constructor(private readonly access: ZoneAccessManagementService) {}

  @Post()
  @ApiCreatedResponse({ type: ZoneAccessGrantResponseDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('zoneId') zoneId: string,
    @Body() input: CreateZoneAccessGrantCommand,
  ) {
    const grant = await this.access.createGrant(siteId, zoneId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'zone-access.create',
      siteId,
      resourceId: grant.id,
    });
    return grantResponse(grant);
  }

  @Get()
  @ApiOkResponse({ type: ZoneAccessGrantPageResponseDto })
  async list(
    @Param('siteId') siteId: string,
    @Param('zoneId') zoneId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.access.listGrants(siteId, zoneId, value.offset, value.limit);
    return { items: result.items.map(grantResponse), total: result.total };
  }

  @Patch(':grantId/revoke')
  @ApiOkResponse({ type: ZoneAccessGrantResponseDto })
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('zoneId') zoneId: string,
    @Param('grantId') grantId: string,
  ) {
    const grant = await this.access.revokeGrant(siteId, zoneId, grantId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'zone-access.revoke',
      siteId,
      resourceId: grant.id,
    });
    return grantResponse(grant);
  }
}

@ApiTags('zone-entry-decisions')
@ApiBearerAuth('user-token')
@commonResponses.badRequest
@commonResponses.unauthorized
@commonResponses.forbidden
@commonResponses.notFound
@commonResponses.tooManyRequests
@commonResponses.unavailable
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId/zone-entry-decisions')
export class ZoneEntryDecisionsController {
  constructor(private readonly access: ZoneAccessManagementService) {}

  @Get()
  @ApiOkResponse({ type: ZoneEntryDecisionPageResponseDto })
  async list(
    @Param('siteId') siteId: string,
    @Query('zoneId') zoneId?: string,
    @Query('status') status?: 'ALLOWED' | 'DENIED' | 'UNAVAILABLE',
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.access.listDecisions(siteId, {
      zoneId,
      status,
      offset: value.offset,
      limit: value.limit,
    });
    return { items: result.items.map(decisionResponse), total: result.total };
  }
}
