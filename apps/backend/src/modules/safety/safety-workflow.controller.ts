import {
  Body,
  Controller,
  Get,
  Header,
  Param,
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
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { pagination } from '../../common/http/pagination.js';
import { invalid, missing } from '../../common/configuration/commands.js';
import { SafetyWorkflowService } from './safety-workflow.service.js';
import { MAX_SAFETY_UPLOAD, type SafetyUpload } from './safety-upload.service.js';
import { SafetyAlertQueryService } from './alerts/safety-alert-query.service.js';
import { SafetyAlertEvidenceService } from './alerts/safety-alert-evidence.service.js';
import { alertResponse } from './alerts/safety-alert-response.js';

@ApiTags('MF08 safety workflow')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('sites/:siteId')
export class SafetyWorkflowController {
  constructor(
    private readonly workflow: SafetyWorkflowService,
    private readonly alerts: SafetyAlertQueryService,
    private readonly cameraEvidence: SafetyAlertEvidenceService,
  ) {}
  @Header('Cache-Control', 'private, no-store')
  @Get('safety-assignees')
  assignees(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('role') role: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const page = pagination(offset, limit);
    return this.workflow.assignees(siteId, req.user!.id, role, page.offset, page.limit);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('incidents')
  incidents(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    const page = pagination(offset, limit);
    return this.workflow.listIncidents(
      siteId,
      req.user!.id,
      page.offset,
      page.limit,
      status,
      assignedTo,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents')
  createIncident(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.createIncident(siteId, req.user!.id, body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('incidents/:id')
  incident(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return this.workflow.getIncident(siteId, id, req.user!.id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('incidents/:id/actions')
  async actions(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
  ) {
    return (await this.workflow.getIncident(siteId, id, req.user!.id)).actions;
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/alerts')
  link(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'link', body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/actions')
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'assign', body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/close')
  close(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'close', body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/reopen')
  reopen(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'reopen', body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/actions/:actionId/start')
  start(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'start', body, actionId);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/actions/:actionId/submissions')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SAFETY_UPLOAD, files: 1, fields: 3, fieldSize: 12000, parts: 4 },
    }),
  )
  submit(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
    @UploadedFile() file?: SafetyUpload,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'submit', body, actionId, file);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('incidents/:id/actions/:actionId/reviews')
  review(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('actionId') actionId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.incidentCommand(siteId, id, req.user!.id, 'review', body, actionId);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('incidents/:id/alerts/:alertId')
  async alert(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('alertId') alertId: string,
  ) {
    await this.workflow.linkedAlert(siteId, id, req.user!.id, alertId);
    const result = await this.alerts.get(siteId, alertId);
    return {
      ...alertResponse(result.alert),
      detections: result.detections,
      detectionsTotal: result.detectionsTotal,
      reviews: result.reviews,
      reviewsTotal: result.reviewsTotal,
    };
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('incidents/:id/alerts/:alertId/detections/:eventId/evidence/:index')
  @Header('X-Content-Type-Options', 'nosniff')
  async alertEvidence(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Param('index') index: string,
  ) {
    await this.workflow.linkedAlert(siteId, id, req.user!.id, alertId);
    const evidence = await this.cameraEvidence.read(siteId, alertId, eventId, index);
    return new StreamableFile(evidence.bytes, {
      type: 'image/jpeg',
      length: evidence.bytes.length,
    });
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('safety-tasks')
  tasks(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
  ) {
    const page = pagination(offset, limit);
    return this.workflow.listTasks(
      siteId,
      req.user!.id,
      page.offset,
      page.limit,
      status,
      assignedTo,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('safety-tasks')
  createTask(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Body() body: unknown,
  ) {
    return this.workflow.createTask(siteId, req.user!.id, body);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get('safety-tasks/:id')
  task(@Req() req: AuthenticatedRequest, @Param('siteId') siteId: string, @Param('id') id: string) {
    return this.workflow.getTask(siteId, id, req.user!.id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('safety-tasks/:id/submissions')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_SAFETY_UPLOAD, files: 1, fields: 3, fieldSize: 12000, parts: 4 },
    }),
  )
  submitTask(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file?: SafetyUpload,
  ) {
    return this.workflow.taskCommand(siteId, id, req.user!.id, 'submit', body, file);
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('safety-tasks/:id/:operation')
  taskCommand(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Param('operation') operation: string,
    @Body() body: unknown,
  ) {
    if (!['start', 'verify', 'return', 'cancel'].includes(operation))
      return invalid('Invalid task command');
    return this.workflow.taskCommand(
      siteId,
      id,
      req.user!.id,
      operation as 'start' | 'verify' | 'return' | 'cancel',
      body,
    );
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':type/:id/evidence/:evidenceId')
  @Header('X-Content-Type-Options', 'nosniff')
  async evidence(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('type') type: string,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    if (type !== 'incidents' && type !== 'safety-tasks') missing();
    const bytes = await this.workflow.evidence(
      siteId,
      id,
      req.user!.id,
      type === 'incidents' ? 'INCIDENT' : 'SAFETY_TASK',
      evidenceId,
    );
    return new StreamableFile(bytes, { type: 'image/jpeg', length: bytes.length });
  }
}
