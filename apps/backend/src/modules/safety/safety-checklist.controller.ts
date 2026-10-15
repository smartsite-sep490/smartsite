import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  Header,
  UseInterceptors,
  UploadedFiles,
  StreamableFile,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags, ApiConsumes, ApiBody, ApiOperation } from '@nestjs/swagger';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { pagination } from '../../common/http/pagination.js';
import { invalid } from '../../common/configuration/commands.js';
import { SafetyChecklistService } from './safety-checklist.service.js';
import { CreateChecklistDto, ReviewChecklistDto } from './safety-checklist.commands.js';
import { VersionCommandDto, ReasonCommandDto } from './safety-workflow.commands.js';
import { MAX_CHECKLIST_FILE, type SafetyUpload } from './safety-upload.service.js';
import { checklistMultipartStorage } from './checklist-multipart.storage.js';
@ApiTags('Safety checklists')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/safety-checklists')
export class SafetyChecklistController {
  constructor(private readonly service: SafetyChecklistService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('teamId') teamId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('timezone') timezone?: string,
  ) {
    return this.service.list(siteId, r.user!.id, {
      ...pagination(offset, limit),
      status,
      assignedTo,
      teamId,
      fromDate,
      toDate,
      timezone,
    });
  }
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  get(@Req() r: AuthenticatedRequest, @Param('siteId') siteId: string, @Param('id') id: string) {
    return this.service.get(siteId, id, r.user!.id);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: CreateChecklistDto,
  ) {
    return this.service.create(siteId, r.user!.id, body);
  }
  @Post(':id/start')
  @Header('Cache-Control', 'private, no-store')
  start(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: VersionCommandDto,
  ) {
    return this.service.mutate(siteId, id, r.user!.id, 'start', body);
  }
  @Post(':id/cancel')
  @Header('Cache-Control', 'private, no-store')
  cancel(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: ReasonCommandDto,
  ) {
    return this.service.mutate(siteId, id, r.user!.id, 'cancel', body);
  }
  @Post(':id/reviews')
  @Header('Cache-Control', 'private, no-store')
  review(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: ReviewChecklistDto,
  ) {
    return this.service.mutate(siteId, id, r.user!.id, 'review', body);
  }
  @Post(':id/submissions')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Report each checklist item with optional JPEG, PNG or PDF evidence' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          description: 'JSON SubmitChecklistCommand; fileIndexes address the files array',
        },
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 90, {
      storage: checklistMultipartStorage(),
      limits: { fileSize: MAX_CHECKLIST_FILE, files: 90, fields: 1, fieldSize: 131072, parts: 91 },
    }),
  )
  submit(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: SafetyUpload[] = [],
  ) {
    if (Object.keys(body).length !== 1 || typeof body.command !== 'string')
      invalid('A checklist command JSON field is required');
    let input: unknown;
    try {
      input = JSON.parse(body.command);
    } catch {
      invalid('Invalid checklist command JSON');
    }
    return this.service.mutate(siteId, id, r.user!.id, 'submit', input, files);
  }
  @Get(':id/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async evidence(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    const file = await this.service.evidence(siteId, id, evidenceId, r.user!.id);
    return new StreamableFile(file.bytes, {
      type: file.mediaType,
      length: file.bytes.length,
      disposition:
        file.mediaType === 'application/pdf'
          ? 'attachment; filename="checklist-evidence.pdf"'
          : undefined,
    });
  }
}
