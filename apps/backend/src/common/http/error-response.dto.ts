import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ example: 'BAD_REQUEST' })
  code!: string;

  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] })
  message!: string | string[];

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
