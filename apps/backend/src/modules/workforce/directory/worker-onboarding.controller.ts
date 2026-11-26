import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Req,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { invalid } from '../../../common/configuration/commands.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { configurationCommandContext } from '../../auth/configuration-command-context.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { DOCUMENT_KINDS } from '../documents/worker-compliance.js';
import type { DocumentUpload } from '../documents/worker-document-file.js';
import { WorkerOnboardingService } from './worker-onboarding.service.js';

@ApiTags('contractor-workers')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/contractors/:contractorId/worker-onboarding-drafts')
export class WorkerOnboardingController {
  constructor(
    private readonly onboarding: WorkerOnboardingService,
    private readonly userAuth: UserAuthGuard,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
  ) {
    return this.onboarding.list(request.user!, siteId, contractorId);
  }

  @Put(':id')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileFieldsInterceptor(
      DOCUMENT_KINDS.map((name) => ({ name, maxCount: 1 })),
      { limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 1, parts: 4, fieldSize: 16384 } },
    ),
  )
  save(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Body() body: { metadata?: string },
    @UploadedFiles() files: Record<string, DocumentUpload[]> = {},
  ) {
    if (!body || typeof body.metadata !== 'string' || Object.keys(body).length !== 1)
      invalid('Invalid worker intake draft');
    let input: unknown;
    try {
      input = JSON.parse(body.metadata);
    } catch {
      invalid('Invalid worker intake draft');
    }
    return this.onboarding.save(
      request.user!,
      siteId,
      contractorId,
      id,
      input,
      Object.fromEntries(Object.entries(files).map(([kind, values]) => [kind, values[0]])),
      configurationCommandContext(request, this.userAuth),
    );
  }

  @Get(':id/documents/:kind/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ) {
    const { bytes, mediaType } = await this.onboarding.file(
      request.user!,
      siteId,
      contractorId,
      id,
      kind,
    );
    return new StreamableFile(bytes, { type: mediaType, length: bytes.length });
  }

  @Post('provision')
  @Header('Cache-Control', 'private, no-store')
  provisionBatch(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() input: unknown,
  ) {
    return this.onboarding.provisionBatch(
      request.user!,
      siteId,
      contractorId,
      input,
      configurationCommandContext(request, this.userAuth),
    );
  }
}
