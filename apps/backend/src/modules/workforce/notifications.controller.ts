import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { command, invalid } from '../../common/configuration/commands.js';
import { pagination } from '../../common/http/pagination.js';
import type { AuthenticatedRequest } from '../auth/auth.service.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { SchedulingNotificationService } from './scheduling-notification.service.js';

class NotificationQuery {
  @IsOptional()
  @IsIn(['ALL', 'UNREAD'])
  readStatus?: 'ALL' | 'UNREAD';
}

function emptyBody(body: unknown) {
  if (
    body !== undefined &&
    (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
  )
    invalid();
}

@ApiTags('notifications')
@ApiBearerAuth('user-token')
@UseGuards(UserAuthGuard)
@Controller('me/notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);
  constructor(private readonly notifications: SchedulingNotificationService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const { offset, limit, ...filter } = query;
    if (
      (offset !== undefined && typeof offset !== 'string') ||
      (limit !== undefined && typeof limit !== 'string')
    )
      invalid();
    const value = command(NotificationQuery, filter);
    const page = pagination(offset, limit);
    return this.notifications.list(request.user!, value.readStatus, page.offset, page.limit);
  }

  @Patch('read-all')
  async readAll(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    emptyBody(body);
    const result = await this.notifications.readAll(request.user!);
    this.logger.log({
      actorId: request.user!.id,
      action: 'notification.read-all',
      updated: result.updated,
    });
    return result;
  }

  @Delete('read')
  async deleteRead(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
  ) {
    emptyBody(body);
    if (Object.keys(query).length) invalid();
    const result = await this.notifications.deleteRead(request.user!);
    this.logger.log({
      actorId: request.user!.id,
      action: 'notification.delete-read',
      deleted: result.deleted,
    });
    return result;
  }

  @Patch(':id/read')
  async read(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    emptyBody(body);
    const result = await this.notifications.read(request.user!, id);
    this.logger.log({
      actorId: request.user!.id,
      action: 'notification.read',
      resourceId: result.id,
    });
    return result;
  }

  @Delete(':id')
  async delete(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    emptyBody(body);
    const result = await this.notifications.delete(request.user!, id);
    this.logger.log({
      actorId: request.user!.id,
      action: 'notification.delete',
      resourceId: result.id,
    });
    return result;
  }
}
