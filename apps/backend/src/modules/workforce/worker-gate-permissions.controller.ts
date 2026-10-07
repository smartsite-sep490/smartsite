import { Body, Controller, Get, Logger, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import {
  SetGatePermissionsCommand,
  WorkerGatePermissionsService,
} from './worker-gate-permissions.service.js';

@ApiTags('worker-gate-permissions')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/workers/:workerId/gate-permissions')
export class WorkerGatePermissionsController {
  private readonly logger = new Logger(WorkerGatePermissionsController.name);
  constructor(private readonly permissions: WorkerGatePermissionsService) {}
  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
  ) {
    return this.permissions.list(request.user!, siteId, workerId);
  }
  @Put()
  async set(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Body() input: SetGatePermissionsCommand,
  ) {
    const result = await this.permissions.set(request.user!, siteId, workerId, input);
    this.logger.log({
      action: 'worker.gate-permissions.set',
      actorId: request.user!.id,
      resourceId: workerId,
      siteId,
    });
    return result;
  }
}
