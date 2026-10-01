import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn } from 'class-validator';
import type { EnrollmentCaptureTarget } from '@smartsite/contracts';

class FaceQualityCommand {
  @IsIn(['front', 'left', 'right'])
  target: EnrollmentCaptureTarget = 'front';
}
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import {
  FaceEnrollmentSessionResponseDto,
  FaceEnrollmentQualityResponseDto,
  FaceProfileResponseDto,
} from '../../common/http/management-response.dto.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  FaceEnrollmentService,
  StartFaceEnrollmentCommand,
  type UploadedFaceSample,
} from './face-enrollment.service.js';

function sessionResponse(session: {
  id: string;
  workerId: string;
  consentVersion: string;
  status: string;
  acceptedSampleCount: number;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: session.id,
    workerId: session.workerId,
    consentVersion: session.consentVersion,
    status: session.status,
    acceptedSampleCount: session.acceptedSampleCount,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
  };
}

function profileResponse(profile: {
  id: string;
  workerId: string;
  userId: string | null;
  modelVersion: string;
  status: string;
  consentVersion: string;
  consentedAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}) {
  return {
    id: profile.id,
    workerId: profile.workerId,
    userId: profile.userId,
    modelVersion: profile.modelVersion,
    status: profile.status,
    consentVersion: profile.consentVersion,
    consentedAt: profile.consentedAt,
    createdAt: profile.createdAt,
    revokedAt: profile.revokedAt,
  };
}

@ApiTags('face-enrollment')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard)
@Controller()
export class FaceEnrollmentController {
  private readonly logger = new Logger(FaceEnrollmentController.name);

  constructor(private readonly enrollment: FaceEnrollmentService) {}

  @Post('workers/:workerId/face-enrollments')
  @ApiCreatedResponse({ type: FaceEnrollmentSessionResponseDto })
  async start(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @Body() input: StartFaceEnrollmentCommand,
  ) {
    const session = await this.enrollment.start(request.user!, workerId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'face-enrollment.start',
      resourceId: session.id,
      workerId: session.workerId,
    });
    return sessionResponse(session);
  }

  @Post('face-enrollments/:sessionId/samples')
  @ApiOkResponse({ type: FaceEnrollmentSessionResponseDto })
  @UseInterceptors(FileInterceptor('sample', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async submitSample(
    @Req() request: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @UploadedFile() sample: UploadedFaceSample | undefined,
  ) {
    return sessionResponse(await this.enrollment.submitSample(request.user!, sessionId, sample));
  }

  @Post('workers/:workerId/face-enrollment-quality')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: FaceEnrollmentQualityResponseDto })
  @UseInterceptors(FileInterceptor('sample', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  async assessSampleQuality(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @UploadedFile() sample: UploadedFaceSample | undefined,
    @Body() input: FaceQualityCommand,
  ) {
    return this.enrollment.assessSampleQuality(request.user!, workerId, sample, input.target);
  }

  @Post('face-enrollments/:sessionId/complete')
  @ApiOkResponse({ type: FaceProfileResponseDto })
  async complete(@Req() request: AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    const profile = await this.enrollment.complete(request.user!, sessionId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'face-enrollment.complete',
      resourceId: profile.id,
      workerId: profile.workerId,
    });
    return profileResponse(profile);
  }

  @Get('workers/:workerId/face-profile')
  @ApiOkResponse({ type: FaceProfileResponseDto })
  async getProfile(@Req() request: AuthenticatedRequest, @Param('workerId') workerId: string) {
    return profileResponse(await this.enrollment.getProfile(request.user!, workerId));
  }

  @Post('workers/:workerId/face-profile/revoke')
  @ApiOkResponse({ type: FaceProfileResponseDto })
  async revoke(@Req() request: AuthenticatedRequest, @Param('workerId') workerId: string) {
    const profile = await this.enrollment.revokeProfile(request.user!, workerId);
    this.logger.log({
      actorId: request.user!.id,
      action: 'face-profile.revoke',
      resourceId: profile.id,
      workerId: profile.workerId,
    });
    return profileResponse(profile);
  }
}
