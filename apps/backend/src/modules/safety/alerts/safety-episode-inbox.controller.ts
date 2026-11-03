import { Body, Controller, Get, Header, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyEpisodeInboxService } from './safety-episode-inbox.service.js';

@ApiTags('safety-episodes')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('me/safety-episode-inbox')
export class SafetyEpisodeInboxController {
  constructor(private readonly inbox: SafetyEpisodeInboxService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.inbox.list(request, query);
  }

  @Patch(':id/read')
  @Header('Cache-Control', 'no-store')
  read(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.read(request, id, body);
  }
}
