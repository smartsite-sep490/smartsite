import { Transform } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  ValidateIf,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { AttendanceDayStatus } from '@smartsite/contracts';
export class AttendanceDaysDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) fromDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) toDate?: string;
  @IsOptional() @IsUUID() workerId?: string;
  @IsOptional()
  @IsIn(['IN_PROGRESS', 'NEEDS_REVIEW', 'CONFIRMED', 'ABSENT'])
  status?: AttendanceDayStatus;
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
}
export class AttendanceOverviewQueryDto {
  @IsOptional() @IsUUID() dayId?: string;
}
export class AttendanceTimeRequestsDto {
  @IsIn(['OVERTIME', 'LEAVE']) kind!: 'OVERTIME' | 'LEAVE';
  @IsOptional() @IsUUID() workerId?: string;
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?:
    'PENDING' | 'APPROVED' | 'REJECTED';
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
}
export class AttendanceTimeRequestDto {
  @IsUUID() requestId!: string;
  @IsUUID() workerScheduleId!: string;
  @IsIn(['OVERTIME', 'LEAVE']) kind!: 'OVERTIME' | 'LEAVE';
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  startsAt!: string;
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i)
  endsAt!: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
export class ReviewAttendanceDayDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reviewNote!: string;
}
export class ReviewAttendanceTimeDto {
  @IsBoolean() approve!: boolean;
  @ValidateIf(
    (object: ReviewAttendanceTimeDto, value: unknown) =>
      object.approve === false || value !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reviewNote?: string;
}
export class IgnoreDuplicateAttendanceDto {
  @IsInt() @Min(1) expectedSessionVersion!: number;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}
