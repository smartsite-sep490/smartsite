import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { invalid, missing, uuid } from '../../common/configuration/commands.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { TrackedFrameAdmission, type TrackedFrameKey } from './tracked-frame-admission.js';

import { TrackedFramePrototypeStore } from './tracked-frame-storage.js';
import { readWorkerGenerationSecret as workerSecret } from './worker-generation-secret.js';

/** Prototype endpoint. Register only with an explicitly configured tracked admission provider. */
@Controller('integrations/ai')
@UseGuards(ServiceAuthGuard)
export class TrackedFrameResultController {
  constructor(
    private readonly source: DataSource,
    private readonly admission: TrackedFrameAdmission,
  ) {}

  @Get(
    'cameras/:cameraId/generations/:generationId/sessions/:streamSessionId/tracked-frames/:frameId/result',
  )
  @Header('Cache-Control', 'no-store')
  async read(@Req() request: Request, @Param() params: TrackedFrameKey) {
    const secret = workerSecret(request);
    if (Object.keys(request.query).length) invalid('Tracked result accepts no query configuration');

    const key = {
      cameraId: uuid(params.cameraId).toLowerCase(),
      generationId: uuid(params.generationId).toLowerCase(),
      streamSessionId: uuid(params.streamSessionId).toLowerCase(),
      frameId: uuid(params.frameId).toLowerCase(),
    };
    const result = await this.admission.readSealed(this.source, key, secret);
    if (!result) missing();
    return result;
  }
}

/** Prototype raw-only endpoint. Registration requires the separate raw storage provider. */
@Controller('integrations/ai')
@UseGuards(ServiceAuthGuard)
export class TrackedRawPartController {
  constructor(
    private readonly source: DataSource,
    private readonly store: TrackedFramePrototypeStore,
  ) {}

  @Post('tracked-parts')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async postPart(@Req() request: Request, @Body() body: unknown) {
    const secret = workerSecret(request);
    if (Object.keys(request.query).length) invalid('Tracked parts accept no query configuration');
    if (!body || typeof body !== 'object' || Array.isArray(body))
      invalid('Tracked part envelope is invalid');
    const envelope = body as Record<string, unknown>;
    if (
      Object.keys(envelope).length !== 3 ||
      envelope.schemaVersion !== '1.0.0' ||
      !Object.hasOwn(envelope, 'event') ||
      !Object.hasOwn(envelope, 'context')
    )
      invalid('Tracked part envelope is invalid');
    const { receipt } = await this.store.store(
      this.source,
      envelope.event,
      envelope.context,
      secret,
    );
    return receipt;
  }
}
