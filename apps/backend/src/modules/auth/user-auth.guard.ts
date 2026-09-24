import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { AuthService, type AuthenticatedRequest } from './auth.service.js';

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (Array.isArray(request.rawHeaders)) {
      let count = 0;
      for (let index = 0; index < request.rawHeaders.length; index += 2)
        if (request.rawHeaders[index]?.toLowerCase() === 'authorization') count++;
      if (count !== 1) throw new UnauthorizedException();
    }
    const header = request.headers.authorization;
    if (typeof header !== 'string') throw new UnauthorizedException();
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    if (!match?.[1]) throw new UnauthorizedException();
    const authenticated = await this.auth.authenticate(match[1]);
    request.user = authenticated.user;
    request.tokenHash = authenticated.tokenHash;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException();
    if (user.role !== UserRole.ADMIN || user.mustChangePassword) throw new ForbiddenException();
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
