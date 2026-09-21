import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiOkResponse,
  ApiProperty,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';

class LiveHealthResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';

  @ApiProperty({ enum: ['smartsite-backend'] })
  service!: 'smartsite-backend';
}

class ReadyHealthResponse {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ enum: ['smartsite-backend'] })
  service!: 'smartsite-backend';

  @ApiProperty({ enum: ['up', 'down'] })
  database!: 'up' | 'down';
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  @ApiOkResponse({ type: LiveHealthResponse, description: 'The API process is responding.' })
  live(): LiveHealthResponse {
    return { status: 'ok', service: 'smartsite-backend' };
  }

  @Get('ready')
  @ApiOkResponse({
    type: ReadyHealthResponse,
    description: 'PostgreSQL accepts a readiness query.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'PostgreSQL is unavailable.',
  })
  async ready(): Promise<ReadyHealthResponse> {
    if (!(await this.database.isReachable())) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'smartsite-backend',
        database: 'down',
      });
    }
    return { status: 'ok', service: 'smartsite-backend', database: 'up' };
  }
}
