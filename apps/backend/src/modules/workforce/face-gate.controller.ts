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
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { FaceGateService } from './face-gate.service.js';
import type { UploadedFaceSample } from './face-enrollment.service.js';

class GateVerificationCommand {
  @IsIn(['IN', 'OUT'])
  direction: 'IN' | 'OUT' = 'IN';
}
class GatePresenceCommand {
  @IsUUID()
  sessionId!: string;
}

@ApiTags('face-gate')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/gates/:gateId')
export class FaceGateController {
  constructor(private readonly gate: FaceGateService) {}
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
    return this.gate.observe(request.user!, siteId, gateId, input.sessionId, frame);
  }

  @Get('access-logs')
  listLogs(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
  ) {
    return this.gate.listLogs(request.user!, siteId, gateId);
  }

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
    return this.gate.verify(request.user!, siteId, gateId, frame, input.direction);
  }
}
