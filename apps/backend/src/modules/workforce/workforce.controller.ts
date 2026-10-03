import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import {
  WorkerPageResponseDto,
  WorkerResponseDto,
} from '../../common/http/management-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import type { WorkerEntity } from '../../database/entities/worker.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import { CreateWorkerDto } from './dto/workforce.dto.js';
import {
  LinkWorkerAccountCommand,
  WorkforceConfigurationService,
} from './workforce-configuration.service.js';

function workerResponse(worker: WorkerEntity) {
  return {
    id: worker.id,
    siteId: worker.siteId,
    contractorId: worker.contractorId,
    userId: worker.userId,
    externalId: worker.externalId,
    displayName: worker.displayName,
    isActive: worker.isActive,
    createdAt: worker.createdAt,
  };
}

@ApiTags('workers')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/workers')
export class WorkforceController {
  private readonly logger = new Logger(WorkforceController.name);

  constructor(private readonly workforce: WorkforceConfigurationService) {}

  @Post('for-account')
  @ApiCreatedResponse({ type: WorkerResponseDto })
  async forAccount(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: LinkWorkerAccountCommand,
  ) {
    const worker = await this.workforce.forAccount(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.account.prepare',
      resourceId: worker.id,
      siteId,
    });
    return workerResponse(worker);
  }

  @Put(':workerId/account')
  @ApiOkResponse({ type: WorkerResponseDto })
  async linkAccount(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Body() input: LinkWorkerAccountCommand,
  ) {
    const worker = await this.workforce.linkAccount(siteId, workerId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.account.link',
      resourceId: worker.id,
      siteId,
    });
    return workerResponse(worker);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({ type: WorkerResponseDto })
  async create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: CreateWorkerDto,
  ) {
    const worker = await this.workforce.create(siteId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'worker.create',
      siteId,
      resourceId: worker.id,
    });
    return workerResponse(worker);
  }

  @Get()
  @ApiOkResponse({ type: WorkerPageResponseDto })
  async list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.workforce.list(request.user!, siteId, value.offset, value.limit);
    return { items: result.items.map(workerResponse), total: result.total };
  }

  @Get('coworkers')
  @ApiOkResponse()
  async listCoworkers(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const value = pagination(offset, limit);
    const result = await this.workforce.listCoworkers(request.user!, siteId, value.offset, value.limit);
    return { items: result.items, total: result.total };
  }
}
