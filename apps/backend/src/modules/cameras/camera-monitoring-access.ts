import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { UserRole } from '../../database/entities/user.entity.js';
import type { AuthenticatedUser } from '../auth/auth.service.js';

/** Camera reads only; Safety case/evidence permissions remain Officer-owned. */
export function assertCameraMonitoringSiteAccess(
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
  const requestedSite = siteId?.toLowerCase();
  if (
    !user.isActive ||
    !requestedSite ||
    !user.roleAssignments.some(
      ({ role, siteId: assignedSite }) =>
        (role === UserRole.SITE_MANAGER || role === UserRole.SAFETY_OFFICER) &&
        assignedSite !== null &&
        assignedSite.toLowerCase() === requestedSite,
    )
  ) {
    throw new PublicHttpException(HttpStatus.FORBIDDEN, {
      code: 'FORBIDDEN',
      message: 'Forbidden',
    });
  }
}
