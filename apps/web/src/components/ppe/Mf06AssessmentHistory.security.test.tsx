// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Mf06AssessmentPage,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';

const siteId = '33333333-3333-4333-8333-333333333333';
const page: Mf06AssessmentPage = {
  items: [
    {
      assessmentId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      siteId,
      eventId: '44444444-4444-4444-8444-444444444444',
      cameraId: '55555555-5555-4555-8555-555555555555',
      zoneId: '66666666-6666-4666-8666-666666666666',
      capturedAt: '2026-10-12T10:00:00Z',
      assessedAt: '2026-10-12T10:00:01Z',
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      evaluatorVersion: 'old-access-only',
      provenance: 'UNAVAILABLE',
    },
  ],
  total: 1,
  offset: 0,
  limit: 20,
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});
function mount(list: ReturnType<typeof vi.fn>) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const client = { listMf06Assessments: list } as unknown as SmartSiteManagementClient;
  const ui = (token = 'token-a', credentialId = 'reused-caller-id') => (
    <QueryClientProvider client={queries}>
      <Mf06AssessmentHistory
        token={token}
        siteId={siteId}
        credentialId={credentialId}
        client={client}
      />
    </QueryClientProvider>
  );
  return {
    ...render(ui()),
    queries,
    changeToken: (token: string) => ui(token),
    changeCredential: (id: string) => ui('token-a', id),
  };
}
it('changing token with reused caller credentialId hides old history synchronously and sends a fresh request', async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce(page)
    .mockImplementation(() => new Promise(() => undefined));
  const view = mount(list);
  await screen.findByText('vold-access-only');
  view.rerender(view.changeToken('token-b'));
  expect(screen.queryByText('vold-access-only')).toBeNull();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(
    JSON.stringify(
      view.queries
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ),
  ).not.toMatch(/token-a|token-b/);
});
it('changing caller credential scope releases the previous hard-error latch and rechecks the server', async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('http', 'forbidden', 403))
    .mockResolvedValue(page);
  const view = mount(list);
  await screen.findByRole('alert');
  await waitFor(() =>
    expect(
      view.queries
        .getQueryCache()
        .getAll()
        .some((query) => query.state.data),
    ).toBe(false),
  );
  view.rerender(view.changeCredential('new-caller-scope'));
  await screen.findByText('vold-access-only');
  expect(list).toHaveBeenCalledTimes(2);
});
it('a failed BASE refresh hides prior history and offers base retry rather than a next-page retry', async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce(page)
    .mockRejectedValue(new ApiError('network', 'offline'));
  const view = mount(list);
  await screen.findByText('vold-access-only');
  await act(async () => {
    await view.queries.refetchQueries({ queryKey: ['mf06-assessments'] });
  });
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Could not load assessment history'),
  );
  expect(screen.queryByText('vold-access-only')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Could not load assessment history');
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry loading next page' })).toBeNull();
});
it('hard next-page403 hides history AND exposes the permission error', async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({ ...page, total: 2 })
    .mockRejectedValue(new ApiError('http', 'forbidden', 403));
  const view = mount(list);
  await screen.findByText('vold-access-only');
  fireEvent.click(screen.getByRole('button', { name: 'Load more (20)' }));
  await waitFor(() => expect(screen.queryByText('vold-access-only')).toBeNull());
  expect(screen.getByRole('alert').textContent).toContain('You do not have permission');
  expect(screen.queryByText('No recorded assessment history.')).toBeNull();
  await waitFor(() =>
    expect(
      view.queries
        .getQueryCache()
        .getAll()
        .some((query) => {
          const data = query.state.data as { pages?: Mf06AssessmentPage[] } | undefined;
          return data?.pages?.some((p) => p.items.length > 0);
        }),
    ).toBe(false),
  );
});
