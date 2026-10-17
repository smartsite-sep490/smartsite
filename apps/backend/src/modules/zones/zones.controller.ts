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
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ZonePageResponseDto, ZoneResponseDto } from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import type { ZoneEntity } from '../../database/entities/zone.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import { SiteManagerGuard } from '../auth/site-manager.guard.js';
import { SiteConfigurationGuard } from '../auth/site-configuration.guard.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateZoneCommand,
  RenameZoneCommand,
  UpdateZonePolicyCommand,
  ZoneConfigurationService,
} from './zone-configuration.service.js';

function zoneResponse(zone: ZoneEntity) {
  return {
    id: zone.id,
    siteId: zone.siteId,
    code: zone.code,
    name: zone.name,
    type: zone.type,
    restrictionPolicy: zone.restrictionPolicy,
    requiredPpe: zone.requiredPpe,
    configurationLocked: zone.configurationLocked,
    createdAt: zone.createdAt,
  };
}

@ApiTags('zones')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, SiteConfigurationGuard)
@Controller('sites/:siteId/zones')
export class ZonesController {
  private readonly logger = new Logger(ZonesController.name);
  constructor(
    private readonly zones: ZoneConfigurationService,
    private readonly auth: UserAuthGuard,
  ) {}

  @Post()
  @UseGuards(SiteManagerGuard)
  @ApiCreatedResponse({ type: ZoneResponseDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateZoneCommand,
  ) {
    const zone = await this.zones.create(
      siteId,
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'zone.create',
      siteId,
      resourceId: zone.id,
    });
    return zoneResponse(zone);
  }

  @Get()
  @ApiOkResponse({ type: ZonePageResponseDto })
  async list(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.zones.list(siteId, value.offset, value.limit);
    return { items: result.items.map(zoneResponse), total: result.total };
  }

  @Get(':zoneId')
  @ApiOkResponse({ type: ZoneResponseDto })
  async get(@Param('siteId') siteId: string, @Param('zoneId') zoneId: string) {
    return zoneResponse(await this.zones.get(siteId, zoneId));
  }

  @Patch(':zoneId')
  @UseGuards(SiteManagerGuard)
  @ApiOkResponse({ type: ZoneResponseDto })
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('zoneId') zoneId: string,
    @Body() input: RenameZoneCommand,
  ) {
    const zone = await this.zones.rename(
      siteId,
      zoneId,
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'zone.rename',
      siteId,
      resourceId: zone.id,
    });
    return zoneResponse(zone);
  }

  @Patch(':zoneId/policy')
  @UseGuards(SiteManagerGuard)
  @ApiOkResponse({ type: ZoneResponseDto })
  async updatePolicy(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('zoneId') zoneId: string,
    @Body() input: UpdateZonePolicyCommand,
  ) {
    const zone = await this.zones.updatePolicy(
      siteId,
      zoneId,
      input,
      configurationCommandContext(request, this.auth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'zone.policy',
      siteId,
      resourceId: zone.id,
    });
    return zoneResponse(zone);
  }
}
