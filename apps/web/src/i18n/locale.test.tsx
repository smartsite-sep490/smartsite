// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider, useLocale } from './locale';
import i18n from './runtime';

function Probe() {
  const { locale, setLocale, t } = useLocale();
  const [draft, setDraft] = useState('site-a');
  return (
    <>
      <output aria-label="locale">{locale}</output>
      <p>{t('auth.login')}</p>
      <input aria-label="scope draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => setLocale('vi')}>Select Vietnamese</button>
      <button onClick={() => setLocale('en')}>Select English</button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'fr';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
});

describe('website locale presentation boundary', () => {
  it('honors an explicit provider default and keeps the shared document language after unmount', () => {
    const view = render(
      <LocaleProvider defaultLocale="vi">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('locale').textContent).toBe('vi');
    expect(screen.getByText('Đăng nhập')).toBeDefined();
    expect(document.documentElement.lang).toBe('vi');
    view.unmount();
    expect(document.documentElement.lang).toBe('vi');
  });

  it('keeps the current Main language when no provider default was requested', () => {
    const view = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('locale').textContent).toBe('en');
    view.unmount();
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('switches copy and document language without resetting an existing scope draft', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    const draft = screen.getByLabelText('scope draft') as HTMLInputElement;
    await user.clear(draft);
    await user.type(draft, 'site-b-unsaved');
    await user.click(screen.getByRole('button', { name: 'Select English' }));
    expect(screen.getByLabelText('locale').textContent).toBe('en');
    expect(screen.getByText('Sign in')).toBeDefined();
    expect(document.documentElement.lang).toBe('en');
    expect(draft.value).toBe('site-b-unsaved');
    await user.click(screen.getByRole('button', { name: 'Select Vietnamese' }));
    expect(screen.getByText('Đăng nhập')).toBeDefined();
    expect(draft.value).toBe('site-b-unsaved');
  });

  it('retains a chosen language across a fresh provider mount', async () => {
    const user = userEvent.setup();
    const first = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Select English' }));
    first.unmount();
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('locale').textContent).toBe('en');
  });

  it('continues to render and switch language when preference storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    render(
      <LocaleProvider defaultLocale="vi">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('Đăng nhập')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Select English' }));
    expect(screen.getByText('Sign in')).toBeDefined();
  });

  it('rejects an unsupported stored locale and honors the explicit fallback', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('unsupported-locale');
    render(
      <LocaleProvider defaultLocale="vi">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText('locale').textContent).toBe('vi');
    expect(document.documentElement.lang).toBe('vi');
  });

  it('keeps legacy isolated consumers English without changing the document language', () => {
    render(<Probe />);
    expect(screen.getByLabelText('locale').textContent).toBe('en');
    expect(document.documentElement.lang).toBe('fr');
  });
});
