import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyEpisodeQueryService } from './safety-episode-query.service.js';

@ApiTags('safety-episodes')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/safety-episodes')
export class SafetyEpisodesController {
  constructor(private readonly episodes: SafetyEpisodeQueryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.episodes.list(request, siteId, query);
  }
}
