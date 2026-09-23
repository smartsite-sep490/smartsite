import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ServiceAuthGuard } from '../auth/service-auth.guard.js';
import { CameraStatus, ZoneRestrictionPolicy, ZoneType } from '../../database/entities/enums.js';
import { CatalogService } from './catalog.service.js';

class CreateSiteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

class CreateZoneDto {
  @IsUUID()
  siteId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsEnum(ZoneType)
  type!: ZoneType;

  @IsEnum(ZoneRestrictionPolicy)
  restrictionPolicy!: ZoneRestrictionPolicy;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredPpe?: string[];
}

class CreateCameraDto {
  @IsUUID()
  siteId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsEnum(CameraStatus)
  status?: CameraStatus;
}

class CreateRegionDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  cameraId!: string;

  @IsUUID()
  zoneId!: string;

  @IsArray()
  @ArrayMinSize(3)
  coordinates!: number[][];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog')
@UseGuards(ServiceAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Post('sites')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a site, or return the existing site with the same code' })
  @ApiOkResponse({ description: 'Site record' })
  createSite(@Body() body: CreateSiteDto) {
    return this.catalog.createSite(body);
  }

  @Post('zones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a zone, or return the existing zone with the same site and code' })
  createZone(@Body() body: CreateZoneDto) {
    return this.catalog.createZone(body);
  }

  @Post('cameras')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a camera, or return the existing camera with the same external id' })
  createCamera(@Body() body: CreateCameraDto) {
    return this.catalog.createCamera(body);
  }

  @Post('observation-regions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create an observation region for one active camera and zone' })
  createRegion(@Body() body: CreateRegionDto) {
    return this.catalog.createRegion(body);
  }
}
