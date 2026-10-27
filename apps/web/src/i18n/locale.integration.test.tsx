// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import i18n, {
  LANGUAGE_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  LocaleProvider,
  LocaleSwitcher,
  SAFETY_NAMESPACE,
  translate as tr,
  translateKey,
  uiLanguage,
  useLocale,
  type Locale,
  type TranslationKey,
} from './index';
import { LanguageSwitcher } from './LanguageSwitcher';
import { registerFeatureCatalog } from './feature-catalog-registry';
import { registerPpeCatalog } from './ppe-catalog';
import { useLocale as usePpeLocale } from './ppe-locale';

function UnifiedRuntimeHarness() {
  const { t: tCommon } = useTranslation();
  const { t: tSafetyNs } = useTranslation(SAFETY_NAMESPACE);
  const core = useLocale();
  const ppe = usePpeLocale();
  const [draft, setDraft] = useState('zone-draft-alpha');

  return (
    <div>
      <LanguageSwitcher />
      <LocaleSwitcher className="legacy-switcher-shell" />
      <output data-testid="runtime-lang">{uiLanguage()}</output>
      <output data-testid="core-lang">{core.locale}</output>
      <output data-testid="ppe-lang">{ppe.locale}</output>
      <output data-testid="common-title">{tCommon('app.documentTitle')}</output>
      <output data-testid="safety-ns-login">{tSafetyNs('auth.login')}</output>
      <output data-testid="core-login">{core.t('auth.login')}</output>
      <output data-testid="ppe-header">{ppe.t('ppe.header.title')}</output>
      <output data-testid="ppe-points">
        {ppe.t('regionSetup.drawer.pointsCount', { count: 7 })}
      </output>
      <input
        aria-label="shared-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={() => core.setLocale('vi')}>
        set-vi-via-core
      </button>
      <button type="button" onClick={() => ppe.setLocale('en')}>
        set-en-via-ppe
      </button>
      <button type="button" onClick={() => core.setLocale('invalid-lang' as unknown as Locale)}>
        set-invalid
      </button>
    </div>
  );
}

describe('single i18next runtime and Safety compatibility integration', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // The real detector persists changeLanguage; clear after resetting the engine.
    window.localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    window.localStorage.clear();
  });

  it('synchronizes Main useTranslation, Safety useLocale/usePpeLocale, LanguageSwitcher, and LocaleSwitcher on one engine while preserving form drafts', async () => {
    const { container } = render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );

    const switchers = container.querySelectorAll('[data-language-switcher]');
    expect(switchers.length).toBe(2);
    expect(
      container.querySelector('.legacy-switcher-shell [data-language-switcher]'),
    ).not.toBeNull();

    const draftInput = screen.getByLabelText('shared-draft') as HTMLInputElement;
    fireEvent.change(draftInput, { target: { value: 'unsaved-incident-note-42' } });

    expect(screen.getByTestId('runtime-lang').textContent).toBe('en');
    expect(screen.getByTestId('core-lang').textContent).toBe('en');
    expect(screen.getByTestId('ppe-lang').textContent).toBe('en');
    expect(screen.getByTestId('core-login').textContent).toBe('Sign in');
    expect(screen.getByTestId('safety-ns-login').textContent).toBe('Sign in');
    expect(screen.getByTestId('ppe-header').textContent).toBe('PPE Compliance Monitoring');
    expect(screen.getByTestId('ppe-points').textContent).toBe('Points: 7 / 32');

    fireEvent.click(screen.getByText('set-vi-via-core'));

    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');
    expect(screen.getByTestId('core-lang').textContent).toBe('vi');
    expect(screen.getByTestId('ppe-lang').textContent).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('vi');
    expect(screen.getByTestId('core-login').textContent).toBe('Đăng nhập');
    expect(screen.getByTestId('safety-ns-login').textContent).toBe('Đăng nhập');
    expect(screen.getByTestId('ppe-header').textContent).toBe(
      'Giám sát tuân thủ bảo hộ lao động (PPE)',
    );
    expect(screen.getByTestId('ppe-points').textContent).toBe('Số điểm: 7 / 32');
    expect(draftInput.value).toBe('unsaved-incident-note-42');

    // Invalid locale changes are ignored without corrupting state or draft
    fireEvent.click(screen.getByText('set-invalid'));
    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');
    expect(draftInput.value).toBe('unsaved-incident-note-42');

    // Switching back via ppe.setLocale updates both Main and Safety subscribers in lockstep
    fireEvent.click(screen.getByText('set-en-via-ppe'));
    expect(screen.getByTestId('runtime-lang').textContent).toBe('en');
    expect(screen.getByTestId('core-login').textContent).toBe('Sign in');
    expect(screen.getByTestId('ppe-points').textContent).toBe('Points: 7 / 32');
    expect(draftInput.value).toBe('unsaved-incident-note-42');
  });

  it('preserves active language, auth/session storage tokens, and form drafts when lazy feature catalogs register', () => {
    const authToken = 'session-token-do-not-touch';
    window.localStorage.setItem('smartsite.auth.token', authToken);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'vi');

    render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );

    const draftInput = screen.getByLabelText('shared-draft') as HTMLInputElement;
    fireEvent.change(draftInput, { target: { value: 'keep-across-lazy-register' } });

    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');

    registerPpeCatalog();
    registerFeatureCatalog({
      en: { 'lazy.feature.banner': 'Camera {camera} active' },
      vi: { 'lazy.feature.banner': 'Camera {camera} đang hoạt động' },
    });

    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('vi');
    expect(window.localStorage.getItem('smartsite.auth.token')).toBe(authToken);
    expect(draftInput.value).toBe('keep-across-lazy-register');
    expect(
      translateKey('vi', 'lazy.feature.banner' as unknown as TranslationKey, { camera: 'CAM-01' }),
    ).toBe('Camera CAM-01 đang hoạt động');
    expect(
      translateKey('en', 'lazy.feature.banner' as unknown as TranslationKey, { camera: 'CAM-01' }),
    ).toBe('Camera CAM-01 active');
  });

  it('migrates legacy smartsite.locale on provider mount only when canonical smartsite-language is absent, and returns empty string for unsupported translateKey lookups', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');

    const { unmount } = render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('vi');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('vi');
    unmount();

    // When canonical is 'en' and legacy is 'vi', canonical 'en' wins
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');

    render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('runtime-lang').textContent).toBe('en');
    expect(tr('common.cancel')).toBe('Cancel');
    expect(translateKey('en', 'missing.unregistered.key' as unknown as TranslationKey)).toBe('');
    expect(translateKey('vi', 'missing.unregistered.key' as unknown as TranslationKey)).toBe('');
  });

  it('keeps interpolation values from overriding the Safety namespace or requested language', () => {
    registerFeatureCatalog({
      en: { 'review.optionsBoundary': 'Area {value}' },
      vi: { 'review.optionsBoundary': 'Khu vực {value}' },
    });
    expect(
      translateKey('vi', 'review.optionsBoundary' as TranslationKey, {
        value: 'GROUND',
        ns: 'common',
        lng: 'en',
        fallbackLng: 'en',
      }),
    ).toBe('Khu vực GROUND');
  });

  it('continues an in-memory language switch and preserves draft when storage writes fail', () => {
    render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );
    const draft = screen.getByLabelText('shared-draft') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'retain-draft-with-blocked-storage' } });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked storage', 'SecurityError');
    });
    fireEvent.click(screen.getByText('set-vi-via-core'));
    expect(screen.getByTestId('runtime-lang').textContent).toBe('vi');
    expect(screen.getByTestId('core-login').textContent).toBe('Đăng nhập');
    expect(draft.value).toBe('retain-draft-with-blocked-storage');
  });

  it('switches through both actual popovers and keeps the same unsaved input', async () => {
    render(
      <LocaleProvider>
        <UnifiedRuntimeHarness />
      </LocaleProvider>,
    );
    const user = userEvent.setup();
    const draft = screen.getByLabelText('shared-draft') as HTMLInputElement;
    await user.clear(draft);
    await user.type(draft, 'Site-Zone-Camera draft');
    screen.getAllByRole('button', { name: 'Choose language' })[0]!.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /Tiếng Việt/ }));
    expect(screen.getByTestId('core-lang').textContent).toBe('vi');
    expect(screen.getByTestId('ppe-lang').textContent).toBe('vi');
    expect(draft.value).toBe('Site-Zone-Camera draft');
    await user.click(screen.getAllByRole('button', { name: 'Chọn ngôn ngữ' })[1]!);
    await user.click(screen.getByRole('button', { name: /English/ }));
    expect(screen.getByTestId('runtime-lang').textContent).toBe('en');
    expect(screen.getByTestId('core-login').textContent).toBe('Sign in');
    expect(draft.value).toBe('Site-Zone-Camera draft');
  });

  it('initializes a later provider without updating an already-mounted subscriber during render', () => {
    function ExistingSubscriber() {
      const { locale } = useLocale();
      useTranslation();
      return <output data-testid="existing-subscriber">{locale}</output>;
    }
    const { rerender } = render(<ExistingSubscriber />);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    rerender(
      <>
        <ExistingSubscriber />
        <LocaleProvider defaultLocale="vi">
          <span>later provider</span>
        </LocaleProvider>
      </>,
    );
    expect(screen.getByTestId('existing-subscriber').textContent).toBe('vi');
    const renderPhaseWarnings = errors.mock.calls.filter((args) =>
      args.some(
        (arg) => typeof arg === 'string' && /while rendering a different component/.test(arg),
      ),
    );
    expect(renderPhaseWarnings).toEqual([]);
  });
});
