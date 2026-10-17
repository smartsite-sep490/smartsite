import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  ValidateNested,
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
  IsBoolean,
  ValidateIf,
} from 'class-validator';
import type { CreateVisitCommand, VerifyQrCommand, VisitorGateCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const visitorToken = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? /^[a-z2-9]{8}$/i.test(value.trim())
      ? value.trim().toUpperCase()
      : value.trim()
    : value;
export class VisitorMemberCommand {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) fullName!: string;
  @Transform(trim) @Matches(/^\d{12}$/) identityNumber!: string;
}
export class VisitorAttendanceCommand extends VisitorMemberCommand {
  @IsUUID() memberId!: string;
}
export class ConfirmPassageCommand {
  @IsUUID() idempotencyKey!: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) reviewNote?: string;
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  separatePassage?: boolean;
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
  @Transform(trim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsIn(['en', 'vi']) language?: 'en' | 'vi';
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) hostName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(1000) purpose!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) targetArea!: string;
  @IsInt() @Min(1) @Max(1000) groupSize!: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => VisitorMemberCommand)
  members?: VisitorMemberCommand[];
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
export class VerifyVisitorQrCommand implements VisitorGateCommand {
  @Transform(visitorToken) @Matches(/^(SSQ-[a-f0-9]{64}|[A-HJ-NP-Z2-9]{8})$/) token!: string;
  @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @IsUUID() requestId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) count?: number;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => VisitorAttendanceCommand)
  attendees?: VisitorAttendanceCommand[];
}
export class PreviewVisitorQrCommand {
  @Transform(visitorToken) @Matches(/^(SSQ-[a-f0-9]{64}|[A-HJ-NP-Z2-9]{8})$/) token!: string;
}
