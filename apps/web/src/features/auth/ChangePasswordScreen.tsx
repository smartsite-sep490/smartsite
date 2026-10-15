import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { AuthErrorNotice } from './AuthErrorNotice';
import { authErrorMessage } from './auth-errors';
import { useManagementClient, useAuth, useLogout } from './auth-session';

export function ChangePasswordScreen({
  apiUrl,
  onComplete,
  onCancel,
}: {
  apiUrl: string;
  onComplete: () => void;
  onCancel?: () => void;
}) {
  useTranslation();

  const { manager, accessToken, setAccessToken, dismissSessionExpired } = useAuth();
  const cache = useQueryClient();
  const client = useManagementClient(apiUrl);
  const logout = useLogout(apiUrl);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [validationError, setValidationError] = useState('');
  const change = useMutation({
    mutationFn: () => client.changePassword(accessToken!, currentPassword, newPassword),
    onSuccess: async () => {
      await cache.cancelQueries();
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      if (manager) manager.signOutLocally(true);
      else {
        sessionStorage.setItem('smartsite:signed-out', 'true');
        setAccessToken(null);
      }
      dismissSessionExpired();
      cache.clear();
      cache.setQueryData(['auth', 'session'], null);
      onComplete();
    },
  });
  const errorMessage =
    validationError ||
    (change.error instanceof ApiError && change.error.status === 401
      ? tr('auth.password.rejected')
      : change.error instanceof ApiError &&
          (change.error.code === 'network' ||
            change.error.code === 'timeout' ||
            (change.error.status !== undefined && change.error.status >= 500))
        ? `${tr('auth.password.unverified')} ${authErrorMessage(change.error)}`
        : undefined);
  const busy = change.isPending || logout.isPending;

  return (
    <main className="min-h-screen bg-[#071A2B] flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher dark />
      </div>
      <section
        className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-5"
        aria-labelledby="change-password-heading"
      >
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C6530E]">
            {tr('change_password_screen.smartsite_account_setup')}
          </p>
          <h1 id="change-password-heading" className="text-2xl font-bold text-[#071A2B]">
            {tr('auth.password.title')}
          </h1>
          <p className="text-sm text-slate-600">{tr('auth.password.description')}</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            change.reset();
            if (newPassword !== confirmation) {
              setValidationError(tr('change_password_screen.new_passwords_do_not_match'));
              return;
            }
            setValidationError('');
            change.mutate();
          }}
        >
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              {tr('auth.password.current')}
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              {tr('common.new_password')}
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={busy}
              aria-describedby="password-policy"
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
            <p id="password-policy" className="mt-1 text-xs text-slate-500">
              {tr(
                'change_password_screen.use_8_128_characters_including_an_uppercase_letter_a_number_and_a_special_characte',
              )}
            </p>
          </div>
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              {tr('common.confirm_new_password')}
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
          </div>
          <AuthErrorNotice error={change.error} message={errorMessage} />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#071A2B] p-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {change.isPending ? tr('common.saving_password') : tr('common.save_new_password')}
          </button>
        </form>
        {logout.isError && (
          <p role="alert" className="text-sm text-rose-700">
            {tr('change_password_screen.could_not_sign_out_try_again')}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => logout.mutate()}
          className="w-full p-2 text-sm font-semibold text-slate-600"
        >
          {tr('common.sign_out')}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel} className="text-sm underline">
            {tr('auth.password.cancel')}
          </button>
        )}
      </section>
    </main>
  );
}
