import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AccountPageResponseDto,
  AccountResponseDto,
} from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { pagination } from '../../common/http/pagination.js';
import { type AuthenticatedRequest } from '../auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../auth/user-auth.guard.js';
import {
  CreateUserDto,
  ResetPasswordDto,
  SetUserStatusDto,
  UsersService,
} from './users.service.js';

@ApiTags('users')
@ApiBearerAuth('user-token')
@ApiBadRequestResponse({ type: ErrorResponseDto })
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@ApiForbiddenResponse({ type: ErrorResponseDto })
@ApiNotFoundResponse({ type: ErrorResponseDto })
@ApiConflictResponse({ type: ErrorResponseDto })
@ApiTooManyRequestsResponse({ type: ErrorResponseDto })
@ApiServiceUnavailableResponse({ type: ErrorResponseDto })
@UseGuards(UserAuthGuard, AdminGuard)
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);
  constructor(private readonly users: UsersService) {}

  @Post()
  @ApiCreatedResponse({ type: AccountResponseDto })
  async create(@Req() request: AuthenticatedRequest, @Body() input: CreateUserDto) {
    const user = await this.users.create(input);
    this.logger.log({ actorId: request.user!.id, action: 'user.create', resourceId: user.id });
    return user;
  }

  @Get()
  @ApiOkResponse({ type: AccountPageResponseDto })
  list(@Query('offset') offset?: string, @Query('limit') limit?: string) {
    const value = pagination(offset, limit);
    return this.users.list(value.offset, value.limit);
  }

  @Get(':userId')
  @ApiOkResponse({ type: AccountResponseDto })
  get(@Param('userId') userId: string) {
    return this.users.get(userId);
  }

  @Patch(':userId/status')
  @ApiOkResponse({ type: AccountResponseDto })
  async setStatus(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() input: SetUserStatusDto,
  ) {
    const user = await this.users.setStatus(request.user!.id, userId, input);
    this.logger.log({ actorId: request.user!.id, action: 'user.status', resourceId: user.id });
    return user;
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  async resetPassword(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() input: ResetPasswordDto,
  ) {
    await this.users.resetPassword(userId, input);
    this.logger.log({
      actorId: request.user!.id,
      action: 'user.reset-password',
      resourceId: userId,
    });
  }
}
