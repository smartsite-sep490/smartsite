import { useTranslation } from 'react-i18next';
import { authErrorMessage } from './auth-errors';

export function AuthErrorNotice({ error, message }: { error: unknown; message?: string }) {
  useTranslation();
  if (!error && !message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-500 space-y-2"
    >
      <p>{message ?? authErrorMessage(error)}</p>
    </div>
  );
}
