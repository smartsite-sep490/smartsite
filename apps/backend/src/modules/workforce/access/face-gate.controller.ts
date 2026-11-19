import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IsIn, IsUUID } from 'class-validator';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags, ApiBody } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { FaceGateService } from './face-gate.service.js';
import type { UploadedFaceSample } from '../identity/face-enrollment.service.js';

class GateVerificationCommand {
  @IsUUID() sourceCameraId!: string;
  @IsIn(['IN', 'OUT'])
  direction: 'IN' | 'OUT' = 'IN';
}
class GatePresenceCommand {
  @IsUUID() sourceCameraId!: string;
  @IsUUID()
  sessionId!: string;
}

@ApiTags('face-gate')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/gates/:gateId')
export class FaceGateController {
  constructor(private readonly gate: FaceGateService) {}
  @ApiBody({
    schema: {
      type: 'object',
      required: ['frame', 'sessionId', 'sourceCameraId'],
      properties: {
        frame: { type: 'string', format: 'binary' },
        sessionId: { type: 'string', format: 'uuid' },
        sourceCameraId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @Post('face-presence')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('frame', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  observe(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @UploadedFile() frame: UploadedFaceSample | undefined,
    @Body() input: GatePresenceCommand,
  ) {
    return this.gate.observe(
      request.user!,
      siteId,
      gateId,
      input.sessionId,
      frame,
      input.sourceCameraId,
    );
  }

  @Get('access-logs')
  listLogs(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
  ) {
    return this.gate.listLogs(request.user!, siteId, gateId);
  }

  @ApiBody({
    schema: {
      type: 'object',
      required: ['frame', 'direction', 'sourceCameraId'],
      properties: {
        frame: { type: 'string', format: 'binary' },
        direction: { type: 'string', enum: ['IN', 'OUT'] },
        sourceCameraId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @Post('face-verifications')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('frame', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async verify(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @UploadedFile() frame: UploadedFaceSample | undefined,
    @Body() input: GateVerificationCommand,
  ) {
    return this.gate.verify(
      request.user!,
      siteId,
      gateId,
      frame,
      input.direction,
      input.sourceCameraId,
    );
  }
}
