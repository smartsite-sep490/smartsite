import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowRight } from '../../components/icons';
import { translate as tr, useLocale } from '../../i18n';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

interface RegisterScreenProps {
  onBackToLogin: () => void;
  onBackToSite: () => void;
}

// Preserve /register as account-access guidance. The current Backend
// provisions users through the authenticated, Admin-only users API.
export function RegisterScreen({ onBackToLogin, onBackToSite }: RegisterScreenProps) {
  useTranslation();
  const { t } = useLocale();

  return (
    <div className="min-h-dvh w-full flex flex-col justify-between bg-[#F8FAFC] text-slate-800 font-sans antialiased">
      <header className="w-full px-6 py-4 flex items-center justify-between border-b border-slate-200/80 bg-white">
        <button
          type="button"
          onClick={onBackToSite}
          aria-label={t('auth.backToHomepageAria')}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer py-2 px-3 rounded-xl hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
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
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <section
          aria-labelledby="account-access-title"
          className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"
        >
          <p className="text-xs font-semibold text-slate-500">
            {t('auth.registerGuidance.eyebrow')}
          </p>
          <h1
            id="account-access-title"
            className="mt-2 text-2xl font-bold tracking-tight text-slate-900"
          >
            {t('auth.registerGuidance.title')}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            {t('auth.registerGuidance.adminInstruction')}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {t('auth.registerGuidance.existingAccountPrompt')}
          </p>
          <button
            type="button"
            onClick={onBackToLogin}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 active:scale-[0.99] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {tr('common.sign_in')}
            <IconArrowRight className="w-4 h-4" />
          </button>
        </section>
      </main>
      <footer className="w-full px-6 py-4 text-center text-[11px] text-slate-500 border-t border-slate-200/80 bg-white">
        {t('auth.footer')}
      </footer>
    </div>
  );
}
