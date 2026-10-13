import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../../auth/user-auth.guard.js';
import { ContractorParticipationQueryService } from './contractor-participation-query.service.js';

@ApiTags('contractor-participations')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('contractors')
export class ContractorParticipationQueryController {
  constructor(private readonly query: ContractorParticipationQueryService) {}

  @Get()
  contractors(
    @Req() req: AuthenticatedRequest,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const paging = pagination(offset, limit);
    return this.query.contractors(req.user!, paging.offset, paging.limit);
  }

  @Get(':contractorId/participations')
  participations(
    @Req() req: AuthenticatedRequest,
    @Param('contractorId') contractorId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const paging = pagination(offset, limit);
    return this.query.participations(req.user!, contractorId, paging.offset, paging.limit);
  }
}
