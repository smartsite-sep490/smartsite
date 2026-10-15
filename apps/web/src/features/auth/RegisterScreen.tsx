import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';
import { IconArrowRight } from '../../components/icons';

export function RegisterScreen({
  onBackToLogin,
  onBackToSite,
}: {
  onBackToLogin: () => void;
  onBackToSite: () => void;
}) {
  useTranslation();
  return (
    <main className="min-h-screen bg-[#020810] text-white flex items-center justify-center px-4 py-24">
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 sm:p-8">
        <button
          type="button"
          onClick={onBackToSite}
          className="text-sm text-white/70 hover:text-white focus-visible:outline-2"
        >
          {tr('common.back_to_site')}
        </button>
        <LanguageSwitcher dark />
      </div>
      <section
        className="w-full max-w-md rounded-2xl border border-white/20 bg-[#0A1118] p-6 sm:p-10 space-y-6"
        aria-labelledby="registration-title"
      >
        <img src="/smartsite-app-icon-white.png" alt="SmartSite" className="w-12 h-12 rounded-xl" />
        <h1 id="registration-title" className="text-2xl font-bold">
          {tr('auth.registration.title')}
        </h1>
        <p className="text-sm leading-relaxed text-white/80">
          {tr('auth.registration.description')}
        </p>
        <p className="text-xs leading-relaxed text-white/60">{tr('auth.registration.note')}</p>
        <button
          type="button"
          onClick={onBackToLogin}
          className="w-full rounded-xl bg-[#F66B17] p-3 font-bold flex items-center justify-center gap-2 focus-visible:outline-2"
        >
          {tr('common.sign_in_bcc0bc')}
          <IconArrowRight className="w-4 h-4" />
        </button>
      </section>
    </main>
  );
}
