import { Body, Controller, Header, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserAuthGuard } from './user-auth.guard.js';
import type { AuthenticatedRequest } from './auth.service.js';
import { AccountEmailService } from './account-email.service.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_MESSAGE,
} from '../../common/configuration/password-policy.js';

class LanguageDto {
  @IsOptional() @IsIn(['vi', 'en']) language?: 'vi' | 'en';
}
class RequestResetDto extends LanguageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;
}
class ResetPasswordDto extends RequestResetDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}
class VerifyEmailDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
class SetEmailDto extends LanguageDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;
}
@ApiTags('account-email')
@Controller('auth')
export class AccountEmailController {
  constructor(private readonly email: AccountEmailService) {}
  @Post('password-reset/request')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  request(@Body() input: RequestResetDto) {
    return this.email.requestReset(input.identifier, input.language);
  }
  @Post('password-reset/confirm')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() input: ResetPasswordDto) {
    return this.email.confirmReset(input.identifier, input.code, input.password);
  }
  @Put('email')
  @Header('Cache-Control', 'no-store')
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('user-token')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  setEmail(@Req() request: AuthenticatedRequest, @Body() input: SetEmailDto) {
    return this.email.setEmail(
      request.user!.id,
      input.email,
      input.currentPassword,
      input.language,
    );
  }
  @Post('email/verification')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('user-token')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  resend(@Req() request: AuthenticatedRequest, @Body() input: LanguageDto) {
    return this.email.resendVerification(request.user!.id, input.language);
  }
  @Post('email/verify')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @UseGuards(UserAuthGuard)
  @ApiBearerAuth('user-token')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  verify(@Req() request: AuthenticatedRequest, @Body() input: VerifyEmailDto) {
    return this.email.verify(request.user!.id, input.code);
  }
}
