import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { invalid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { WorkerDocumentsService, type DocumentUpload } from './worker-documents.service.js';
import {
  ReviewWorkerDocumentDto,
  WorkerComplianceQueryDto,
  UploadWorkerDocumentDto,
} from './worker-documents.commands.js';

@ApiTags('worker-documents')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class WorkerDocumentsController {
  constructor(
    private readonly service: WorkerDocumentsService,
    private readonly userAuth: UserAuthGuard,
  ) {}
  @Post('contractors/:contractorId/document-image-quality')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  quality(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @UploadedFile() file: DocumentUpload,
  ) {
    return this.service.checkQuality(r.user!, siteId, contractorId, file);
  }
  @Post('workers/:workerId/document-image-quality')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  workerQuality(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @UploadedFile() file: DocumentUpload,
  ) {
    return this.service.checkWorkerQuality(r.user!, siteId, workerId, file);
  }
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
  @Post('workers/:workerId/identity-images/:id/ocr')
  @Header('Cache-Control', 'private, no-store')
  retryIdentityOcr(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (Object.keys(body ?? {}).length) invalid();
    return this.service.retryIdentityOcr(r.user!, siteId, workerId, id);
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
      submissionStatus: query.submissionStatus,
      needsSupplement:
        query.needsSupplement === undefined ? undefined : query.needsSupplement === 'true',
    });
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
  @Post('workers/:workerId/document-submissions')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileFieldsInterceptor(
      ['FRONT', 'BACK', 'SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'].map((name) => ({
        name,
        maxCount: 1,
      })),
      { limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 1, parts: 6, fieldSize: 16384 } },
    ),
  )
  submit(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Body() body: { metadata?: string },
    @UploadedFiles() files: Record<string, DocumentUpload[]> = {},
  ) {
    if (Object.keys(body).some((key) => key !== 'metadata') || typeof body.metadata !== 'string')
      invalid('Invalid document submission');
    let input: unknown;
    try {
      input = JSON.parse(body.metadata);
    } catch {
      invalid('Invalid document submission');
    }
    return this.service.submit(
      r.user!,
      siteId,
      workerId,
      input as import('@smartsite/contracts').SubmitWorkerDocumentsCommand,
      Object.fromEntries(Object.entries(files).map(([key, values]) => [key, values[0]])),
      configurationCommandContext(r, this.userAuth),
    );
  }
  @Post('workers/:workerId/documents/:kind/check')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
    }),
  )
  checkSubmission(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: DocumentUpload,
    @Body() body: UploadWorkerDocumentDto,
  ) {
    return this.service.checkSubmission(r.user!, siteId, workerId, kind, file, body);
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
  @Post('workers/:workerId/documents/:id/ocr')
  @Header('Cache-Control', 'private, no-store')
  retry(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    if (Object.keys(body ?? {}).length) invalid();
    return this.service.retryOcr(r.user!, siteId, workerId, id);
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
    return this.service.analyzeDocument(r.user!, siteId, workerId, id);
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
