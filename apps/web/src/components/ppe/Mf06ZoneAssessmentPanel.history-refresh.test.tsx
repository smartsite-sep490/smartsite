// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { Mf06ZoneAssessmentPanel } from './Mf06ZoneAssessmentPanel';

const queries: QueryClient[] = [];
afterEach(() => {
  cleanup();
  queries.splice(0).forEach((query) => query.clear());
  vi.unstubAllEnvs();
});

it('refreshes the exact history when returning from a succeeded request inside the global fresh-cache window', async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  const siteId = '33333333-3333-4333-8333-333333333331';
  const request = {
    requestId: '22222222-2222-4222-8222-222222222222',
    siteId,
    eventId: '44444444-4444-4444-8444-444444444444',
    cameraId: '55555555-5555-4555-8555-555555555555',
    zoneId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-12T10:00:00.000Z',
    requestedAt: '2026-10-12T10:00:01.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    jobStatus: 'SUCCEEDED',
    attemptCount: 1,
    deadlineAt: '2026-10-12T10:00:05.000Z',
    deadlinePassed: false,
    assessmentId: '11111111-1111-4111-8111-111111111111',
  };
  const record = {
    assessmentId: request.assessmentId,
    requestId: request.requestId,
    siteId,
    eventId: request.eventId,
    cameraId: request.cameraId,
    zoneId: request.zoneId,
    capturedAt: request.capturedAt,
    assessedAt: '2026-10-12T10:00:03.000Z',
    purpose: request.purpose,
    outcome: 'UNAVAILABLE',
    reasonCode: 'IDENTITY_UNAVAILABLE',
    evaluatorVersion: 'SYNTHETIC_READ_V1',
    provenance: 'UNAVAILABLE',
  };
  const list = vi
    .fn()
    .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 20 })
    .mockResolvedValue({ items: [record], total: 1, offset: 0, limit: 20 });
  const requests = vi.fn().mockResolvedValue({ items: [request], total: 1, offset: 0, limit: 20 });
  const client = {
    listMf06Assessments: list,
    listMf06RequestStatuses: requests,
  } as unknown as SmartSiteManagementClient;
  const query = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 30_000,
      },
    },
  });
  queries.push(query);
  const foreignKey = ['mf06-assessments', 'foreign-api', 9001, siteId, 'foreign-session', 9002];
  query.setQueryData(foreignKey, { untouched: true });
  const foreignState = query.getQueryState(foreignKey);
  render(
    <QueryClientProvider client={query}>
      <Mf06ZoneAssessmentPanel
        token="synthetic-token"
        siteId={siteId}
        credentialId="synthetic-session"
        client={client}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('tab', { name: 'Requests' }));
  expect(await screen.findByText('Succeeded')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Assessments' }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
  expect(requests).toHaveBeenCalledTimes(1);
  expect(query.getQueryState(foreignKey)).toEqual(foreignState);
  expect(list.mock.calls[1]?.[0]).toBe('synthetic-token');
  expect(list.mock.calls[1]?.[1]).toBe(siteId);
});
