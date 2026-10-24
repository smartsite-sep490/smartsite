import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Existing retained-main public DTOs; actor and journal IDs are server-only. */
export class CreateWorkerSiteZoneAssignmentCommand {
  @IsUUID() siteId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64) @IsUUID('4', { each: true }) zoneIds!: string[];
  @IsDateString({ strict: true }) validFrom!: string;
  @ValidateIf((_object, value) => value !== null) @IsDateString({ strict: true }) validUntil!:
    string | null;
}
export class SiteManagerDecisionCommand {
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional() @IsString() @MaxLength(1000) reviewNote?: string;
  @IsBoolean() approve!: boolean;
}
export class RevokeWorkerAssignmentCommand {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reviewNote!: string;
}
