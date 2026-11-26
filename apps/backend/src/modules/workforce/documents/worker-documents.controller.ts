import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { invalid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { WorkerDocumentsService, type DocumentUpload } from './worker-documents.service.js';
import { ReviewWorkerDocumentDto, WorkerComplianceQueryDto } from './worker-documents.commands.js';

function multipartMetadata(body: { metadata?: string }): unknown {
  if (
    !body ||
    Object.keys(body).some((key) => key !== 'metadata') ||
    typeof body.metadata !== 'string'
  )
    invalid('Invalid document submission');
  try {
    return JSON.parse(body.metadata);
  } catch {
    invalid('Invalid document submission');
  }
}

@ApiTags('worker-documents')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class WorkerDocumentsController {
  constructor(
    private readonly service: WorkerDocumentsService,
    private readonly userAuth: UserAuthGuard,
  ) {}
  @Get('workers/:workerId/identity-images/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async identityFile(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
  ) {
    const { image, bytes } = await this.service.identityFile(r.user!, siteId, workerId, id);
    return new StreamableFile(bytes, { type: image.file.mediaType, length: bytes.length });
  }
  @Get('worker-compliance')
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query() query: WorkerComplianceQueryDto,
  ) {
    const p = pagination(query.offset, query.limit);
    return this.service.list(r.user!, siteId, p.offset, p.limit, {
      search: query.search,
      pendingOnly: query.pendingOnly === 'true',
      expiringOnly: query.expiringOnly === 'true',
      contractorId: query.contractorId,
      submissionStatus: query.submissionStatus,
      needsSupplement:
        query.needsSupplement === undefined ? undefined : query.needsSupplement === 'true',
    });
  }
  @Get('workers/me/compliance')
  @Header('Cache-Control', 'private, no-store')
  ownCompliance(@Req() r: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.service.getOwn(r.user!, siteId);
  }

  @Get('workers/:workerId/compliance')
  @Header('Cache-Control', 'private, no-store')
  get(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
  ) {
    return this.service.get(r.user!, siteId, workerId);
  }
  @Put('workers/me/identity')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'FRONT', maxCount: 1 },
        { name: 'BACK', maxCount: 1 },
      ],
      {
        limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 1, parts: 3, fieldSize: 16384 },
      },
    ),
  )
  updateIdentity(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: { metadata?: string },
    @UploadedFiles() files: Record<string, DocumentUpload[]> = {},
  ) {
    return this.service.updateOwnIdentity(
      r.user!,
      siteId,
      multipartMetadata(body),
      Object.fromEntries(Object.entries(files).map(([key, values]) => [key, values[0]])),
      configurationCommandContext(r, this.userAuth),
    );
  }

  @Post('contractors/:contractorId/worker-document-submissions/batch')
  @Header('Cache-Control', 'private, no-store')
  submitBatch(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() body: unknown,
  ) {
    return this.service.submitBatch(
      r.user!,
      siteId,
      contractorId,
      body,
      configurationCommandContext(r, this.userAuth),
    );
  }

  @Post('workers/:workerId/document-submissions')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileFieldsInterceptor(
      ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'].map((name) => ({
        name,
        maxCount: 1,
      })),
      { limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 1, parts: 4, fieldSize: 16384 } },
    ),
  )
  submit(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Body() body: { metadata?: string },
    @UploadedFiles() files: Record<string, DocumentUpload[]> = {},
  ) {
    return this.service.submit(
      r.user!,
      siteId,
      workerId,
      multipartMetadata(body),
      Object.fromEntries(Object.entries(files).map(([key, values]) => [key, values[0]])),
      configurationCommandContext(r, this.userAuth),
    );
  }
  @Get('workers/:workerId/documents/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
  ) {
    const { doc, bytes } = await this.service.file(r.user!, siteId, workerId, id);
    return new StreamableFile(bytes, {
      type: doc.file.mediaType,
      length: bytes.length,
      disposition: `inline; filename="worker-document.${doc.file.mediaType === 'application/pdf' ? 'pdf' : doc.file.mediaType === 'image/png' ? 'png' : 'jpg'}"`,
    });
  }
  @Post('workers/:workerId/documents/:id/ai-analysis')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @Header('Cache-Control', 'private, no-store')
  analyze(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (Object.keys(body ?? {}).length) invalid();
    return this.service.analyzeDocument(
      r.user!,
      siteId,
      workerId,
      id,
      configurationCommandContext(r, this.userAuth),
    );
  }
  @Post('workers/:workerId/documents/:id/reviews')
  @Header('Cache-Control', 'private, no-store')
  review(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: ReviewWorkerDocumentDto,
  ) {
    return this.service.review(
      r.user!,
      siteId,
      workerId,
      id,
      body,
      configurationCommandContext(r, this.userAuth),
    );
  }
}
