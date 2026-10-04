import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class ShiftRequestListDto {
  @IsIn(['WORKER', 'INCOMING', 'REVIEW', 'HISTORY'])
  view!: 'WORKER' | 'INCOMING' | 'REVIEW' | 'HISTORY';

  @IsOptional()
  @IsIn(['ALL', 'CHANGE', 'SWAP'])
  requestType?: 'ALL' | 'CHANGE' | 'SWAP';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  offset?: string;

  @IsOptional()
  @Matches(/^\d+$/)
  limit?: string;
}
