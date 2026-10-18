import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
export class WorkerComplianceQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['true', 'false']) pendingOnly?: string;
  @IsOptional()
  @IsIn(['NOT_SUBMITTED', 'PENDING_REVIEW', 'REVIEWED'])
  submissionStatus?: import('@smartsite/contracts').WorkerDocumentSubmissionStatus;
  @IsOptional() @IsIn(['true', 'false']) needsSupplement?: string;
  @IsOptional() @Matches(/^\d+$/) offset?: string;
  @IsOptional() @Matches(/^\d+$/) limit?: string;
}
import type {
  ReviewWorkerDocumentCommand,
  UploadWorkerDocumentCommand,
  UpdateWorkerDocumentExpiryCommand,
} from '@smartsite/contracts';
export class UploadWorkerDocumentDto implements UploadWorkerDocumentCommand {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  submittedExpiresOn?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  submittedIssuedOn?: string;
}
export class UpdateWorkerDocumentExpiryDto implements UpdateWorkerDocumentExpiryCommand {
  @IsInt() @Min(1) expectedVersion!: number;
  @ValidateIf(
    (object: UpdateWorkerDocumentExpiryDto, value: unknown) =>
      value !== null && (value !== undefined || object.submittedIssuedOn === undefined),
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  submittedExpiresOn?: string | null;
  @ValidateIf(
    (object: UpdateWorkerDocumentExpiryDto, value: unknown) =>
      value !== null && (value !== undefined || object.submittedExpiresOn === undefined),
  )
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  submittedIssuedOn?: string | null;
}
export class ReviewWorkerDocumentDto implements ReviewWorkerDocumentCommand {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() approve!: boolean;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedOn?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string;
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reviewNote!: string;
}
