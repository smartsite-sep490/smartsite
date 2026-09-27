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
import { SitePageResponseDto, SiteResponseDto } from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import type { SiteEntity } from '../../database/entities/site.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateSiteCommand,
  RenameSiteCommand,
  SiteConfigurationService,
} from './site-configuration.service.js';

function siteResponse(site: SiteEntity) {
  return { id: site.id, code: site.code, name: site.name, createdAt: site.createdAt };
}

@ApiTags('sites')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites')
export class SitesController {
  private readonly logger = new Logger(SitesController.name);
  constructor(private readonly sites: SiteConfigurationService) {}

  @Post()
  @ApiCreatedResponse({ type: SiteResponseDto })
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateSiteCommand) {
    const site = await this.sites.create(input);
    this.logger.log({ actorId: request.user!.id, action: 'site.create', resourceId: site.id });
    return siteResponse(site);
  }

  @Get()
  @ApiOkResponse({ type: SitePageResponseDto })
  async list(@Query('offset') offset?: string, @Query('limit') limit?: string) {
    const value = pagination(offset, limit);
    const result = await this.sites.list(value.offset, value.limit);
    return { items: result.items.map(siteResponse), total: result.total };
  }

  @Get(':siteId')
  @ApiOkResponse({ type: SiteResponseDto })
  async get(@Param('siteId') siteId: string) {
    return siteResponse(await this.sites.get(siteId));
  }

  @Patch(':siteId')
  @ApiOkResponse({ type: SiteResponseDto })
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: RenameSiteCommand,
  ) {
    const site = await this.sites.rename(siteId, input);
    this.logger.log({ actorId: request.user!.id, action: 'site.rename', resourceId: site.id });
    return siteResponse(site);
  }
}
