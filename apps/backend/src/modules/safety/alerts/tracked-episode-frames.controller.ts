import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  parseTrackedEpisodeObservationQuery,
  parseTrackedEpisodeMediaQuery,
} from '@smartsite/contracts/tracked-episode-frames';
import { invalid } from '../../../common/configuration/commands.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { TrackedEpisodeFrameQuery } from './tracked-episode-frame-query.js';

/** Candidate controller only: intentionally absent from runtime module registration. */
@ApiTags('safety-episodes')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/safety-episodes/:id')
export class TrackedEpisodeFramesController {
  constructor(private readonly frames: TrackedEpisodeFrameQuery) {}
  @Get('observations')
  @Header('Cache-Control', 'no-store')
  observations(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parseTrackedEpisodeObservationQuery(query);
    if (!parsed) invalid('Invalid observation history query');
    return this.frames.pageObservations(request, siteId, id, parsed);
  }
  @Get('findings/:alertId/events/:eventId/frame')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces('image/jpeg')
  async frame(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = parseTrackedEpisodeMediaQuery(query);
    if (!parsed) invalid('Invalid original frame query');
    const result = await this.frames.read(
      request,
      siteId,
      id,
      {
        alertId,
        eventId,
        personObservationIndex: parsed.personObservationIndex,
        evidenceIndex: parsed.evidenceIndex,
      },
      parsed.representation,
    );
    return new StreamableFile(result.bytes, {
      type: 'image/jpeg',
      disposition: `inline; filename="${result.fileName}"`,
      length: result.bytes.length,
    });
  }
}
