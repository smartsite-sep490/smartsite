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
  @Transform(lower) @IsUUID() commandId!: string;
}
export class VersionCommandDto extends WorkflowCommand {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedVersion!: number;
}
export class ReasonCommandDto extends VersionCommandDto {
  @Transform(trim) @IsString() @Length(1, 2000) reason!: string;
}
export class CreateIncidentDto extends WorkflowCommand {
  @Transform(trim) @IsString() @Length(1, 200) title!: string;
  @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']) severity!: IncidentSeverity;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt!: string;
  @ValidateIf(optional) @Transform(lower) @IsUUID() zoneId?: string | null;
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  alertIds!: string[];
}
export class LinkAlertsDto extends VersionCommandDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  alertIds!: string[];
}
export class AssignActionDto extends VersionCommandDto {
  @Transform(lower) @IsUUID() assignedTo!: string;
  @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @ValidateIf(optional)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string | null;
}
export class ReopenIncidentDto extends AssignActionDto {
  @Transform(trim) @IsString() @Length(1, 2000) reason!: string;
}
export class SubmitResultDto extends VersionCommandDto {
  @Transform(trim) @IsString() @Length(1, 10000) resultDescription!: string;
}
export class ReviewSubmissionDto extends ReasonCommandDto {
  @Transform(lower) @IsUUID() submissionId!: string;
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
}
export class CreateSafetyTaskDto extends WorkflowCommand {
  @Transform(lower) @IsUUID() assignedTo!: string;
  @Transform(trim) @IsString() @Length(1, 10000) description!: string;
  @ValidateIf(optional)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string | null;
  @IsIn(['ZONE_INSPECTION', 'ALERT_VERIFICATION', 'SAFETY_FOLLOW_UP', 'SAFETY_PATROL'])
  kind!: SafetyTaskKind;
  @ValidateIf(optional) @Transform(lower) @IsUUID() zoneId?: string | null;
  @ValidateIf(optional) @Transform(lower) @IsUUID() sourceAlertId?: string | null;
  @ValidateIf(optional) @Transform(lower) @IsUUID() sourceIncidentId?: string | null;
}
