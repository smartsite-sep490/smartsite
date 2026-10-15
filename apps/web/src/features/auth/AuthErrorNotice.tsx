import { ApiError } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { authErrorMessage } from './auth-errors';

export function AuthErrorNotice({ error, message }: { error: unknown; message?: string }) {
  useTranslation();
  if (!error && !message) return null;
  const details = error instanceof ApiError ? error : undefined;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-500 space-y-2"
    >
      <p>{message ?? authErrorMessage(error)}</p>
      {details && (
        <details className="text-xs break-all">
          <summary className="cursor-pointer focus-visible:outline-2">
            {tr('auth.error.details')}
          </summary>
          <p>
            {details.backendError?.code ?? details.code}
            {details.status ? ` · HTTP ${details.status}` : ''}
          </p>
          {details.backendError?.requestId && (
            <p>{tr('auth.error.requestId', { id: details.backendError.requestId })}</p>
          )}
        </details>
      )}
    </div>
  );
}
