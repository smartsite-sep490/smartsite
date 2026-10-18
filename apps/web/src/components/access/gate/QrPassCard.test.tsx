// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { QrPassCard } from './QrPassCard';
import i18n from '../../../i18n';

afterEach(cleanup);

it('shows the same short Worker code alongside the scannable QR for manual entry', async () => {
  await i18n.changeLanguage('en');
  render(
    <QrPassCard
      pass={{ token: 'ABCD2345', direction: 'IN', expiresAt: '2030-01-01T00:05:00Z' }}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByTitle(i18n.t('common.smartsite_access_qr'))).toBeTruthy();
  expect(screen.getAllByText('ABCD2345').some((element) => element.tagName === 'P')).toBe(true);
});

it('shows a stable visitor booking QR without a token-expiry countdown', async () => {
  await i18n.changeLanguage('en');
  render(<QrPassCard pass={{ token: 'ABCD2345', expiresAt: null }} onRefresh={() => {}} />);
  expect(screen.getByTitle(i18n.t('common.smartsite_access_qr'))).toBeTruthy();
  expect(screen.getByText('Booking code remains unchanged')).toBeTruthy();
  expect(screen.queryByText(/Expires in|Expired|Infinity|NaN/i)).toBeNull();
});

it('does not show an expired worker fallback QR', async () => {
  await i18n.changeLanguage('en');
  render(
    <QrPassCard
      pass={{ token: 'synthetic', expiresAt: '2020-01-01T00:00:00Z' }}
      onRefresh={() => {}}
    />,
  );
  expect(screen.queryByTitle(i18n.t('common.smartsite_access_qr'))).toBeNull();
  expect(screen.getByText('Expired')).toBeTruthy();
});
