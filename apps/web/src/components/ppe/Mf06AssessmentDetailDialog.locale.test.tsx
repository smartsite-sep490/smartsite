// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Mf06AssessmentResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { useLocale, type Locale } from '../../i18n/locale-context';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import type { AssessmentTargetContext } from './mf06AssessmentDetailBinding';

const target: AssessmentTargetContext = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  siteId: '33333333-3333-4333-8333-333333333331',
  requestId: '22222222-2222-4222-8222-222222222222',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  capturedAt: '2026-10-12T10:00:00.123456Z',
};
const record: Mf06AssessmentResponse = {
  ...target,
  assessedAt: '2026-10-12T10:00:02.000Z',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_READ_V1',
  provenance: 'UNAVAILABLE',
};
let changeLocale: ((locale: Locale) => void) | undefined;
const clients: QueryClient[] = [];
function LocaleControl() {
  const { setLocale } = useLocale();
  React.useEffect(() => {
    changeLocale = setLocale;
    return () => {
      changeLocale = undefined;
    };
  }, [setLocale]);
  return null;
}
function mount(fetch: ReturnType<typeof vi.fn>, open = true) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const client = { getMf06Assessment: fetch } as unknown as SmartSiteManagementClient;
  return render(
    <QueryClientProvider client={queries}>
      <LocaleProvider defaultLocale="vi">
        <LocaleControl />
        <Mf06AssessmentDetailDialog
          open={open}
          onClose={vi.fn()}
          target={target}
          token="synthetic-token"
          siteId={target.siteId}
          credentialId="synthetic-credential"
          client={client}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  changeLocale = undefined;
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe('MF06 recorded assessment presentation locale', () => {
  it('retranslates an unavailable immutable assessment without refetching or inferring unauthorized identity', async () => {
    const fetch = vi.fn().mockResolvedValue(record);
    mount(fetch);
    const dialog = await screen.findByRole('dialog', { name: 'Đánh giá đã lưu' });
    await screen.findByText('Chưa có kết quả');
    await screen.findByText('Chưa xác định được danh tính');
    expect(screen.queryByText('Không được phép')).toBeNull();
    expect(screen.getByText(record.assessmentId)).toBeDefined();
    const time = dialog.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(record.capturedAt);
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await screen.findByRole('dialog', { name: 'Recorded assessment' });
    await screen.findByText('Identity Unavailable');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(time?.getAttribute('datetime')).toBe(record.capturedAt);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('localizes a safe forbidden response without disclosing private transport diagnostics', async () => {
    const fetch = vi.fn().mockRejectedValue(new ApiError('http', 'private-driver-details', 403));
    mount(fetch);
    await screen.findByText('Bạn không có quyền xem đánh giá này.');
    expect(screen.queryByText('private-driver-details')).toBeNull();
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await screen.findByText('You do not have permission to view this assessment.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not fetch a closed dialog while the locale changes', async () => {
    const fetch = vi.fn().mockResolvedValue(record);
    mount(fetch, false);
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
