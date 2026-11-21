import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { invalid } from '../../common/configuration/commands.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { TrackedFrameEvidenceUpload } from './tracked-frame-evidence-upload.js';
import { readWorkerGenerationSecret } from './worker-generation-secret.js';

@Controller('integrations/ai')
@UseGuards(ServiceAuthGuard)
export class TrackedFrameEvidenceController {
  constructor(
    private readonly source: DataSource,
    private readonly upload: TrackedFrameEvidenceUpload,
  ) {}

  @Post('tracked-parts/evidence')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(
    FileInterceptor('frame', {
      limits: { files: 1, fileSize: 1_048_576, fields: 3, fieldSize: 1_048_576, parts: 4 },
    }),
  )
  async store(
    @Req() request: Request,
    @Body() body: unknown,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    const secret = readWorkerGenerationSecret(request);
    if (Object.keys(request.query).length)
      invalid('Evidence upload accepts no query configuration');
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid();
    const envelope = body as Record<string, unknown>;
    if (
      Object.keys(envelope).length !== 3 ||
      envelope.schemaVersion !== '1.0.0' ||
      typeof envelope.event !== 'string' ||
      typeof envelope.context !== 'string' ||
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.mimetype !== 'image/jpeg'
    )
      invalid('Evidence upload envelope is invalid');
    let event: unknown;
    let context: unknown;
    try {
      event = JSON.parse(envelope.event as string);
      context = JSON.parse(envelope.context as string);
    } catch {
      invalid('Evidence upload JSON is invalid');
    }
    return this.upload.store(this.source, event, context, secret, file.buffer);
  }
}
