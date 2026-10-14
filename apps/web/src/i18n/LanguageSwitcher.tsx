import { useId, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import i18n, { type UiLanguage } from './index';

function Flag({ language }: { language: UiLanguage }) {
  const clip = useId();
  return (
    <svg viewBox="0 0 32 32" className="h-5 w-5 shrink-0 rounded-full shadow-sm" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <circle cx="16" cy="16" r="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {language === 'vi' ? (
          <>
            <rect width="32" height="32" fill="#da251d" />
            <path
              d="m16 6 2.35 7.24H26l-6.2 4.5 2.37 7.25L16 20.5l-6.17 4.49 2.37-7.25L6 13.24h7.65Z"
              fill="#ffdf00"
            />
          </>
        ) : (
          <>
            <rect width="32" height="32" fill="#012169" />
            <path d="m0 0 32 32M32 0 0 32" stroke="#fff" strokeWidth="7" />
            <path d="m0 0 32 32M32 0 0 32" stroke="#c8102e" strokeWidth="3" />
            <path d="M16 0v32M0 16h32" stroke="#fff" strokeWidth="10" />
            <path d="M16 0v32M0 16h32" stroke="#c8102e" strokeWidth="6" />
          </>
        )}
      </g>
    </svg>
  );
}

export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const language: UiLanguage = i18n.resolvedLanguage?.startsWith('vi') ? 'vi' : 'en';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-language-switcher
          aria-label={t('language.choose')}
          title={t('language.current', {
            language: t(language === 'vi' ? 'language.vietnamese' : 'language.english'),
          })}
          className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] ${dark ? 'border-white/25 bg-white/10 text-white hover:bg-white/20' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
        >
          <Flag language={language} />
          <span className="hidden min-[380px]:inline">{language.toUpperCase()}</span>
          <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[100] min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
          aria-label={t('language.choose')}
        >
          {(['en', 'vi'] as const).map((option) => (
            <button
              key={option}
              type="button"
              lang={option}
              aria-pressed={language === option}
              onClick={() => {
                void i18n.changeLanguage(option);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-[#F66B17] aria-pressed:bg-orange-50 aria-pressed:text-orange-800"
            >
              <Flag language={option} />
              {option === 'vi' ? 'Tiếng Việt' : 'English'}
              {language === option && (
                <span className="ml-auto" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
