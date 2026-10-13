import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ScheduleAssignmentDto {
  @IsUUID() contractorId!: string;
  @IsUUID() scheduleVersionId!: string;
  @IsUUID() shiftId!: string;
  @IsIn(['TEAM', 'WORKER']) target!: 'TEAM' | 'WORKER';
  @IsOptional() @IsUUID() teamId?: string;
  @IsOptional() @IsUUID() workerId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  selectedWorkerIds?: string[];
  @IsIn(['DAY', 'WEEK', 'REPEAT']) mode!: 'DAY' | 'WEEK' | 'REPEAT';
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays!: number[];
}
export class CreateScheduleAssignmentDto extends ScheduleAssignmentDto {
  @IsUUID() requestId!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedFingerprint!: string;
}
export class ChangeScheduleAssignmentDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(['CANCEL', 'CHANGE_SHIFT']) action!: 'CANCEL' | 'CHANGE_SHIFT';
  @IsIn(['DAY', 'FROM_DATE', 'UNSTARTED']) scope!: 'DAY' | 'FROM_DATE' | 'UNSTARTED';
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsOptional() @IsUUID() workerId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
