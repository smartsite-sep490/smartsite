import { ApiError } from '@smartsite/api-client';
import i18n, { translate } from '../../i18n';

export function visitorError(error: unknown): string {
  const code = error instanceof ApiError ? error.backendError?.code : undefined;
  if (code && i18n.exists(code)) return translate(code);
  const message = error instanceof Error ? error.message : '';
  let key = 'errors.unexpected';
  if (/changed|already been reviewed/i.test(message)) key = 'visitor.errorChanged';
  else if (/QR|credential/i.test(message)) key = 'visitor.errorQr';
  else if (/schedule|dates/i.test(message)) key = 'visitor.errorSchedule';
  else if (/no active Site Manager/i.test(message)) key = 'visitor.errorManager';
  else if (/count|headcount|group size/i.test(message)) key = 'visitor.errorCount';
  else if (
    code === 'FORBIDDEN' ||
    /Forbidden|Access to this site|approved for this gate/i.test(message)
  )
    key = 'visitor.errorForbidden';
  else if (code === 'VALIDATION_FAILED') key = 'visitor.errorValidation';
  return translate(key);
}
