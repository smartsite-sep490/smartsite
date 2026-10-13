import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.service.js';

export function requireSiteManager(user: AuthenticatedUser | undefined, siteId: unknown): void {
  if (
    !user ||
    user.mustChangePassword ||
    typeof siteId !== 'string' ||
    !user.roleAssignments.some((r) => r.role === UserRole.SITE_MANAGER && r.siteId === siteId)
  ) {
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Site Manager access to this site is required',
    });
  }
}

@Injectable()
export class SiteManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    requireSiteManager(request.user, request.params.siteId);
    return true;
  }
}

@Injectable()
export class SiteSetupReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params: Record<string, string> }>();
    if (
      !request.user?.mustChangePassword &&
      request.user?.roleAssignments.some((r) => r.role === UserRole.ADMIN && r.siteId === null)
    )
      return true;
    requireSiteManager(request.user, request.params.siteId);
    return true;
  }
}
