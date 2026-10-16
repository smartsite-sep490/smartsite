// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Mf06AssessmentResponse,
  type Mf06RequestStatusResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { useLocale, type Locale } from '../../i18n/locale-context';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';
import { Mf06ZoneAssessmentPanel } from './Mf06ZoneAssessmentPanel';

const site = '33333333-3333-4333-8333-333333333331';
const assessment: Mf06AssessmentResponse = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: site,
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.000Z',
  assessedAt: '2026-10-12T10:00:02.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_READ_V1',
  provenance: 'UNAVAILABLE',
};
const request: Mf06RequestStatusResponse = {
  requestId: assessment.requestId,
  siteId: site,
  eventId: assessment.eventId,
  cameraId: assessment.cameraId,
  zoneId: assessment.zoneId,
  capturedAt: assessment.capturedAt,
  requestedAt: '2026-10-12T10:00:01.000Z',
  purpose: assessment.purpose,
  jobStatus: 'NOT_QUEUED',
  attemptCount: 0,
  deadlineAt: null,
  deadlinePassed: false,
  assessmentId: null,
};
const page = <T,>(items: T[]) => ({ items, total: items.length, offset: 0, limit: 20 });
let changeLocale: ((locale: Locale) => void) | undefined;
const clients: QueryClient[] = [];
function Control() {
  const { setLocale } = useLocale();
  React.useEffect(() => {
    changeLocale = setLocale;
    return () => {
      changeLocale = undefined;
    };
  }, [setLocale]);
  return null;
}
function mount(client: SmartSiteManagementClient, kind: 'history' | 'requests') {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const props = {
    token: 'synthetic-token',
    siteId: site,
    credentialId: 'synthetic-credential',
    client,
  };
  return render(
    <QueryClientProvider client={queries}>
      <LocaleProvider defaultLocale="vi">
        <Control />
        {kind === 'history' ? (
          <Mf06AssessmentHistory {...props} />
        ) : (
          <Mf06ZoneAssessmentPanel {...props} initialTab="requests" />
        )}
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
function english() {
  if (!changeLocale) throw new Error('Locale setter missing');
  act(() => changeLocale?.('en'));
}

describe('MF06 request and history presentation locale', () => {
  it('switches the history labels without refetching immutable records or converting unavailable identity to unauthorized', async () => {
    const list = vi.fn().mockResolvedValue(page([assessment]));
    mount({ listMf06Assessments: list } as unknown as SmartSiteManagementClient, 'history');
    await screen.findByText('Lịch sử đánh giá khu vực hạn chế MF06');
    await screen.findByText('Chưa xác định được danh tính');
    expect(screen.queryByText('Không được phép')).toBeNull();
    expect(screen.getByText(assessment.assessmentId)).toBeDefined();
    english();
    await screen.findByText('MF06 Restricted Zone Assessment History');
    await screen.findByText('Identity Unavailable');
    expect(screen.getByText(assessment.assessmentId)).toBeDefined();
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('keeps the selected request tab and NOT_QUEUED snapshot while switching locale without enqueue or refetch', async () => {
    const requests = vi.fn().mockResolvedValue(page([request]));
    const history = vi.fn().mockResolvedValue(page([]));
    mount(
      {
        listMf06RequestStatuses: requests,
        listMf06Assessments: history,
      } as unknown as SmartSiteManagementClient,
      'requests',
    );
    const tab = await screen.findByRole('tab', { name: 'Yêu cầu' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Chưa vào hàng đợi');
    english();
    expect(screen.getByRole('tab', { name: 'Requests' })).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Not Queued');
    expect(requests).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
  });
  it.each(['history', 'requests'] as const)(
    'localizes safe %s access errors without disclosing diagnostics',
    async (kind) => {
      const list = vi
        .fn()
        .mockRejectedValue(new ApiError('http', 'private-driver-diagnostic', 403));
      mount(
        {
          listMf06Assessments: list,
          listMf06RequestStatuses: list,
        } as unknown as SmartSiteManagementClient,
        kind,
      );
      const message =
        kind === 'history'
          ? 'Bạn không có quyền xem đánh giá của công trường này.'
          : 'Bạn không có quyền xem yêu cầu của công trường này.';
      await screen.findByText(message);
      expect(screen.queryByText('private-driver-diagnostic')).toBeNull();
      english();
      await screen.findByText(
        kind === 'history'
          ? 'You do not have permission to view assessments for this site.'
          : 'You do not have permission to view requests for this site.',
      );
      await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    },
  );
});
