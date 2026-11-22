import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyIdentificationEnabledGuard } from './safety-identification-enabled.guard.js';
import {
  type IdentificationAction,
  SafetyIdentificationService,
} from './safety-identification.service.js';

@UseGuards(UserAuthGuard, SafetyIdentificationEnabledGuard)
@Controller('sites/:siteId/safety-identification-requests')
export class SafetyIdentificationController {
  constructor(private readonly identification: SafetyIdentificationService) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ) {
    return this.identification.create(request, siteId, body);
  }

  @Post(':id/retrospective-assessment')
  @HttpCode(202)
  @Header('Cache-Control', 'private, no-store')
  enqueueRetrospective(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.identification.enqueueRetrospective(request, siteId, id, body);
  }

  @Get(':id/retrospective-assessments')
  @Header('Cache-Control', 'private, no-store')
  retrospectiveHistory(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.identification.retrospectiveHistory(request, siteId, id, offset, limit);
  }

  @Get(':id/retrospective-assessment-options')
  @Header('Cache-Control', 'private, no-store')
  retrospectiveOptions(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.identification.retrospectiveOptions(request, siteId, id);
  }

  @Post(':id/:action')
  @Header('Cache-Control', 'private, no-store')
  change(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param(
      'action',
      new ParseEnumPipe({
        respond: 'respond',
        review: 'review',
        reassign: 'reassign',
        cancel: 'cancel',
      }),
    )
    action: IdentificationAction,
    @Body() body: unknown,
  ) {
    return this.identification.change(request, siteId, id, action, body);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.identification.list(request, siteId, offset, limit, status);
  }

  @Get('assignee')
  @Header('Cache-Control', 'private, no-store')
  async assignee(@Req() request: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return { assignee: await this.identification.assignee(request, siteId) };
  }

  @Post('evidence-preview')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Access-Control-Expose-Headers',
    'X-Request-ID, X-Smartsite-Frame-Sha256, X-Smartsite-Content-Sha256',
  )
  async previewEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { bytes, sha256, frameSha256 } = await this.identification.previewEvidence(
      request,
      siteId,
      body,
    );
    response.setHeader('X-Smartsite-Frame-Sha256', frameSha256);
    response.setHeader('X-Smartsite-Content-Sha256', sha256);
    return new StreamableFile(bytes, { type: 'image/jpeg', length: bytes.length });
  }

  @Get(':id/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Access-Control-Expose-Headers',
    'X-Request-ID, X-Smartsite-Content-Sha256, X-Smartsite-Evidence-Ttl-Ms',
  )
  async evidence(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { bytes, sha256, expiresAt } = await this.identification.evidence(
      request,
      siteId,
      id,
      evidenceId,
    );
    response.setHeader('X-Smartsite-Content-Sha256', sha256);
    response.setHeader(
      'X-Smartsite-Evidence-Ttl-Ms',
      Math.max(0, Date.parse(expiresAt) - Date.now()),
    );
    return new StreamableFile(bytes, { type: 'image/jpeg', length: bytes.length });
  }

  @Get(':id/history')
  @Header('Cache-Control', 'private, no-store')
  history(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.identification.history(request, siteId, id, offset, limit);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.identification.get(request, siteId, id);
  }
}
