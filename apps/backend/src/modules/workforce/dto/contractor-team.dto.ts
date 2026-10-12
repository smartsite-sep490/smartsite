import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class ContractorTeamQueryDto {
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
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsIn(['ACTIVE', 'ARCHIVED', 'ALL']) status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
}
export class ContractorTeamWorkersQueryDto {
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
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
  @IsOptional() @IsUUID() teamId?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unassigned?: boolean;
}
export class CreateContractorTeamDto {
  @IsUUID() requestId!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string;
}
export class UpdateContractorTeamDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @Transform(trim) @IsString() @MaxLength(1000) description!: string;
}
export class ArchiveContractorTeamDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @Transform(trim) @IsString() @MinLength(5) @MaxLength(1000) reason!: string;
}
export class AssignContractorTeamDto {
  @IsUUID() requestId!: string;
  @ValidateIf((_o, value: unknown) => value !== null) @IsUUID() expectedMembershipId!:
    string | null;
  @ValidateIf((_o, value: unknown) => value !== null) @IsUUID() teamId!: string | null;
  @Transform(trim)
  @ValidateIf(
    (input: AssignContractorTeamDto, value: unknown) =>
      input.expectedMembershipId !== null || (value !== undefined && value !== ''),
  )
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason?: string;
}
