import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsDateString,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsString,
  Length,
  IsBoolean,
  IsUUID,
  IsISO8601,
  Matches,
  ValidateNested,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import type { ChecklistAnswer } from '@smartsite/contracts';
import {
  WorkflowCommand,
  VersionCommandDto,
  ReasonCommandDto,
} from './safety-workflow.commands.js';
export class ChecklistItemDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Length(1, 1000)
  text!: string;
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  evidenceRequired!: boolean;
}
export class CreateChecklistDto extends WorkflowCommand {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  teamId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  zoneId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  assignedTo!: string;
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  description!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt!: string;
  @ApiProperty({ format: 'date-time' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  endsAt!: string;
  @ApiProperty({ type: [ChecklistItemDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  items!: ChecklistItemDto[];
}
export class ChecklistResultDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
  @ApiProperty({ enum: ['PASS', 'FAIL', 'NOT_APPLICABLE'] })
  @IsIn(['PASS', 'FAIL', 'NOT_APPLICABLE'])
  answer!: ChecklistAnswer;
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @Length(0, 2000)
  note!: string;
  @ApiProperty({ type: [Number], maxItems: 3 })
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(89, { each: true })
  fileIndexes!: number[];
}
export class SubmitChecklistDto extends VersionCommandDto {
  @ApiProperty({ type: [ChecklistResultDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultDto)
  results!: ChecklistResultDto[];
}
export class ReviewChecklistDto extends ReasonCommandDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  submissionId!: string;
  @ApiProperty({ enum: ['ACCEPTED', 'RETURNED'] })
  @IsIn(['ACCEPTED', 'RETURNED'])
  decision!: 'ACCEPTED' | 'RETURNED';
}

export class ChecklistContextQueryDto {
  @IsOptional() @IsUUID() teamId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate?: string;
  @IsOptional() @IsString() @Length(1, 64) timezone?: string;
}
