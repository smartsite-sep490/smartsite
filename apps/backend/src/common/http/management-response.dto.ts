import { ApiProperty } from '@nestjs/swagger';
import {
  AlertStatus,
  AlertType,
  CameraStatus,
  EventProcessingStatus,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../database/entities/enums.js';
import { UserRole } from '../../database/entities/user.entity.js';

export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() username!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: () => [RoleAssignmentResponseDto] })
  roleAssignments!: RoleAssignmentResponseDto[];
  @ApiProperty() isActive!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
}

export class RoleAssignmentResponseDto {
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ format: 'uuid', nullable: true }) siteId!: string | null;
}

export class LoginResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType!: 'Bearer';
  @ApiProperty({ format: 'date-time' }) accessTokenExpiresAt!: string;
  @ApiProperty({ required: false }) refreshToken?: string;
  @ApiProperty({ format: 'date-time' }) refreshTokenExpiresAt!: string;
  @ApiProperty({ type: AccountResponseDto }) user!: AccountResponseDto;
}

export class SiteResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CameraResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty() externalId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: CameraStatus }) status!: CameraStatus;
  @ApiProperty() configurationVersion!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ZoneResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ZoneType }) type!: ZoneType;
  @ApiProperty({ enum: ZoneRestrictionPolicy }) restrictionPolicy!: ZoneRestrictionPolicy;
  @ApiProperty({ type: [String] }) requiredPpe!: string[];
  @ApiProperty() configurationLocked!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class RegionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) cameraId!: string;
  @ApiProperty({ format: 'uuid' }) zoneId!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) polygon!: unknown;
  @ApiProperty({ enum: ['NORMALIZED_0_1'] }) coordinateSpace!: 'NORMALIZED_0_1';
  @ApiProperty() version!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class RegionMutationResponseDto {
  @ApiProperty({ type: RegionResponseDto }) region!: RegionResponseDto;
  @ApiProperty() configurationVersion!: number;
}

export class SafetyAlertResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) siteId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) zoneId!: string | null;
  @ApiProperty({ nullable: true }) candidateWorkerId!: string | null;
  @ApiProperty({ enum: AlertType }) alertType!: AlertType;
  @ApiProperty() candidateSubtype!: string;
  @ApiProperty({ enum: AlertStatus }) status!: AlertStatus;
  @ApiProperty({ format: 'date-time' }) firstDetectedAt!: string;
  @ApiProperty({ format: 'date-time' }) lastDetectedAt!: string;
  @ApiProperty() detectionCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class SafetyAlertDetectionResponseDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() cameraExternalId!: string;
  @ApiProperty({ format: 'date-time' }) capturedAt!: string;
  @ApiProperty({ enum: EventProcessingStatus }) processingStatus!: EventProcessingStatus;
}

export class SafetyAlertDetailResponseDto extends SafetyAlertResponseDto {
  @ApiProperty({ type: [SafetyAlertDetectionResponseDto] })
  detections!: SafetyAlertDetectionResponseDto[];
  @ApiProperty() detectionsTotal!: number;
}

export class SafetyAlertPageResponseDto {
  @ApiProperty({ type: [SafetyAlertResponseDto] }) items!: SafetyAlertResponseDto[];
  @ApiProperty() total!: number;
}

export class AccountPageResponseDto {
  @ApiProperty({ type: [AccountResponseDto] }) items!: AccountResponseDto[];
  @ApiProperty() total!: number;
}

export class SitePageResponseDto {
  @ApiProperty({ type: [SiteResponseDto] }) items!: SiteResponseDto[];
  @ApiProperty() total!: number;
}

export class CameraPageResponseDto {
  @ApiProperty({ type: [CameraResponseDto] }) items!: CameraResponseDto[];
  @ApiProperty() total!: number;
}

export class ZonePageResponseDto {
  @ApiProperty({ type: [ZoneResponseDto] }) items!: ZoneResponseDto[];
  @ApiProperty() total!: number;
}

export class RegionPageResponseDto {
  @ApiProperty({ type: [RegionResponseDto] }) items!: RegionResponseDto[];
  @ApiProperty() total!: number;
}
