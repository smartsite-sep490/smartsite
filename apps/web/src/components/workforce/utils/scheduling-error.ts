import { ApiError } from '@smartsite/api-client';

/** Keep user-facing messages English and never render arbitrary server/driver text. */
export function schedulingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.backendError?.code === 'SHIFT_WORK_DATE_PASSED')
      return "This shift's work date has passed. Changes are no longer allowed.";
    if (error.status === 401) return 'Your session has expired. Please sign in again.';
    if (error.status === 403) return 'You no longer have permission to perform this action.';
    if (error.status === 409) return 'The schedule or request has changed. Refresh and try again.';
    if (error.status === 400)
      return 'Check the selected shift and enter a reason of 5 to 1000 characters.';
  }
  return 'The request could not be completed. Please try again.';
}
