import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { QrAccessService } from './qr-access.service.js';
import {
  RegisterVisitCommand,
  LookupVisitorPassCommand,
  VisitDecisionCommand,
  CameraFallbackCommand,
  IssueWorkerQrCommand,
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
  ConfirmPassageCommand,
  ManualWorkerVerificationCommand,
  ManualVisitCheckoutCommand,
} from './qr-access.commands.js';
@ApiTags('visitor-registration')
@Controller('visitor-registration')
export class VisitorRegistrationController {
  constructor(private readonly access: QrAccessService) {}
  @Get('sites') sites() {
    return this.access.publicSites();
  }
  @Get('sites/:siteId/zones') zones(@Param('siteId') siteId: string) {
    return this.access.publicZones(siteId);
  }
  @Post('sites/:siteId/visits') register(
    @Param('siteId') siteId: string,
    @Body() input: RegisterVisitCommand,
  ) {
    return this.access.register(siteId, input);
  }
  @Post('pass') pass(@Body() input: LookupVisitorPassCommand) {
    return this.access.visitorPass(input);
  }
}
@ApiTags('qr-access')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class QrAccessController {
  constructor(private readonly access: QrAccessService) {}
  @Post('visits/:visitId/manual-checkout') manualVisitCheckout(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('visitId') visitId: string,
    @Body() input: ManualVisitCheckoutCommand,
  ) {
    return this.access.manualVisitCheckout(req.user!, siteId, visitId, input);
  }
  @Post('gates/:gateId/manual-verifications') manual(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @Body() input: ManualWorkerVerificationCommand,
  ) {
    return this.access.manualWorker(req.user!, siteId, gateId, input);
  }
  @Post('access-attempts/:attemptId/confirm') confirmPassage(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('attemptId') attemptId: string,
    @Body() input: ConfirmPassageCommand,
  ) {
    return this.access.confirmPassage(req.user!, siteId, attemptId, input);
  }
  @Get('visits') visits(@Req() req: AuthenticatedRequest, @Param('siteId') siteId: string) {
    return this.access.listVisits(req.user!, siteId);
  }
  @Post('visits/:visitId/decision') decide(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('visitId') visitId: string,
    @Body() input: VisitDecisionCommand,
  ) {
    return this.access.decideVisit(req.user!, siteId, visitId, input);
  }
  @Post('worker-qr') workerPass(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() input: IssueWorkerQrCommand,
  ) {
    return this.access.workerPass(req.user!, siteId, input);
  }
  @Post('gates/:gateId/qr-fallback') fallback(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @Body() input: CameraFallbackCommand,
  ) {
    return this.access.cameraFallback(req.user!, siteId, gateId, input);
  }
  @Post('gates/:gateId/qr-verifications') workerGate(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @Body() input: VerifyWorkerQrCommand,
  ) {
    return this.access.workerGate(req.user!, siteId, gateId, input);
  }
  @Post('gates/:gateId/visitor-gate-events') visitorGate(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @Body() input: VerifyVisitorQrCommand,
  ) {
    return this.access.visitorGate(req.user!, siteId, gateId, input);
  }
}
