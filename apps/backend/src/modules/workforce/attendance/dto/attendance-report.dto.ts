import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { AttendanceReportStatus } from '@smartsite/contracts';

export class AttendanceReportDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) fromDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) toDate!: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsUUID() contractorId?: string;
  @IsOptional() @IsUUID() workerId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsString() @MaxLength(160) search?: string;
  @IsOptional()
  @IsIn([
    'PRESENT',
    'ABSENT',
    'NEEDS_REVIEW',
    'SCHEDULED',
    'NOT_ARRIVED',
    'OFF',
    'APPROVED_LEAVE',
    'UNAVAILABLE',
  ])
  todayStatus?: AttendanceReportStatus;
}
export class AttendanceWorkersDto extends AttendanceReportDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  offset?: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  includeDaily?: boolean;
}
