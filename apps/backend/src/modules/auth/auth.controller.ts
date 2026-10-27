import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';
import { AccountResponseDto, LoginResponseDto } from '../../common/http/management-response.dto.js';
import { ErrorResponseDto } from '../../common/http/error-response.dto.js';
import { ChangePasswordThrottleGuard, UserAuthGuard } from './user-auth.guard.js';
import { passwordChangeCommandContext } from './configuration-command-context.js';
import { AuthClientType } from '../../database/entities/auth-session.entity.js';
import type { BackendEnvironment } from '../../config/environment.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../../common/configuration/password-policy.js';

const REFRESH_COOKIE = 'smartsite_refresh';
const REFRESH_TOKEN_LENGTH = 80;

class LoginDto {
  @IsString()
  @MaxLength(64)
  username!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @IsEnum(AuthClientType)
  clientType!: AuthClientType;
}

class RefreshDto {
  @IsEnum(AuthClientType)
  clientType!: AuthClientType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(REFRESH_TOKEN_LENGTH)
  refreshToken?: string;
}

class ChangePasswordDto {
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly userAuth: UserAuthGuard,
  ) {}

  private requireWebOrigin(request: Request) {
    const origin = request.headers.origin;
    if (
      typeof origin !== 'string' ||
      !this.config.get('CORS_ORIGINS', { infer: true }).includes(origin)
    )
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
  }

  private cookieToken(request: Request) {
    const values = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${REFRESH_COOKIE}=`))
      .map((part) => part.slice(REFRESH_COOKIE.length + 1));
    if (values.length > 1)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    const token = values[0];
    if (token && token.length > REFRESH_TOKEN_LENGTH)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    return token;
  }

  private refreshToken(request: Request, input: RefreshDto) {
    const cookie = this.cookieToken(request);
    const bodyHasRefreshToken = input.refreshToken !== undefined;
    if (cookie && bodyHasRefreshToken)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    if (input.clientType === AuthClientType.WEB) {
      this.requireWebOrigin(request);
      if (!cookie || bodyHasRefreshToken)
        throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        });
      return cookie;
    }
    if (cookie || !input.refreshToken)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    return input.refreshToken;
  }

  private refreshCookieOptions(): CookieOptions {
    const production = this.config.get('NODE_ENV', { infer: true }) === 'production';
    // shortcut: cross-site cookies need browser support; use a same-site proxy if cookies are blocked.
    return {
      httpOnly: true,
      sameSite: production ? 'none' : 'strict',
      secure: production,
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(response: Response, token: string, expiresAt: string) {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.refreshCookieOptions(),
      expires: new Date(expiresAt),
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
  }

  private clientResponse(
    response: Response,
    clientType: AuthClientType,
    result: Awaited<ReturnType<AuthService['login']>>,
  ): Omit<Awaited<ReturnType<AuthService['login']>>, 'refreshToken'> & {
    refreshToken?: string;
  } {
    if (clientType === AuthClientType.MOBILE) return result;
    this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
    return {
      accessToken: result.accessToken,
      tokenType: result.tokenType,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
      user: result.user,
    };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: LoginDto,
  ) {
    if (input.clientType === AuthClientType.WEB) this.requireWebOrigin(request);
    const result = await this.auth.login(input.username, input.password, input.clientType);
    return this.clientResponse(response, input.clientType, result);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: RefreshDto,
  ) {
    const token = this.refreshToken(request, input);
    const result = await this.auth.refresh(token, input.clientType);
    return this.clientResponse(response, input.clientType, result);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
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
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Body() input: ChangePasswordDto,
  ) {
    await this.auth.changePassword(
      request.user!.id,
      input.currentPassword,
      input.newPassword,
      passwordChangeCommandContext(request, this.userAuth),
    );
    this.logger.log({
      actorId: request.user!.id,
      action: 'user.change-password',
      resourceId: request.user!.id,
    });
    if (request.clientType === AuthClientType.WEB) this.clearRefreshCookie(response);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: RefreshDto,
  ) {
    const cookie = this.cookieToken(request);
    const bodyHasRefreshToken = input.refreshToken !== undefined;
    if (cookie && bodyHasRefreshToken)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    if (input.clientType === AuthClientType.WEB) {
      this.requireWebOrigin(request);
      if (bodyHasRefreshToken)
        throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        });
    } else if (cookie)
      throw new PublicHttpException(HttpStatus.UNAUTHORIZED, {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    const token = input.clientType === AuthClientType.WEB ? cookie : input.refreshToken;
    if (token) await this.auth.logout(token, input.clientType);
    if (input.clientType === AuthClientType.WEB) this.clearRefreshCookie(response);
  }
}
