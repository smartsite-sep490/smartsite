import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';
import { AccountResponseDto, LoginResponseDto } from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { ChangePasswordThrottleGuard, UserAuthGuard } from './user-auth.guard.js';

class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  login(@Body() input: LoginDto) {
    return this.auth.login(input.username, input.password);
  }

  @Get('me')
  @ApiBearerAuth('user-token')
  @UseGuards(UserAuthGuard)
  @ApiOkResponse({ type: AccountResponseDto })
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth('user-token')
  @UseGuards(UserAuthGuard, ChangePasswordThrottleGuard)
  async changePassword(@Req() request: AuthenticatedRequest, @Body() input: ChangePasswordDto) {
    await this.auth.changePassword(request.user!.id, input.currentPassword, input.newPassword);
    this.logger.log({
      actorId: request.user!.id,
      action: 'user.change-password',
      resourceId: request.user!.id,
    });
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('user-token')
  @UseGuards(UserAuthGuard)
  async logout(@Req() request: AuthenticatedRequest) {
    await this.auth.logout(request.tokenHash!);
  }
}
