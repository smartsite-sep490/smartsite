// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  capturedAt: '2026-10-12T10:00:00.123456Z',
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
const deadlineRequest: Mf06RequestStatusResponse = {
  ...request,
  requestId: '77777777-7777-4777-8777-777777777777',
  eventId: '88888888-8888-4888-8888-888888888888',
  capturedAt: '2026-10-12T10:00:03.654321Z',
  requestedAt: '2026-10-12T10:00:04.000Z',
  jobStatus: 'CLAIMED',
  attemptCount: 1,
  deadlineAt: '2026-10-12T10:00:09.000Z',
  deadlinePassed: false,
  assessmentId: null,
};
const TIMESTAMP_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'UTC',
  timeZoneName: 'short',
};
function expectedTimestamp(isoString: string, localeTag: 'vi-VN' | 'en-US'): string {
  return new Date(isoString).toLocaleString(localeTag, TIMESTAMP_OPTIONS);
}
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
function vietnamese() {
  if (!changeLocale) throw new Error('Locale setter missing');
  act(() => changeLocale?.('vi'));
}

describe('MF06 request and history presentation locale', () => {
  it('switches the history labels and timestamps without refetching immutable records or converting unavailable identity to unauthorized', async () => {
    const list = vi.fn().mockResolvedValue(page([assessment]));
    const { container } = mount(
      { listMf06Assessments: list } as unknown as SmartSiteManagementClient,
      'history',
    );
    await screen.findByText('Lịch sử đánh giá khu vực hạn chế MF06');
    await screen.findByText('Chưa xác định được danh tính');
    expect(screen.queryByText('Không được phép')).toBeNull();
    expect(screen.getByText(assessment.assessmentId)).toBeDefined();

    const capturedTime = container.querySelector(`time[datetime="${assessment.capturedAt}"]`);
    const assessedTime = container.querySelector(`time[datetime="${assessment.assessedAt}"]`);
    expect(capturedTime?.getAttribute('datetime')).toBe(assessment.capturedAt);
    expect(assessedTime?.getAttribute('datetime')).toBe(assessment.assessedAt);
    expect(expectedTimestamp(assessment.capturedAt, 'vi-VN')).not.toBe(
      expectedTimestamp(assessment.capturedAt, 'en-US'),
    );
    expect(capturedTime?.textContent).toBe(expectedTimestamp(assessment.capturedAt, 'vi-VN'));
    expect(assessedTime?.textContent).toBe(expectedTimestamp(assessment.assessedAt, 'vi-VN'));
    expect(capturedTime?.textContent).toContain('UTC');
    expect(assessedTime?.textContent).toContain('UTC');

    english();
    await screen.findByText('MF06 Restricted Zone Assessment History');
    await screen.findByText('Identity Unavailable');
    expect(screen.getByText(assessment.assessmentId)).toBeDefined();
    expect(capturedTime?.getAttribute('datetime')).toBe(assessment.capturedAt);
    expect(assessedTime?.getAttribute('datetime')).toBe(assessment.assessedAt);
    expect(capturedTime?.textContent).toBe(expectedTimestamp(assessment.capturedAt, 'en-US'));
    expect(assessedTime?.textContent).toBe(expectedTimestamp(assessment.assessedAt, 'en-US'));
    expect(capturedTime?.textContent).toContain('UTC');
    expect(assessedTime?.textContent).toContain('UTC');
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('keeps the selected request tab, NOT_QUEUED snapshot, and deadlineAt timestamps while switching locale without enqueue or refetch', async () => {
    const requests = vi.fn().mockResolvedValue(page([request, deadlineRequest]));
    const history = vi.fn().mockResolvedValue(page([]));
    const { container } = mount(
      {
        listMf06RequestStatuses: requests,
        listMf06Assessments: history,
      } as unknown as SmartSiteManagementClient,
      'requests',
    );
    const tab = await screen.findByRole('tab', { name: 'Yêu cầu' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Chưa vào hàng đợi');
    await screen.findByText('Không có');

    const trackedIsoValues = [
      request.capturedAt,
      request.requestedAt,
      deadlineRequest.capturedAt,
      deadlineRequest.requestedAt,
      deadlineRequest.deadlineAt!,
    ];
    for (const iso of trackedIsoValues) {
      const timeEl = container.querySelector(`time[datetime="${iso}"]`);
      expect(timeEl?.getAttribute('datetime')).toBe(iso);
      expect(timeEl?.textContent).toBe(expectedTimestamp(iso, 'vi-VN'));
      expect(timeEl?.textContent).toContain('UTC');
    }

    english();
    expect(screen.getByRole('tab', { name: 'Requests' })).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Not Queued');
    await screen.findByText('None');
    for (const iso of trackedIsoValues) {
      const timeEl = container.querySelector(`time[datetime="${iso}"]`);
      expect(timeEl?.getAttribute('datetime')).toBe(iso);
      expect(timeEl?.textContent).toBe(expectedTimestamp(iso, 'en-US'));
      expect(timeEl?.textContent).toContain('UTC');
    }
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
  it.each(['history', 'requests'] as const)(
    'localizes manual %s Refresh/Refreshing and busy-empty status across locale switches without showing settled-empty copy while pending',
    async (kind) => {
      let resolveRefresh!: (value: ReturnType<typeof page<unknown>>) => void;
      const list = vi
        .fn()
        .mockResolvedValueOnce(page([]))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRefresh = resolve;
            }),
        );
      const otherList = vi.fn().mockResolvedValue(page([]));
      mount(
        (kind === 'history'
          ? { listMf06Assessments: list, listMf06RequestStatuses: otherList }
          : {
              listMf06RequestStatuses: list,
              listMf06Assessments: otherList,
            }) as unknown as SmartSiteManagementClient,
        kind,
      );

      const emptyVi =
        kind === 'history'
          ? 'Chưa có lịch sử đánh giá được lưu.'
          : 'Chưa có yêu cầu đánh giá được lưu.';
      const emptyEn =
        kind === 'history' ? 'No recorded assessment history.' : 'No recorded assessment requests.';
      const busyStatusVi = kind === 'history' ? 'Đang làm mới...' : 'Đang tải yêu cầu đánh giá...';
      const busyStatusEn = kind === 'history' ? 'Refreshing...' : 'Loading assessment requests...';

      await screen.findByText(emptyVi);
      fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));

      await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
      expect(
        (screen.getByRole('button', { name: 'Đang làm mới...' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      const statusVi = screen.getByRole('status');
      expect(statusVi.getAttribute('aria-busy')).toBe('true');
      expect(within(statusVi).getByText(busyStatusVi)).toBeDefined();
      expect(screen.queryByText(emptyVi)).toBeNull();

      english();
      expect(
        (screen.getByRole('button', { name: 'Refreshing...' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      const statusEn = screen.getByRole('status');
      expect(statusEn.getAttribute('aria-busy')).toBe('true');
      expect(within(statusEn).getByText(busyStatusEn)).toBeDefined();
      expect(screen.queryByText(emptyEn)).toBeNull();
      expect(screen.queryByText(emptyVi)).toBeNull();
      expect(list).toHaveBeenCalledTimes(2);
      expect(otherList).not.toHaveBeenCalled();

      await act(async () => resolveRefresh(page([])));
      await screen.findByText(emptyEn);
      expect(screen.getByRole('status').getAttribute('aria-busy')).not.toBe('true');
      expect((screen.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
    },
  );
  it('preserves open request Technical references disclosure and selected assessment across locale switches without extra API calls or enqueue', async () => {
    const succeededRequest: Mf06RequestStatusResponse = {
      ...request,
      jobStatus: 'SUCCEEDED',
      assessmentId: assessment.assessmentId,
    };
    const requests = vi.fn().mockResolvedValue(page([succeededRequest]));
    const history = vi.fn().mockResolvedValue(page([]));
    const getAssessment = vi.fn().mockResolvedValue(assessment);
    mount(
      {
        listMf06RequestStatuses: requests,
        listMf06Assessments: history,
        getMf06Assessment: getAssessment,
      } as unknown as SmartSiteManagementClient,
      'requests',
    );

    const tab = await screen.findByRole('tab', { name: 'Yêu cầu' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Hoàn tất');
    expect(screen.getByText(succeededRequest.cameraId).closest('details')).toBeNull();
    expect(screen.getByText(succeededRequest.zoneId).closest('details')).toBeNull();

    const requestRow = screen.getByText(succeededRequest.cameraId).closest('li');
    expect(requestRow).toBeTruthy();
    const details = within(requestRow!).getByText('Thông tin kỹ thuật').closest('details');
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(within(details!).getByText('Mã yêu cầu:')).toBeDefined();
    expect(within(details!).getByText(succeededRequest.requestId)).toBeDefined();
    expect(within(details!).getByText('Mã sự kiện:')).toBeDefined();
    expect(within(details!).getByText(succeededRequest.eventId)).toBeDefined();
    expect(within(details!).getByText('Mã đánh giá:')).toBeDefined();
    expect(within(details!).getByText(assessment.assessmentId)).toBeDefined();

    if (details) details.open = true;
    expect(details?.open).toBe(true);

    const viewButton = screen.getByRole('button', { name: 'Xem đánh giá' });
    expect(viewButton.closest('details')).toBeNull();
    fireEvent.click(viewButton);
    const dialogVi = await screen.findByRole('dialog', { name: 'Đánh giá đã lưu' });
    expect(await within(dialogVi).findByText('Chưa xác định được danh tính')).toBeDefined();
    const dialogDetails = within(dialogVi).getByText('Thông tin kỹ thuật').closest('details');
    expect(dialogDetails).toBeTruthy();
    expect(dialogDetails?.open).toBe(false);

    english();
    expect(screen.getByRole('tab', { name: 'Requests', hidden: true })).toBe(tab);
    expect(tab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('Succeeded');
    expect(screen.getByRole('button', { name: 'View assessment', hidden: true })).toBe(viewButton);
    expect(viewButton.closest('details')).toBeNull();

    const detailsEn = within(requestRow!).getByText('Technical references').closest('details');
    expect(detailsEn).toBe(details);
    expect(detailsEn?.open).toBe(true);
    expect(within(detailsEn!).getByText('Request ID:')).toBeDefined();
    expect(within(detailsEn!).getByText('Event ID:')).toBeDefined();
    expect(within(detailsEn!).getByText('Assessment ID:')).toBeDefined();

    const dialogEn = screen.getByRole('dialog', { name: 'Recorded assessment' });
    expect(within(dialogEn).getByText('Identity Unavailable')).toBeDefined();
    expect(within(dialogEn).getByText('Technical references').closest('details')).toBe(
      dialogDetails,
    );

    vietnamese();
    expect(screen.getByRole('tab', { name: 'Yêu cầu', hidden: true })).toBe(tab);
    expect(screen.getByRole('button', { name: 'Xem đánh giá', hidden: true })).toBe(viewButton);
    expect(within(requestRow!).getByText('Thông tin kỹ thuật').closest('details')).toBe(details);
    expect(details?.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Đánh giá đã lưu' })).toBe(dialogEn);
    expect(within(dialogEn).getByText('Thông tin kỹ thuật').closest('details')).toBe(dialogDetails);
    expect(requests).toHaveBeenCalledTimes(1);
    expect(getAssessment).toHaveBeenCalledTimes(1);
    expect(history).not.toHaveBeenCalled();
  });
});
