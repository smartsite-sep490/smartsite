import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { UserRole } from '../../../database/entities/user.entity.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../../auth/auth.service.js';

interface SiteScopedRequest extends AuthenticatedRequest {
  params?: { siteId?: string };
}

export function assertSafetySiteAccess(
  user: AuthenticatedUser | undefined,
  siteId: string | undefined,
): void {
  if (!user) throw new UnauthorizedException();
  if (user.mustChangePassword) {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Password change required',
    });
  }
  const normalizedSiteId = siteId?.toLowerCase();
  if (
    !user.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === UserRole.ADMIN && assignedSiteId === null) ||
        (role === UserRole.SAFETY_OFFICER &&
          assignedSiteId !== null &&
          normalizedSiteId !== undefined &&
          assignedSiteId.toLowerCase() === normalizedSiteId),
    )
  )
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
}

@Injectable()
export class SafetyAlertAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SiteScopedRequest>();
    assertSafetySiteAccess(request.user, request.params?.siteId);
    return true;
  }
}
