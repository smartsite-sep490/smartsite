import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconArrowRight, IconKey, IconUser } from '../../components/icons';
import { useLocale, type TranslationKey } from '../../i18n';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { localizeMessage } from '../../i18n/messages';
import { useLogin } from './auth-session';

interface LoginScreenProps {
  notice?: string;
  onBack: () => void;
  onNavigateToRegister: () => void;
}

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const KNOWN_PASSWORD_CHANGED_NOTICES = new Set([
  'Password changed. Please sign in with your new password.',
  'Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới.',
]);

export function LoginScreen({ notice, onBack, onNavigateToRegister }: LoginScreenProps) {
  useTranslation();
  const { t } = useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const loginMutation = useLogin(apiUrl);
  const errorMessage = errorKey ? t(errorKey) : '';
  const noticeMessage = notice
    ? KNOWN_PASSWORD_CHANGED_NOTICES.has(notice)
      ? t('auth.notice.passwordChanged')
      : localizeMessage(notice)
    : '';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginMutation.isPending) return;
    setErrorKey(null);

    loginMutation.mutate(
      { username, password },
      {
        onError: (err: unknown) => {
          let nextKey: TranslationKey = 'auth.error.unexpected';
          const errorObj = err as {
            status?: number;
            message?: string;
            type?: string;
            code?: string;
          };
          if (errorObj?.status === 401) {
            nextKey = 'auth.error.invalidCredentials';
          } else if (errorObj?.status === 429) {
            nextKey = 'auth.error.tooManyAttempts';
          } else if (errorObj?.code === 'timeout') {
            nextKey = 'auth.error.timeout';
          } else if (errorObj?.status === 503) {
            nextKey = 'auth.error.unavailable';
          } else if (errorObj?.code === 'invalid-response') {
            nextKey = 'auth.error.invalidResponse';
          } else if (
            errorObj?.code === 'network' ||
            errorObj?.message === 'Network Error' ||
            errorObj?.type === 'network'
          ) {
            nextKey = 'auth.error.network';
          }
          setErrorKey(nextKey);
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-[#F8FAFC] text-slate-800 font-sans antialiased">
      {/* Top Utility Bar */}
      <header className="w-full px-6 py-4 flex items-center justify-between border-b border-slate-200/80 bg-white">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('auth.backToHomepageAria')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer py-1.5 px-3 rounded-xl hover:bg-slate-100"
        >
          <IconArrowRight className="w-3.5 h-3.5 rotate-180" />
          <span>{t('auth.backToSite')}</span>
        </button>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl overflow-hidden shadow-xs shrink-0 bg-white p-0.5 border border-slate-200/80 flex items-center justify-center">
              <img
                src="/smartsite-app-icon-white.png"
                alt="SmartSite"
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-bold text-xs tracking-tight text-slate-900">SmartSite</span>
          </div>
        </div>
      </header>

      {/* Main Form Centerpiece with 24px Primary Surface */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px] p-1.5 bg-[#F8FAFC] border border-slate-200/60 rounded-[24px] shadow-sm">
          <div className="bg-white rounded-[calc(24px-6px)] border border-slate-100 p-8 shadow-[inset_0_1px_1px_rgba(255,255,255,1),_0_2px_10px_rgba(7,26,43,0.02)]">
            {/* Card Header */}
            <div className="mb-6 space-y-1.5">
              <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 mb-1">
                <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-amber-400" />
                {t('auth.badge')}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {t('auth.login')}
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed">{t('auth.subtitle')}</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username Field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="username-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  {t('auth.username')}
                </label>
                <div className="relative flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900 transition-all">
                  <IconUser className="w-4 h-4 text-slate-400 ml-3 shrink-0" />
                  <input
                    id="username-input"
                    type="text"
                    required
                    autoComplete="username"
                    disabled={loginMutation.isPending}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('auth.usernamePlaceholder')}
                    className="w-full bg-transparent px-3 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-1.5">
                <label
                  htmlFor="password-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  {t('auth.password')}
                </label>
                <div className="relative flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-900 focus-within:ring-1 focus-within:ring-slate-900 transition-all">
                  <IconKey className="w-4 h-4 text-slate-400 ml-3 shrink-0" />
                  <input
                    id="password-input"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    disabled={loginMutation.isPending}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full bg-transparent pl-3 pr-10 py-2.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    disabled={loginMutation.isPending}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-900 transition-colors cursor-pointer rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    tabIndex={0}
                  >
                    {showPassword ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Notice Feedback */}
              {notice && (
                <p
                  role="status"
                  className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-3 text-xs font-medium text-emerald-800"
                >
                  {noticeMessage}
                </p>
              )}

              {/* Error Message Feedback */}
              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-center gap-2 p-3 rounded-xl bg-red-50/90 border border-red-200 text-red-700 text-xs font-medium"
                >
                  <IconAlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                  <p>{errorMessage}</p>
                </div>
              )}

              {/* Submit Action */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loginMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl text-xs font-semibold tracking-wide transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                >
                  {loginMutation.isPending ? (
                    <>
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span>{t('auth.signingIn')}</span>
                    </>
                  ) : (
                    <>
                      <span>{t('auth.login')}</span>
                      <IconArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Account access guidance */}
              <div className="text-center pt-2 border-t border-slate-100">
                <span className="text-xs text-slate-500">{t('auth.noAccountPrompt')}</span>
                <button
                  type="button"
                  onClick={onNavigateToRegister}
                  className="text-xs font-semibold text-slate-900 hover:underline cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {t('auth.getAnAccount')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full px-6 py-4 text-center text-[11px] text-slate-500 border-t border-slate-200/80 bg-white">
        {t('auth.footer')}
      </footer>
    </div>
  );
}
