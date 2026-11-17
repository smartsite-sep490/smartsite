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
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { TrackedFrameAdmission, type TrackedFrameKey } from './tracked-frame-admission.js';

import { TrackedFramePrototypeStore } from './tracked-frame-storage.js';

function workerSecret(request: Request): string {
  const header = 'x-worker-generation-secret';
  const secret = request.headers[header];
  let occurrences = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === header) occurrences++;
  if (occurrences !== 1 || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new PublicHttpException(401, {
      code: 'UNAUTHORIZED',
      message: 'Worker credential is invalid',
    });
  return secret;
}

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
