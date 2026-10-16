import { localizeMessage } from '../../i18n/messages';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useLogin } from './auth-session';
import { AuthErrorNotice } from './AuthErrorNotice';
import { IconArrowRight, IconUser, IconKey } from '../../components/icons';

interface LoginScreenProps {
  notice?: string;
  onBack: () => void;
  onNavigateToRegister: () => void;
}

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function LoginScreen({ onBack, onNavigateToRegister, notice }: LoginScreenProps) {
  useTranslation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const loginMutation = useLogin(apiUrl);

  useGSAP(
    () => {
      gsap.fromTo(panelRef.current, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3 });
    },
    { scope: containerRef },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginMutation.isPending) return;
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen w-full flex items-center justify-center pt-24 pb-8 overflow-x-hidden bg-[#020810]"
      style={{ perspective: 1200 }}
    >
      {/* Background with abstract dark glow */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Subtle orange/navy radial glows mimicking the reference's sleek background */}
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-[#F66B17] opacity-[0.03] blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#041D2E] opacity-50 blur-[120px] rounded-full pointer-events-none" />
      </div>

      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')] opacity-[0.02] pointer-events-none mix-blend-overlay" />

      {/* Top Nav */}
      <div className="absolute top-0 inset-x-0 h-24 flex items-center justify-between px-4 sm:px-8 z-20">
        <button
          onClick={onBack}
          className="text-white/40 hover:text-white transition-colors text-xs font-bold tracking-widest flex items-center gap-2"
        >
          <IconArrowRight className="w-4 h-4 rotate-180" />
          {tr('common.back_to_site')}
        </button>
        <LanguageSwitcher dark />
      </div>

      {/* Cyber-Chamfered Panel */}
      <div
        ref={panelRef}
        data-auth-panel
        className="relative z-10 filter drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)] flex items-center justify-center mx-4"
        style={{ width: 440, maxWidth: 'calc(100vw - 32px)', minHeight: 600 }}
      >
        {/* Outer Thin Border Layer */}
        <div
          className="absolute inset-0 bg-white/20 transition-all"
          style={{
            clipPath:
              'polygon(40px 0, 100% 0, 100% calc(100% - 40px), calc(100% - 40px) 100%, 0 100%, 0 40px)',
          }}
        />

        {/* Inner Dark Glass Layer */}
        <div
          className="absolute inset-[1px] bg-[#0A1118]/80 backdrop-blur-2xl transition-all"
          style={{
            clipPath:
              'polygon(39px 0, 100% 0, 100% calc(100% - 39px), calc(100% - 39px) 100%, 0 100%, 0 39px)',
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
        </div>

        {/* Top Left Glass Accent */}
        <div
          className="absolute top-[1px] left-[1px] w-[39px] h-[39px] bg-white/5 border-b border-r border-white/10 backdrop-blur-3xl hidden sm:block"
          style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        />
        {/* Bottom Right Glass Accent */}
        <div
          className="absolute bottom-[1px] right-[1px] w-[39px] h-[39px] bg-white/5 border-t border-l border-white/10 backdrop-blur-3xl hidden sm:block"
          style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        />

        {/* --- FORM STATE --- */}
        <div className="login-form-content absolute inset-0 flex flex-col p-6 sm:p-10 justify-center">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg shrink-0 bg-white p-0.5 border border-white/10 flex items-center justify-center">
                <img
                  src="/smartsite-app-icon-white.png"
                  alt="SmartSite"
                  className="w-full h-full object-contain"
                />
              </div>
              <span className="text-2xl font-black tracking-tight text-white">
                Smart<span className="text-[#F66B17]">Site</span>
              </span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight mb-2">
              {tr('common.welcome')} <span className="text-[#F66B17]">{tr('common.back')}</span>
            </h1>
            <p className="text-white/40 text-xs font-medium tracking-wide">
              {tr('login_screen.enter_your_credentials_to_access_your_secure_account')}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            aria-busy={loginMutation.isPending}
            className="space-y-5 flex-1 flex flex-col justify-center"
          >
            <div className="space-y-4">
              {/* Username Input */}
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-[11px] font-bold text-white/60 mb-2 uppercase tracking-widest"
                >
                  {tr('common.username')}
                </label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconUser className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    id="login-username"
                    autoComplete="username"
                    maxLength={64}
                    disabled={loginMutation.isPending}
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={tr('common.enter_your_username')}
                    className="bg-transparent text-white w-full outline-none focus-visible:ring-2 focus-visible:ring-[#F66B17] text-sm placeholder:text-white/20"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label
                  htmlFor="login-password"
                  className="block text-[11px] font-bold text-white/60 mb-2 uppercase tracking-widest"
                >
                  {tr('common.password')}
                </label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl pl-4 pr-3 py-3.5 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconKey className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    id="login-password"
                    autoComplete="current-password"
                    maxLength={128}
                    disabled={loginMutation.isPending}
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-transparent text-white w-full pr-8 outline-none focus-visible:ring-2 focus-visible:ring-[#F66B17] text-sm placeholder:text-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors focus-visible:outline-2 focus-visible:outline-[#F66B17] cursor-pointer"
                    aria-label={tr(showPassword ? 'auth.password.hide' : 'auth.password.show')}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {notice && (
              <p
                role="status"
                className="rounded-lg border border-emerald-500/40 bg-emerald-950/50 p-3 text-xs text-emerald-200"
              >
                {localizeMessage(notice)}
              </p>
            )}
            <AuthErrorNotice error={loginMutation.error} />

            <div className="pt-2">
              <button
                type="submit"
                disabled={loginMutation.isPending}
                className="group relative w-full flex items-center justify-center gap-2 py-4 bg-[#F66B17] hover:bg-[#D94E07] transition-all rounded-xl overflow-hidden active:scale-[0.98] shadow-[0_0_20px_rgba(246,107,23,0.3)]"
              >
                <span className="font-bold text-white tracking-wide text-sm">
                  {tr(loginMutation.isPending ? 'auth.login.busy' : 'common.sign_in_bcc0bc')}
                </span>
                <IconArrowRight className="w-4 h-4 text-white transition-transform group-hover:translate-x-1" />
              </button>
            </div>

            <div className="text-center mt-2">
              <span className="text-white/40 text-xs font-medium">
                {tr('login_screen.don_t_have_an_account')}
              </span>{' '}
              <button
                type="button"
                onClick={onNavigateToRegister}
                className="text-[#F66B17] text-xs font-bold hover:text-[#D94E07] transition-colors"
              >
                {tr('auth.registration.title')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
