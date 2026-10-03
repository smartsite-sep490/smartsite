import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useLogout } from './auth-session';

export function ChangePasswordScreen({
  apiUrl,
  onComplete,
}: {
  apiUrl: string;
  onComplete: () => void;
}) {
  const { accessToken, setAccessToken, dismissSessionExpired } = useAuth();
  const cache = useQueryClient();
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
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
      setAccessToken(null);
      dismissSessionExpired();
      cache.clear();
      cache.setQueryData(['auth', 'session'], null);
      onComplete();
    },
  });
  const error =
    validationError ||
    (change.error instanceof ApiError && change.error.status === 401
      ? 'Your current password is incorrect or your session has expired. Try again or sign out and sign in again.'
      : change.error instanceof Error
        ? change.error.message
        : '');
  const busy = change.isPending || logout.isPending;

  return (
    <main className="min-h-screen bg-[#071A2B] flex items-center justify-center p-4">
      <section
        className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-xl space-y-5"
        aria-labelledby="change-password-heading"
      >
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C6530E]">
            SmartSite · Account setup
          </p>
          <h1 id="change-password-heading" className="text-2xl font-bold text-[#071A2B]">
            Change your temporary password
          </h1>
          <p className="text-sm text-slate-600">
            Set your own password before accessing your site. After saving, sign in again with your
            new password.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            change.reset();
            if (newPassword !== confirmation) {
              setValidationError('New passwords do not match.');
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
              Current temporary password
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
              New password
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
              Use 8–128 characters, including an uppercase letter, a number and a special character.
            </p>
          </div>
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              Confirm new password
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
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#071A2B] p-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {change.isPending ? 'Saving password...' : 'Save new password'}
          </button>
        </form>
        {logout.isError && (
          <p role="alert" className="text-sm text-rose-700">
            Could not sign out. Try again.
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => logout.mutate()}
          className="w-full p-2 text-sm font-semibold text-slate-600"
        >
          Sign out
        </button>
      </section>
    </main>
  );
}
