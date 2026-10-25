import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { invalid } from '../../../common/configuration/commands.js';
import { pagination } from '../../../common/http/pagination.js';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import { SafetyAlertAccessGuard } from './safety-alert-access.guard.js';
import { SafetyObservationFindingsService } from './safety-observation-findings.service.js';
import { AlertType, AlertStatus } from '../../../database/entities/enums.js';

class SubjectDto {
  @ApiProperty({ enum: ['EVENT_LOCAL'] }) kind!: 'EVENT_LOCAL';
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ minimum: 0, maximum: 255 }) personObservationIndex!: number;
}
class FindingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AlertType }) alertType!: AlertType;
  @ApiProperty() candidateSubtype!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) zoneId!: string | null;
  @ApiProperty({ enum: AlertStatus }) status!: AlertStatus;
  @ApiProperty({ minimum: 1 }) revision!: number;
}
class FindingsDto {
  @ApiProperty({ type: SubjectDto, nullable: true }) subject!: SubjectDto | null;
  @ApiProperty({ type: [FindingDto] }) items!: FindingDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
}

@ApiTags('safety-alerts')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, SafetyAlertAccessGuard)
@Controller('sites/:siteId/safety-alerts/:alertId/detections/:eventId/findings')
export class SafetyObservationFindingsController {
  constructor(private readonly findings: SafetyObservationFindingsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOkResponse({ type: FindingsDto })
  list(
    @Param('siteId') siteId: string,
    @Param('alertId') alertId: string,
    @Param('eventId') eventId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { offset, limit, ...unknown } = query;
    if (
      Object.keys(unknown).length ||
      (offset !== undefined && typeof offset !== 'string') ||
      (limit !== undefined && typeof limit !== 'string')
    )
      invalid();
    const bounds = pagination(offset as string | undefined, limit as string | undefined);
    return this.findings.list(siteId, alertId, eventId, bounds.offset, bounds.limit);
  }
}
