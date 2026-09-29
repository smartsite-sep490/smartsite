import {
  Body,
  Controller,
  Get,
  HttpStatus,
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
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { SiteEntity } from '../../database/entities/site.entity.js';
import { UserRole } from '../../database/entities/user.entity.js';
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
@UseGuards(UserAuthGuard)
@Controller('sites')
export class SitesController {
  private readonly logger = new Logger(SitesController.name);
  constructor(private readonly sites: SiteConfigurationService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({ type: SiteResponseDto })
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateSiteCommand) {
    const site = await this.sites.create(input);
    this.logger.log({ actorId: request.user!.id, action: 'site.create', resourceId: site.id });
    return siteResponse(site);
  }

  @Get()
  @ApiOkResponse({ type: SitePageResponseDto })
  async list(
    @Req() request: AuthenticatedRequest,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const user = request.user!;
    this.assertPasswordChanged(user.mustChangePassword);
    const value = pagination(offset, limit);
    const isGlobalAdmin = user.roleAssignments.some(
      ({ role, siteId }) => role === UserRole.ADMIN && siteId === null,
    );
    const allowedSiteIds = isGlobalAdmin
      ? undefined
      : user.roleAssignments.flatMap(({ siteId }) => (siteId === null ? [] : [siteId]));
    const result = await this.sites.list(value.offset, value.limit, allowedSiteIds);
    return { items: result.items.map(siteResponse), total: result.total };
  }

  @Get(':siteId')
  @ApiOkResponse({ type: SiteResponseDto })
  async get(@Req() request: AuthenticatedRequest, @Param('siteId') siteId: string) {
    const user = request.user!;
    this.assertPasswordChanged(user.mustChangePassword);
    const normalizedSiteId = siteId.toLowerCase();
    const allowed = user.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === UserRole.ADMIN && assignedSiteId === null) ||
        (assignedSiteId !== null && assignedSiteId.toLowerCase() === normalizedSiteId),
    );
    if (!allowed) this.forbidden();
    return siteResponse(await this.sites.get(siteId));
  }

  @Patch(':siteId')
  @UseGuards(AdminGuard)
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

  private assertPasswordChanged(mustChangePassword: boolean): void {
    if (mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
  }

  private forbidden(): never {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }
}
