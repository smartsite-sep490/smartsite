import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { UserRole } from '../../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../../auth/auth.service.js';

/** Separate capability: general alert access, including Admin, never grants identity review. */
@Injectable()
export class ObservationIdentityAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params?: { siteId?: string } }>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    if (user.mustChangePassword)
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    const siteId = request.params?.siteId?.toLowerCase();
    if (
      !user.isActive ||
      !siteId ||
      !user.roleAssignments.some(
        ({ role, siteId: assignedSite }) =>
          role === UserRole.SAFETY_OFFICER &&
          assignedSite !== null &&
          assignedSite.toLowerCase() === siteId,
      )
    )
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    return true;
  }
}
