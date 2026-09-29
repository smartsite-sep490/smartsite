import { Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { FaceGateService } from './face-gate.service.js';
import type { UploadedFaceSample } from './face-enrollment.service.js';

@ApiTags('face-gate')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId/gates/:gateId/face-verifications')
export class FaceGateController {
  constructor(private readonly gate: FaceGateService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('frame', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async verify(
    @Req() request: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @UploadedFile() frame: UploadedFaceSample | undefined,
  ) {
    return this.gate.verify(request.user!, siteId, gateId, frame);
  }
}
