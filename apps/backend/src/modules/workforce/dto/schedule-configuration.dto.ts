import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const safeText = /^[^\p{Cc}\p{Cs}]+$/u;

export class CreateShiftDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Matches(safeText)
  name!: string;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsISO8601({ strict: true })
  endsAt!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/)
  timezone!: string;
}

export class CreateScheduleVersionDto {
  @IsISO8601({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveUntil?: string;
}

export class CreateWorkerScheduleDto {
  @IsUUID()
  workerId!: string;

  @IsUUID()
  shiftId!: string;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  workDate!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AssignShiftToContractorDto {
  @IsUUID()
  contractorId!: string;
}

export class ListWorkerSchedulesQueryDto {
  @IsOptional()
  @Matches(/^\d+$/)
  offset?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate?: string;

  @IsOptional()
  @IsUUID()
  workerId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsIn(['ALL', 'ACTIVE', 'INACTIVE'])
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsString()
  searchName?: string;
}
