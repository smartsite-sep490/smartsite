import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class RequestReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  reason!: string;
}

export class CreateShiftChangeRequestDto extends RequestReasonDto {
  @IsUUID()
  workerScheduleId!: string;

  @IsUUID()
  toShiftId!: string;
}

export class CreateShiftSwapRequestDto extends RequestReasonDto {
  @IsUUID()
  requesterWorkerScheduleId!: string;

  @IsUUID()
  coworkerWorkerScheduleId!: string;
}

export class CreateAbsenceRequestDto extends RequestReasonDto {
  @IsUUID()
  workerScheduleId!: string;

  @IsOptional()
  @IsUUID()
  replacementWorkerId?: string;
}
