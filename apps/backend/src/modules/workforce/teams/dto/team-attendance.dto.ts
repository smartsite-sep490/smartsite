import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class SetTeamLeaderDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @ValidateIf((_o, value: unknown) => value !== null) @IsUUID() workerId!: string | null;
}
export class TeamAttendanceEntryDto {
  @IsUUID() expectedMembershipId!: string;
  @IsUUID() scheduleId!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(['PRESENT', 'ABSENT']) status!: 'PRESENT' | 'ABSENT';
}
export class SubmitTeamAttendanceDto {
  @IsUUID() requestId!: string;
  @IsUUID() teamId!: string;
  @IsUUID() zoneId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((v: TeamAttendanceEntryDto) => v.scheduleId)
  @ValidateNested({ each: true })
  @Type(() => TeamAttendanceEntryDto)
  entries!: TeamAttendanceEntryDto[];
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
