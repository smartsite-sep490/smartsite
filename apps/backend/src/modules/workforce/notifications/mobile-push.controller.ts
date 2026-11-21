import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { UserAuthGuard } from '../../auth/user-auth.guard.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';
import { MobilePushService } from './mobile-push.service.js';
class DeviceSecretDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) installationSecret!: string;
}
class RegisterPushDto extends DeviceSecretDto {
  @IsString()
  @MaxLength(256)
  @Matches(/^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]+\]$/)
  expoPushToken!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
  @IsIn(['vi', 'en']) language!: 'vi' | 'en';
}
@ApiTags('mobile-push')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('me/push-devices')
export class MobilePushController {
  constructor(private readonly push: MobilePushService) {}
  @Get() settings(@Req() request: AuthenticatedRequest) {
    return this.push.settings(request.user!);
  }
  @Put(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  register(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: RegisterPushDto,
  ) {
    return this.push.register(request.user!, request.sessionId, id, input);
  }
  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() input: DeviceSecretDto,
  ) {
    return this.push.remove(request.user!, id, input.installationSecret);
  }
}
