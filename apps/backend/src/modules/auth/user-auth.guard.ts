import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await this.authenticateRequest(request);
    return true;
  }

  /** Same strict boundary for late private reads and transactional mutation claims. */
  async authenticateRequest(request: AuthenticatedRequest, manager?: EntityManager): Promise<void> {
    if (Array.isArray(request.rawHeaders)) {
      let count = 0;
      for (let index = 0; index < request.rawHeaders.length; index += 2)
        if (request.rawHeaders[index]?.toLowerCase() === 'authorization') count++;
      if (count !== 1) throw new UnauthorizedException();
    }
    const header = request.headers.authorization;
    if (typeof header !== 'string') throw new UnauthorizedException();
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
    if (!match?.[1]) throw new UnauthorizedException();
    const authenticated = await this.auth.authenticate(match[1], manager);
    request.user = authenticated.user;
    request.sessionId = authenticated.sessionId;
    request.clientType = authenticated.clientType;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException();
    if (user.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    if (
      !user.roleAssignments.some(({ role, siteId }) => role === UserRole.ADMIN && siteId === null)
    )
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    return true;
  }
}

@Injectable()
export class ChangePasswordThrottleGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException();
    const { isBlocked, timeToBlockExpire } = await this.storage.increment(
      `change-password:${user.id}`,
      60_000,
      5,
      60_000,
      'change-password',
    );
    if (isBlocked) {
      context
        .switchToHttp()
        .getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader('Retry-After', String(Math.max(1, timeToBlockExpire)));
      throw new PublicHttpException(HttpStatus.TOO_MANY_REQUESTS, {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
      });
    }
    return true;
  }
}
