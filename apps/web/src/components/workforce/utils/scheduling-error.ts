import { translate as tr } from '../../../i18n';
import { ApiError } from '@smartsite/api-client';

/** Keep user-facing messages English and never render arbitrary server/driver text. */
export function schedulingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.backendError?.code === 'SHIFT_WORK_DATE_PASSED')
      return tr('workforce_schedule_tab.this_shift_has_ended_changes_are_no_longer_allowed');
    if (error.status === 401)
      return tr('scheduling-error.your_session_has_expired_please_sign_in_again');
    if (error.status === 403)
      return tr('scheduling-error.you_no_longer_have_permission_to_perform_this_action');
    if (error.status === 409)
      return tr('scheduling-error.the_schedule_or_request_has_changed_refresh_and_try_again');
    if (error.status === 400)
      return tr(
        'scheduling-error.check_the_selected_shift_and_enter_a_reason_of_5_to_1000_characters',
      );
  }
  return tr('scheduling-error.the_request_could_not_be_completed_please_try_again');
}
