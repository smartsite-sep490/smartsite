import { expect, it } from 'vitest';
import { ApiError, type BackendErrorCode } from '@smartsite/api-client';
import { accountErrorKey } from './account-utils';

function conflict(code: BackendErrorCode) {
  return new ApiError('http', 'Conflict', 409, {
    success: false,
    statusCode: 409,
    code,
    message: 'Conflict',
    requestId: 'test',
    timestamp: '',
    path: '/users',
  });
}
it('distinguishes occupied sites from last-admin protection and unknown conflicts', () => {
  expect(accountErrorKey(conflict('SITE_MANAGER_ALREADY_ASSIGNED'))).toBe(
    'accounts.errorSiteManager',
  );
  expect(accountErrorKey(conflict('LAST_ACTIVE_ADMIN_REQUIRED'))).toBe('accounts.errorLastAdmin');
  expect(accountErrorKey(conflict('CONFLICT'))).toBe('accounts.errorConflict');
});
