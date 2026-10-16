import { ApiError } from '@smartsite/api-client';
import { translate as tr } from '../../i18n';

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return tr('auth.error.unexpected');
  if (error.code === 'network') return tr('auth.error.network');
  if (error.code === 'timeout') return tr('auth.error.timeout');
  if (error.code === 'cancelled') return tr('auth.error.cancelled');
  if (error.status === 429)
    return error.retryAfterSeconds
      ? tr('auth.error.rateLimitDelay', { seconds: error.retryAfterSeconds })
      : tr('auth.error.rateLimit');
  if (error.status && error.status >= 500) return tr('auth.error.server');
  if (error.backendError?.code === 'PASSWORD_CHANGE_REQUIRED') return tr('auth.password.required');
  if (error.status === 403) return tr('auth.error.forbidden');
  if (error.status === 401) return tr('auth.error.credentials');
  if (error.status === 400) return tr('auth.error.validation');
  if (error.code === 'invalid-response') return tr('auth.error.response');
  return tr('auth.error.unexpected');
}
