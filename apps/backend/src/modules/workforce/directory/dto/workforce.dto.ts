import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const safeText = /^[^\p{Cc}\p{Cs}]+$/u;

export class CreateWorkerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(safeText)
  externalId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(safeText)
  displayName!: string;

  @IsOptional()
  @IsUUID()
  contractorId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CreateContractorDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(safeText)
  code!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(safeText)
  name!: string;
}

export class AssignContractorRepresentativeDto {
  @IsUUID()
  userId!: string;
}
