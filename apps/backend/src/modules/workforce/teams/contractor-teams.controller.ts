import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { ContractorTeamsService } from './contractor-teams.service.js';
import {
  ArchiveContractorTeamDto,
  AssignContractorTeamDto,
  ContractorTeamQueryDto,
  ContractorTeamWorkersQueryDto,
  CreateContractorTeamDto,
  UpdateContractorTeamDto,
  GrantTeamZoneDto,
} from './dto/contractor-team.dto.js';
@ApiTags('contractor-teams')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller()
export class ContractorTeamsController {
  @Patch('sites/:siteId/contractors/:contractorId/teams/:id/zones/:permissionId') updateZone(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @Body() input: GrantTeamZoneDto,
  ) {
    return this.teams.grantZone(req.user!, siteId, contractorId, id, input, permissionId);
  }
  @Get('sites/:siteId/contractors/:contractorId/teams/:id/zones') zones(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
  ) {
    return this.teams.zoneSetup(req.user!, siteId, contractorId, id);
  }
  @Post('sites/:siteId/contractors/:contractorId/teams/:id/zones') grantZone(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Body() input: GrantTeamZoneDto,
  ) {
    return this.teams.grantZone(req.user!, siteId, contractorId, id, input);
  }
  @Post('sites/:siteId/contractors/:contractorId/teams/:id/zones/:permissionId/revoke') revokeZone(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
  ) {
    return this.teams.revokeZone(req.user!, siteId, contractorId, id, permissionId);
  }
  constructor(private readonly teams: ContractorTeamsService) {}
  @Get('sites/:siteId/my-team') myTeam(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
  ) {
    return this.teams.myTeam(req.user!, siteId);
  }
  @Get('contractor-dashboard/scopes') scopes(@Req() req: AuthenticatedRequest) {
    return this.teams.scopes(req.user!);
  }
  @Get('sites/:siteId/contractors/:contractorId/dashboard') dashboard(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
  ) {
    return this.teams.dashboard(req.user!, siteId, contractorId);
  }
  @Get('sites/:siteId/contractors/:contractorId/teams') list(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Query() q: ContractorTeamQueryDto,
  ) {
    return this.teams.list(req.user!, siteId, contractorId, q);
  }
  @Get('sites/:siteId/contractors/:contractorId/teams/:id') detail(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
  ) {
    return this.teams.detail(req.user!, siteId, contractorId, id);
  }
  @Post('sites/:siteId/contractors/:contractorId/teams') create(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Body() input: CreateContractorTeamDto,
  ) {
    return this.teams.create(req.user!, siteId, contractorId, input);
  }
  @Patch('sites/:siteId/contractors/:contractorId/teams/:id') update(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Body() input: UpdateContractorTeamDto,
  ) {
    return this.teams.update(req.user!, siteId, contractorId, id, input);
  }
  @Post('sites/:siteId/contractors/:contractorId/teams/:id/archive') archive(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('id') id: string,
    @Body() input: ArchiveContractorTeamDto,
  ) {
    return this.teams.archive(req.user!, siteId, contractorId, id, input);
  }
  @Get('sites/:siteId/contractors/:contractorId/team-workers') workers(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Query() q: ContractorTeamWorkersQueryDto,
  ) {
    return this.teams.workers(req.user!, siteId, contractorId, q);
  }
  @Put('sites/:siteId/contractors/:contractorId/team-workers/:workerId/team') assign(
    @Req() req: AuthenticatedRequest,
    @Param('siteId') siteId: string,
    @Param('contractorId') contractorId: string,
    @Param('workerId') workerId: string,
    @Body() input: AssignContractorTeamDto,
  ) {
    return this.teams.assign(req.user!, siteId, contractorId, workerId, input);
  }
}
