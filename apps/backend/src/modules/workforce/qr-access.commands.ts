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
} from 'class-validator';
import type { CreateVisitCommand, VerifyQrCommand, VisitorGateCommand } from '@smartsite/contracts';
import { SITE_GATES } from '@smartsite/contracts';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
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
}
export class VisitDecisionCommand {
  @IsIn(['APPROVED', 'REJECTED']) status!: 'APPROVED' | 'REJECTED';
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
  @IsInt() @Min(1) @Max(1000) count!: number;
}
