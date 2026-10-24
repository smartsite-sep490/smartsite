// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([false, true])('refreshes new history only while AI work is active (paused=%s)', async (paused) => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_AI_WORK_PAUSED', String(paused));
  const siteId = '33333333-3333-4333-8333-333333333331';
  const record = {
    assessmentId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    siteId,
    eventId: '44444444-4444-4444-8444-444444444444',
    cameraId: '55555555-5555-4555-8555-555555555555',
    zoneId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-22T12:16:44.000Z',
    assessedAt: '2026-10-22T12:16:48.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    outcome: 'UNAVAILABLE',
    reasonCode: 'IDENTITY_UNAVAILABLE',
    evaluatorVersion: 'SYNTHETIC_READ_V1',
    provenance: 'UNAVAILABLE',
  };
  const list = vi.fn()
    .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 20 })
    .mockResolvedValue({ items: [record], total: 1, offset: 0, limit: 20 });
  const client = { listMf06Assessments: list } as unknown as SmartSiteManagementClient;
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(query);
  render(<QueryClientProvider client={query}>
    <Mf06AssessmentHistory token="synthetic-token" siteId={siteId} credentialId="synthetic-session" client={client} />
  </QueryClientProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_100); });
  expect(list).toHaveBeenCalledTimes(paused ? 1 : 2);
  expect(Boolean(screen.queryByText('Identity Unavailable'))).toBe(!paused);
});
