import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BACKEND_ERROR_CODES, type BackendErrorCode } from './public-http-exception.js';

class ValidationIssueDto {
  @ApiProperty()
  code!: string;

  @ApiProperty()
  path!: string;

  @ApiProperty()
  message!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ enum: [false] })
  success!: false;

  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ enum: BACKEND_ERROR_CODES, example: 'BAD_REQUEST' })
  code!: BackendErrorCode;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  requestId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/integrations/ai/events' })
  path!: string;

  @ApiPropertyOptional({ type: [ValidationIssueDto] })
  issues?: ValidationIssueDto[];

  @ApiPropertyOptional({ enum: ['error'] })
  status?: 'error';

  @ApiPropertyOptional({ enum: ['smartsite-backend'] })
  service?: 'smartsite-backend';

  @ApiPropertyOptional({ enum: ['down'] })
  database?: 'down';
}
