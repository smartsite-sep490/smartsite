import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsIn,
  IsUUID,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
export class WorkerComplianceQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(['true', 'false']) pendingOnly?: string;
  @IsOptional() @IsIn(['true', 'false']) expiringOnly?: string;
  @IsOptional() @IsUUID() contractorId?: string;
  @IsOptional()
  @IsIn(['NOT_SUBMITTED', 'PENDING_REVIEW', 'REVIEWED'])
  submissionStatus?: import('@smartsite/contracts').WorkerDocumentSubmissionStatus;
  @IsOptional() @IsIn(['true', 'false']) needsSupplement?: string;
  @IsOptional() @Matches(/^\d+$/) offset?: string;
  @IsOptional() @Matches(/^\d+$/) limit?: string;
}
import type { ReviewWorkerDocumentCommand } from '@smartsite/contracts';
export class ReviewWorkerDocumentDto implements ReviewWorkerDocumentCommand {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsBoolean() approve!: boolean;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedOn?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
