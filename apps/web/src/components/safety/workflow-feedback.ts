import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import { ApiError } from '@smartsite/api-client';
import { toast } from '../ui/toast-manager';

const notified = new WeakSet<object>();
export const wasWorkflowNotified = (error: unknown) =>
  typeof error === 'object' && error !== null && notified.has(error);
export function notifyWorkflowFailure(error: unknown) {
  if (
    wasWorkflowNotified(error) ||
    (error instanceof ApiError &&
      (error.code === 'cancelled' || error.backendError?.issues?.length))
  )
    return;
  if (typeof error === 'object' && error !== null) notified.add(error);
  toast.add({
    title: userErrorMessage(error),
    type: 'error',
    timeout: 8000,
    priority: 'high',
  });
}
export function notifyWorkflowSuccess() {
  toast.add({ title: tr('safetyForm.saved'), type: 'success', timeout: 5000 });
}
