// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  type SafetyAlertDetectionResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { SafetyAlertEvidencePanel } from './SafetyAlertEvidencePanel';
import type { ObservationIdentityReviewPanelProps } from './ObservationIdentityReviewPanel';

const review = vi.hoisted(() => vi.fn());
vi.mock('./ObservationIdentityReviewPanel', () => ({
  ObservationIdentityReviewPanel: (props: ObservationIdentityReviewPanelProps) => {
    review(props);
    return <div data-testid="review-blob">{props.evidenceBlob ? 'HAS_BLOB' : 'NO_BLOB'}</div>;
  },
}));

const detection: SafetyAlertDetectionResponse = {
  eventId: 'event-a',
  cameraExternalId: 'CAM-A',
  capturedAt: '2026-10-09T00:00:00Z',
  processingStatus: 'PROCESSED',
  evidence: [{ index: 0, kind: 'FRAME', available: true }],
};
const scope = {
  apiUrl: 'http://localhost:3000',
  token: 'test-token',
  sessionScope: 'session-a',
  siteId: 'site-a',
  alertId: 'alert-a',
  canReviewIdentity: true,
};
let queryClient: QueryClient;
beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-evidence');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  review.mockClear();
});

function mount(fetchEvidence: ReturnType<typeof vi.fn>) {
  const client = { getSafetyAlertEvidence: fetchEvidence } as unknown as SmartSiteManagementClient;
  const content = (currentDetection = detection) => (
    <QueryClientProvider client={queryClient}>
      <SafetyAlertEvidencePanel {...scope} client={client} detection={currentDetection} />
    </QueryClientProvider>
  );
  return { ...render(content()), content };
}

it.each([401, 403, 404, 503])(
  'does not pass a retained private image to identity review after refetch HTTP %i',
  async (status) => {
    const blob = new Blob(['private-photo'], { type: 'image/jpeg' });
    const fetchEvidence = vi
      .fn()
      .mockResolvedValueOnce(blob)
      .mockRejectedValue(new ApiError('http', 'private-service-canary', status));
    mount(fetchEvidence);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    await screen.findByRole('img');
    expect(screen.getByTestId('review-blob').textContent).toBe('HAS_BLOB');
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['safety-alert-evidence'] });
    });
    await screen.findByRole('alert');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => query.state.status === 'error' && query.state.data === blob),
    ).toBe(true);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
    expect(review.mock.calls.at(-1)?.[0].evidenceBlob).toBeNull();
  },
);

it('withdraws the reviewed image when refreshed metadata marks the selected image unavailable', async () => {
  const { rerender, content } = mount(
    vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' })),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
  await screen.findByRole('img');
  rerender(content({ ...detection, evidence: [{ index: 0, kind: 'FRAME', available: false }] }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
});

it.each([401, 403])(
  'does not automatically retry or enable manual retry after HTTP %i',
  async (status) => {
    queryClient.setDefaultOptions({ queries: { retry: 2, retryDelay: 0, gcTime: 0 } });
    const fetchEvidence = vi.fn().mockRejectedValue(new ApiError('http', 'denied', status));
    mount(fetchEvidence);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    await screen.findByRole('alert');
    expect(fetchEvidence).toHaveBeenCalledTimes(1);
    const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    await userEvent.setup().click(retry);
    expect(fetchEvidence).toHaveBeenCalledTimes(1);
  },
);

it('allows explicit retry after a transient failure and passes only the successfully fetched image', async () => {
  const blob = new Blob(['replacement'], { type: 'image/jpeg' });
  const fetchEvidence = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('http', 'offline', 503))
    .mockResolvedValue(blob);
  mount(fetchEvidence);
  await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
  await screen.findByRole('alert');
  expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('img');
  await waitFor(() => expect(review.mock.calls.at(-1)?.[0].evidenceBlob).toBe(blob));
  expect(fetchEvidence).toHaveBeenCalledTimes(2);
});

it.each(['allocation', 'decode'])(
  'offers a safe retry instead of using an undisplayable image after %s failure',
  async (failure) => {
    const original = new Blob(['broken-photo'], { type: 'image/jpeg' });
    const replacement = new Blob(['replacement-photo'], { type: 'image/jpeg' });
    if (failure === 'allocation') {
      vi.mocked(URL.createObjectURL).mockImplementationOnce(() => {
        throw new Error('private-browser-canary');
      });
    }
    const fetchEvidence = vi.fn().mockResolvedValueOnce(original).mockResolvedValue(replacement);
    mount(fetchEvidence);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    if (failure === 'decode') fireEvent.error(await screen.findByRole('img'));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.body.textContent).not.toContain('private-browser-canary');
    if (failure === 'decode')
      await waitFor(() =>
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-evidence'),
      );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry image' }));
    await screen.findByRole('img');
    expect(fetchEvidence).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('review-blob').textContent).toBe('HAS_BLOB');
    expect(review.mock.calls.at(-1)?.[0].evidenceBlob).toBe(replacement);
  },
);

it('notifies onUnauthorized on HTTP 401 and cancels in-flight evidence fetch on sessionScope change', async () => {
  const onUnauthorized = vi.fn();
  let firstSignal: AbortSignal | undefined;
  const fetchEvidence = vi
    .fn()
    .mockImplementationOnce(
      (
        _token: string,
        _siteId: string,
        _alertId: string,
        _eventId: string,
        _index: number,
        options?: { signal?: AbortSignal },
      ) => {
        firstSignal = options?.signal;
        return new Promise<Blob>(() => {});
      },
    )
    .mockRejectedValueOnce(new ApiError('http', 'expired-token-canary', 401));
  const client = { getSafetyAlertEvidence: fetchEvidence } as unknown as SmartSiteManagementClient;

  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <SafetyAlertEvidencePanel
        {...scope}
        client={client}
        detection={detection}
        onUnauthorized={onUnauthorized}
      />
    </QueryClientProvider>,
  );

  await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
  expect(firstSignal).toBeDefined();
  expect(firstSignal?.aborted).toBe(false);

  rerender(
    <QueryClientProvider client={queryClient}>
      <SafetyAlertEvidencePanel
        {...scope}
        sessionScope="session-b"
        token="next-token"
        client={client}
        detection={detection}
        onUnauthorized={onUnauthorized}
      />
    </QueryClientProvider>,
  );

  expect(firstSignal?.aborted).toBe(true);
  await screen.findByRole('alert');
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
  expect(document.body.textContent).not.toContain('expired-token-canary');
});

it('updates settled error and unreadable image fallback across EN and VI language switch without refetching', async () => {
  const brokenBlob = new Blob(['corrupt-jpeg'], { type: 'image/jpeg' });
  const fetchEvidence = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('http', 'rate-limit-canary', 429))
    .mockResolvedValueOnce(brokenBlob);
  mount(fetchEvidence);

  await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
  const alertEl = await screen.findByRole('alert');
  expect(alertEl.textContent).toContain('Too many requests. Wait before trying again.');
  expect(alertEl.textContent).not.toContain('rate-limit-canary');

  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
  );
  expect(screen.getByRole('button', { name: 'Thử lại' })).not.toBeNull();
  expect(fetchEvidence).toHaveBeenCalledTimes(1);

  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Too many requests. Wait before trying again.',
  );

  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.error(await screen.findByRole('img'));

  expect(await screen.findByRole('alert')).not.toBeNull();
  expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
  expect(screen.getByRole('alert').textContent).toContain(
    'The evidence image could not be displayed. Try loading it again.',
  );
  expect(screen.getByRole('button', { name: 'Retry image' })).not.toBeNull();

  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('alert').textContent).toContain(
    'Không thể hiển thị ảnh bằng chứng. Hãy thử tải lại.',
  );
  expect(screen.getByRole('button', { name: 'Thử tải lại ảnh' })).not.toBeNull();
  expect(screen.getByTestId('review-blob').textContent).toBe('NO_BLOB');
  expect(fetchEvidence).toHaveBeenCalledTimes(2);
});
