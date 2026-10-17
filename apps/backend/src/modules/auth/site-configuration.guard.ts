import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedRequest } from './auth.service.js';

/** Site managers own operational configuration; administrators observe it. */
@Injectable()
export class SiteConfigurationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        params: { siteId?: string };
        method: string;
      }
    >();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    const readOnly = ['GET', 'HEAD'].includes(request.method);
    const siteId = request.params.siteId?.toLowerCase();
    const allowed = user.roleAssignments.some(
      (r) =>
        (readOnly && r.role === UserRole.ADMIN && r.siteId === null) ||
        (r.siteId !== null &&
          r.siteId.toLowerCase() === siteId &&
          (r.role === UserRole.SITE_MANAGER || (readOnly && r.role === UserRole.SAFETY_OFFICER))),
    );
    if (user.mustChangePassword || !allowed)
      throw new PublicHttpException(403, {
        code: user.mustChangePassword ? 'PASSWORD_CHANGE_REQUIRED' : 'FORBIDDEN',
        message: 'Forbidden',
      });
    return true;
  }
}
