import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { configurationCommandContext } from '../auth/configuration-command-context.js';
import { pagination } from '../../common/http/pagination.js';
import { CreateGateDto, GatesService, UpdateGateDto } from './gates.service.js';

import {
  GateDto,
  GatePageDto,
  GateSourcePageDto,
  PublicGatePageDto,
} from './gates-response.dto.js';

@Injectable()
export class GateReadGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: { siteId: string }; method: string }>();
    const read = request.method === 'GET' || request.method === 'HEAD';
    const allowed =
      request.user &&
      !request.user.mustChangePassword &&
      request.user.roleAssignments.some(
        (r) =>
          (read && r.role === UserRole.ADMIN && r.siteId === null) ||
          (r.siteId === request.params.siteId?.toLowerCase() &&
            (r.role === UserRole.SITE_MANAGER ||
              (read && [UserRole.SAFETY_OFFICER, UserRole.SECURITY_OFFICER].includes(r.role)))),
      );
    if (!allowed)
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Gate access is outside your Site or role',
      });
    return true;
  }
}
@ApiTags('gates')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard, GateReadGuard)
@Controller('sites/:siteId/gates')
export class GatesController {
  constructor(
    private readonly gates: GatesService,
    private readonly auth: UserAuthGuard,
  ) {}
  @ApiOkResponse({ type: GatePageDto })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const p = pagination(offset, limit);
    return this.gates.list(siteId, p.offset, p.limit, status);
  }
  @ApiOkResponse({ type: GateDto })
  @Get(':gateId')
  get(@Param('siteId') siteId: string, @Param('gateId') gateId: string) {
    return this.gates.get(siteId, gateId);
  }
  @ApiOkResponse({ type: GateSourcePageDto })
  @Get(':gateId/sources')
  sources(@Param('siteId') siteId: string, @Param('gateId') gateId: string) {
    return this.gates.sources(siteId, gateId);
  }
  @ApiCreatedResponse({ type: GateDto })
  @Post()
  create(
    @Param('siteId') siteId: string,
    @Body() input: CreateGateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.gates.create(siteId, input, configurationCommandContext(request, this.auth));
  }
  @ApiOkResponse({ type: GateDto })
  @Patch(':gateId')
  update(
    @Param('siteId') siteId: string,
    @Param('gateId') gateId: string,
    @Body() input: UpdateGateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.gates.update(
      siteId,
      gateId,
      input,
      configurationCommandContext(request, this.auth),
    );
  }
}
@ApiTags('visitor-registration')
@Controller('visitor-registration/sites/:siteId/gates')
export class PublicGatesController {
  constructor(private readonly gates: GatesService) {}
  @ApiOkResponse({ type: PublicGatePageDto })
  @Get()
  list(@Param('siteId') siteId: string) {
    return this.gates.publicList(siteId);
  }
}
