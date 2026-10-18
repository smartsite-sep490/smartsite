import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { invalid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { WorkerDocumentsService, type DocumentUpload } from './worker-documents.service.js';
import {
  ReviewWorkerDocumentDto,
  WorkerComplianceQueryDto,
  UploadWorkerDocumentDto,
  UpdateWorkerDocumentExpiryDto,
} from './worker-documents.commands.js';

@ApiTags('worker-documents')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class WorkerDocumentsController {
  constructor(private readonly service: WorkerDocumentsService) {}
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
  @Post('workers/:workerId/identity-images/:side')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    }),
  )
  identity(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('side') side: string,
    @UploadedFile() file: DocumentUpload,
  ) {
    return this.service.uploadIdentity(r.user!, siteId, workerId, side, file);
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
  @Post('workers/:workerId/documents/:kind')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
    }),
  )
  upload(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: DocumentUpload,
    @Body() body: UploadWorkerDocumentDto,
  ) {
    return this.service.upload(r.user!, siteId, workerId, kind, file, body);
  }
  @Patch('workers/:workerId/documents/:id/submitted-expiry')
  @Header('Cache-Control', 'private, no-store')
  updateSubmittedExpiry(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: UpdateWorkerDocumentExpiryDto,
  ) {
    return this.service.updateSubmittedExpiry(r.user!, siteId, workerId, id, body);
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
  @Post('workers/:workerId/documents/:id/reviews')
  @Header('Cache-Control', 'private, no-store')
  review(
    @Req() r: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('workerId') workerId: string,
    @Param('id') id: string,
    @Body() body: ReviewWorkerDocumentDto,
  ) {
    return this.service.review(r.user!, siteId, workerId, id, body);
  }
}
