import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { UserRole } from '../../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';

interface SiteScopedRequest extends AuthenticatedRequest {
  params?: { siteId?: string };
}

@Injectable()
export class SafetyAlertAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SiteScopedRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    if (user.mustChangePassword) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    }
    const siteId = request.params?.siteId;
    const normalizedSiteId = siteId?.toLowerCase();
    const allowed = user.roleAssignments.some(
      ({ role, siteId: assignedSiteId }) =>
        (role === UserRole.ADMIN && assignedSiteId === null) ||
        (role === UserRole.SAFETY_OFFICER &&
          assignedSiteId !== null &&
          normalizedSiteId !== undefined &&
          assignedSiteId.toLowerCase() === normalizedSiteId),
    );
    if (!allowed) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }
    return true;
  }
}
