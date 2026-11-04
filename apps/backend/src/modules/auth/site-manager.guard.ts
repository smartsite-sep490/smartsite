import type { EntityManager } from 'typeorm';
import { uuid } from '../../common/configuration/commands.js';
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

/** Same Site Manager rule, rechecked and held inside an authenticated write transaction. */
export function siteManagerCommandAuthorization(siteId: string, actorUserId?: string) {
  if (actorUserId === undefined) return undefined;
  const normalizedSite = uuid(siteId).toLowerCase();
  return async (manager: EntityManager): Promise<void> => {
    const assignments = await manager.query(
      "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SITE_MANAGER' FOR SHARE",
      [actorUserId, normalizedSite],
    );
    if (!assignments.length)
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Site Manager access to this site is required',
      });
  };
}
