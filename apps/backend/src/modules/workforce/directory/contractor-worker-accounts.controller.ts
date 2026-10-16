import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import {
  ContractorWorkerAccountsService,
  CreateContractorWorkerAccountCommand,
  UpdateContractorWorkerCommand,
} from './contractor-worker-accounts.service.js';

@ApiTags('contractor-workers')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller()
export class ContractorWorkerAccountsController {
  constructor(
    private readonly accounts: ContractorWorkerAccountsService,
    private readonly auth: UserAuthGuard,
  ) {}

  @Put('sites/:siteId/contractors/:contractorId/workers/:workerId')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('workerId') workerId: string,
    @Body() input: UpdateContractorWorkerCommand,
  ) {
    return this.accounts.update(
      request.user!,
      siteId,
      contractorId,
      workerId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }

  @Get('sites/:siteId/contractor-worker-account-options')
  options(@Req() request: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.accounts.options(request.user!, siteId);
  }

  @Post('contractors/:contractorId/worker-accounts')
  @ApiCreatedResponse()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateContractorWorkerAccountCommand,
  ) {
    return this.accounts.create(
      request.user!,
      contractorId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }
}
