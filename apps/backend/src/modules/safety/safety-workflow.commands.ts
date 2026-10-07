import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { IncidentSeverity, SafetyTaskKind } from '@smartsite/contracts';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toLowerCase() : value;
const optional = (_: unknown, value: unknown) => value !== undefined && value !== null;
export class WorkflowCommand {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  commandId!: string;
}
export class VersionCommandDto extends WorkflowCommand {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @ApiProperty({ minimum: 1, type: Number })
  expectedVersion!: number;
}
export class ReasonCommandDto extends VersionCommandDto {
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  reason!: string;
}
export class CreateIncidentDto extends WorkflowCommand {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf(optional)
  @Transform(lower)
  @IsUUID()
  contractorId?: string | null;
  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @ValidateIf(optional)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.toLowerCase() : item))
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  workerIds?: string[];
  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  responsibilityReason?: string;
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  title!: string;
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  description!: string;
  @ApiProperty({})
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  severity!: IncidentSeverity;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  @ApiProperty({})
  occurredAt!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(optional)
  @Transform(lower)
  @IsUUID()
  zoneId?: string | null;
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.toLowerCase() : item))
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  @ApiProperty({ type: [String], maxItems: 100 })
  alertIds!: string[];
}
export class LinkAlertsDto extends VersionCommandDto {
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.toLowerCase() : item))
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  @ApiProperty({ type: [String], maxItems: 100 })
  alertIds!: string[];
}
export class AssignActionDto extends VersionCommandDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  assignedTo!: string;
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  description!: string;
  @ValidateIf(optional)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  @ApiPropertyOptional({})
  dueAt?: string | null;
}
export class ConfirmResponsibilityDto extends ReasonCommandDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  contractorId!: string;
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.toLowerCase() : item))
      : value,
  )
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @ApiProperty({ type: [String], maxItems: 100 })
  @IsUUID(undefined, { each: true })
  workerIds!: string[];
}
export class CorrectResponsibilityDto extends ConfirmResponsibilityDto {
  @ApiProperty({ format: 'uuid' }) @Transform(lower) @IsUUID() assignedTo!: string;
  @ApiProperty({}) @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @ValidateIf(optional)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  @ApiPropertyOptional({})
  dueAt?: string | null;
}
export class TransferActionDto extends ReasonCommandDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  assignedTo!: string;
}
export class ReopenIncidentDto extends AssignActionDto {
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  reason!: string;
}
export class SubmitResultDto extends VersionCommandDto {
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  resultDescription!: string;
}
export class ReviewSubmissionDto extends ReasonCommandDto {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  submissionId!: string;
  @ApiProperty({})
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';
}
export class CreateSafetyTaskDto extends WorkflowCommand {
  @ApiProperty({ format: 'uuid' })
  @Transform(lower)
  @IsUUID()
  assignedTo!: string;
  @ApiProperty({})
  @Transform(trim)
  @IsString()
  @Length(1, 10000)
  description!: string;
  @ValidateIf(optional)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  @ApiPropertyOptional({})
  dueAt?: string | null;
  @IsIn(['ZONE_INSPECTION', 'ALERT_VERIFICATION', 'SAFETY_FOLLOW_UP', 'SAFETY_PATROL'])
  @ApiProperty({})
  kind!: SafetyTaskKind;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(optional)
  @Transform(lower)
  @IsUUID()
  zoneId?: string | null;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(optional)
  @Transform(lower)
  @IsUUID()
  sourceAlertId?: string | null;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(optional)
  @Transform(lower)
  @IsUUID()
  sourceIncidentId?: string | null;
}
