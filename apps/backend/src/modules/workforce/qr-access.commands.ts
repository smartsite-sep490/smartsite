import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsOptional,
  IsArray,
  ArrayUnique,
  ArrayMaxSize,
  Equals,
} from 'class-validator';
import type { CreateVisitCommand, VerifyQrCommand, VisitorGateCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class ConfirmPassageCommand {
  @IsUUID() idempotencyKey!: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reviewNote?: string;
}
export class ManualWorkerVerificationCommand {
  @IsUUID() requestId!: string;
  @IsUUID() workerId!: string;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @Equals(true) identityConfirmed!: boolean;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reviewNote!: string;
}
export class ManualVisitCheckoutCommand {
  @IsUUID() requestId!: string;
  @Equals(true) representativeConfirmed!: boolean;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reviewNote!: string;
}
export class RegisterVisitCommand implements CreateVisitCommand {
  @IsUUID() requestId!: string;
  @Matches(/^[A-Za-z0-9_-]{43,128}$/) accessKey!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) visitorName!: string;
  @Transform(trim) @IsString() @MaxLength(255) company!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) contact!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) hostName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) purpose!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) targetArea!: string;
  @IsInt() @Min(1) @Max(1000) groupSize!: number;
  @IsIn(SITE_GATES.map((g) => g.id)) gateId!: string;
  @IsDateString({ strict: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/) validFrom!: string;
  @IsDateString({ strict: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/) validUntil!: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  zoneIds?: string[];
}
export class VisitDecisionCommand {
  @IsIn(['APPROVED', 'REJECTED', 'CANCELLED']) status!: 'APPROVED' | 'REJECTED' | 'CANCELLED';
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) reviewNote?: string;
}
export class LookupVisitorPassCommand {
  @IsUUID() visitId!: string;
  @Matches(/^[A-Za-z0-9_-]{43,128}$/) accessKey!: string;
}
export class CameraFallbackCommand {
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsIn(['CAMERA_UNAVAILABLE']) reason!: 'CAMERA_UNAVAILABLE';
}
export class IssueWorkerQrCommand {
  @IsUUID() fallbackSessionId!: string;
}
export class VerifyWorkerQrCommand implements VerifyQrCommand {
  @Matches(/^SSQ-[a-f0-9]{64}$/) token!: string;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsUUID() requestId!: string;
}
export class VerifyVisitorQrCommand extends VerifyWorkerQrCommand implements VisitorGateCommand {
  @IsOptional() @IsInt() @Min(1) @Max(1000) count?: number;
}
