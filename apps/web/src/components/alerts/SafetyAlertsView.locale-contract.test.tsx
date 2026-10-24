// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { SafetyAlertsView } from './SafetyAlertsView';
import { formatCandidateSubtype } from './safetyAlertEvidenceUtils';
vi.mock('../safety/IncidentView', () => ({ IncidentView: () => null }));
vi.mock('../safety/SafetyTasksView', () => ({ SafetyTasksView: () => null }));
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

it('localizes known observation labels EN -> VI -> EN without modifying their machine code', async () => {
  const code = 'PPE_GLOVES_MISSING';
  expect(formatCandidateSubtype(code)).toBe('Missing Gloves');
  await i18n.changeLanguage('vi');
  expect(formatCandidateSubtype(code)).toBe('Thiếu găng tay');
  expect(code).toBe('PPE_GLOVES_MISSING');
  await i18n.changeLanguage('en');
  expect(formatCandidateSubtype(code)).toBe('Missing Gloves');
});

it('retranslates a controlled pending-session banner without requesting protected metadata', async () => {
  const sites = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={cache}>
      <SafetyAlertsView apiUrl="https://backend.invalid" sharedSession={null} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('heading', { name: 'Session pending or expired' })).toBeTruthy();
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(
    screen.getByRole('heading', { name: 'Phiên làm việc đang chờ hoặc đã hết hạn' }),
  ).toBeTruthy();
  expect(
    screen.getByText(
      'Phiên làm việc của ứng dụng đang chờ hoặc không còn hợp lệ. Vui lòng đăng nhập vào ứng dụng để tiếp tục.',
    ),
  ).toBeTruthy();
  expect(sites).not.toHaveBeenCalled();
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('heading', { name: 'Session pending or expired' })).toBeTruthy();
  cache.clear();
});
