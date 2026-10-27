import { UnauthorizedException } from '@nestjs/common';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { MainConfigurationCommandContext } from '../../common/configuration/main-configuration-authority.js';
import type { AuthenticatedRequest } from './auth.service.js';
import type { UserAuthGuard } from './user-auth.guard.js';

/** No DTO actor: recheck the original bearer/account inside the actual write transaction. */
export function configurationCommandContext(
  request: AuthenticatedRequest,
  auth: UserAuthGuard,
): MainConfigurationCommandContext {
  return authenticatedCommandContext(request, auth, false);
}

/** An active temporary-password user may change their own password, without Admin permission. */
export function passwordChangeCommandContext(
  request: AuthenticatedRequest,
  auth: UserAuthGuard,
): MainConfigurationCommandContext {
  return authenticatedCommandContext(request, auth, true);
}

function authenticatedCommandContext(
  request: AuthenticatedRequest,
  auth: UserAuthGuard,
  allowTemporaryPassword: boolean,
): MainConfigurationCommandContext {
  if (!request.user) throw new UnauthorizedException();
  const actorUserId = request.user.id;
  return {
    actorUserId,
    reauthorize: async (manager) => {
      await auth.authenticateRequest(request, manager);
      if (request.user?.id !== actorUserId) throw new UnauthorizedException();
      if (request.user.mustChangePassword && !allowTemporaryPassword)
        throw new PublicHttpException(403, {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Password change required',
        });
    },
  };
}
