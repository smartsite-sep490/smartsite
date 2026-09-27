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
import {
  CameraPageResponseDto,
  CameraResponseDto,
  RegionMutationResponseDto,
  RegionPageResponseDto,
  RegionResponseDto,
} from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import type { CameraEntity } from '../../database/entities/camera.entity.js';
import type { CameraObservationRegionEntity } from '../../database/entities/camera-observation-region.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CameraConfigurationService,
  CreateCameraCommand,
  CreateRegionCommand,
  RenameCameraCommand,
  SetCameraStatusCommand,
  SetRegionActiveCommand,
  UpdateRegionPolygonCommand,
} from './camera-configuration.service.js';

function cameraResponse(camera: CameraEntity) {
  return {
    id: camera.id,
    siteId: camera.siteId,
    externalId: camera.externalId,
    code: camera.code,
    name: camera.name,
    status: camera.status,
    configurationVersion: camera.configurationVersion,
    createdAt: camera.createdAt,
  };
}

function regionResponse(region: CameraObservationRegionEntity) {
  return {
    id: region.id,
    cameraId: region.cameraId,
    zoneId: region.zoneId,
    polygon: region.polygon,
    coordinateSpace: region.coordinateSpace,
    version: region.version,
    isActive: region.isActive,
    createdAt: region.createdAt,
  };
}

@ApiTags('cameras')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('sites/:siteId/cameras')
export class CamerasController {
  private readonly logger = new Logger(CamerasController.name);
  constructor(private readonly cameras: CameraConfigurationService) {}

  @Post()
  @ApiCreatedResponse({ type: CameraResponseDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateCameraCommand,
  ) {
    const camera = await this.cameras.create(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'camera.create',
      siteId,
      resourceId: camera.id,
    });
    return cameraResponse(camera);
  }

  @Get()
  @ApiOkResponse({ type: CameraPageResponseDto })
  async list(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.cameras.list(siteId, value.offset, value.limit);
    return { items: result.items.map(cameraResponse), total: result.total };
  }

  @Get(':cameraId')
  @ApiOkResponse({ type: CameraResponseDto })
  async get(@Param('siteId') siteId: string, @Param('cameraId') cameraId: string) {
    return cameraResponse(await this.cameras.get(siteId, cameraId));
  }

  @Patch(':cameraId')
  @ApiOkResponse({ type: CameraResponseDto })
  async rename(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() input: RenameCameraCommand,
  ) {
    const camera = await this.cameras.rename(siteId, cameraId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'camera.rename',
      siteId,
      resourceId: camera.id,
    });
    return cameraResponse(camera);
  }

  @Patch(':cameraId/status')
  @ApiOkResponse({ type: CameraResponseDto })
  async setStatus(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() input: SetCameraStatusCommand,
  ) {
    const camera = await this.cameras.setStatus(siteId, cameraId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'camera.status',
      siteId,
      resourceId: camera.id,
      revision: camera.configurationVersion,
    });
    return cameraResponse(camera);
  }

  @Post(':cameraId/regions')
  @ApiCreatedResponse({ type: RegionMutationResponseDto })
  async createRegion(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Body() input: CreateRegionCommand,
  ) {
    const region = await this.cameras.createRegion(siteId, cameraId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'region.create',
      siteId,
      resourceId: region.id,
      revision: region.configurationVersion,
    });
    return { region: regionResponse(region), configurationVersion: region.configurationVersion };
  }

  @Get(':cameraId/regions')
  @ApiOkResponse({ type: RegionPageResponseDto })
  async listRegions(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.cameras.listRegions(siteId, cameraId, value.offset, value.limit);
    return { items: result.items.map(regionResponse), total: result.total };
  }

  @Get(':cameraId/regions/:regionId')
  @ApiOkResponse({ type: RegionResponseDto })
  async getRegion(
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
  ) {
    return regionResponse(await this.cameras.getRegion(siteId, cameraId, regionId));
  }

  @Patch(':cameraId/regions/:regionId/polygon')
  @ApiOkResponse({ type: RegionMutationResponseDto })
  async updatePolygon(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
    @Body() input: UpdateRegionPolygonCommand,
  ) {
    const region = await this.cameras.updatePolygon(siteId, cameraId, regionId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'region.polygon',
      siteId,
      resourceId: region.id,
      revision: region.configurationVersion,
    });
    return { region: regionResponse(region), configurationVersion: region.configurationVersion };
  }

  @Patch(':cameraId/regions/:regionId/status')
  @ApiOkResponse({ type: RegionMutationResponseDto })
  async setRegionActive(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('cameraId') cameraId: string,
    @Param('regionId') regionId: string,
    @Body() input: SetRegionActiveCommand,
  ) {
    const region = await this.cameras.setRegionActive(siteId, cameraId, regionId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'region.status',
      siteId,
      resourceId: region.id,
      revision: region.configurationVersion,
    });
    return { region: regionResponse(region), configurationVersion: region.configurationVersion };
  }
}
