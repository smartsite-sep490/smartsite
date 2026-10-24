// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type Mf06AssessmentPage,
  type Mf06AssessmentResponse,
  type Mf06RequestStatusPage,
  type Mf06RequestStatusResponse,
} from '@smartsite/api-client';
import { Mf06ZoneAssessmentPanel } from './Mf06ZoneAssessmentPanel';

const API_URL = 'https://mf06-synthetic-api.invalid';
const SITE_A = '33333333-3333-4333-8333-333333333331';
const SITE_B = '33333333-3333-4333-8333-333333333332';
const TOKEN_A = 'synthetic-token-alpha';
const TOKEN_B = 'synthetic-token-beta';
const CRED_A = 'cred-alpha';
const CRED_B = 'cred-beta';

const REQUEST_1: Mf06RequestStatusResponse = {
  requestId: '22222222-2222-4222-8222-222222222201',
  siteId: SITE_A,
  eventId: '44444444-4444-4444-8444-444444444401',
  cameraId: '55555555-5555-4555-8555-555555555501',
  zoneId: '66666666-6666-4666-8666-666666666601',
  capturedAt: '2026-10-12T10:00:00.000Z',
  requestedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'SUCCEEDED',
  attemptCount: 1,
  deadlineAt: '2026-10-12T10:00:05.000Z',
  deadlinePassed: false,
  assessmentId: '11111111-1111-4111-8111-111111111101',
};

const REQUEST_2: Mf06RequestStatusResponse = {
  requestId: '22222222-2222-4222-8222-222222222202',
  siteId: SITE_A,
  eventId: '44444444-4444-4444-8444-444444444402',
  cameraId: '55555555-5555-4555-8555-555555555502',
  zoneId: '66666666-6666-4666-8666-666666666602',
  capturedAt: '2026-10-12T10:05:00.000Z',
  requestedAt: '2026-10-12T10:05:01.000Z',
  purpose: 'RETROSPECTIVE_REVIEW',
  jobStatus: 'SUCCEEDED',
  attemptCount: 1,
  deadlineAt: '2026-10-12T10:05:05.000Z',
  deadlinePassed: false,
  assessmentId: '11111111-1111-4111-8111-111111111102',
};

const ASSESSMENT_1: Mf06AssessmentResponse = {
  assessmentId: REQUEST_1.assessmentId!,
  requestId: REQUEST_1.requestId,
  siteId: SITE_A,
  eventId: REQUEST_1.eventId,
  cameraId: REQUEST_1.cameraId,
  zoneId: REQUEST_1.zoneId,
  capturedAt: REQUEST_1.capturedAt,
  assessedAt: '2026-10-12T10:00:02.000Z',
  purpose: REQUEST_1.purpose,
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_READ_V1',
  provenance: 'UNAVAILABLE',
};

const ASSESSMENT_2: Mf06AssessmentResponse = {
  assessmentId: REQUEST_2.assessmentId!,
  requestId: REQUEST_2.requestId,
  siteId: SITE_A,
  eventId: REQUEST_2.eventId,
  cameraId: REQUEST_2.cameraId,
  zoneId: REQUEST_2.zoneId,
  capturedAt: REQUEST_2.capturedAt,
  assessedAt: '2026-10-12T10:05:02.000Z',
  purpose: REQUEST_2.purpose,
  outcome: 'UNAVAILABLE',
  reasonCode: 'SERVICE_DISABLED',
  evaluatorVersion: 'SYNTHETIC_READ_V2',
  provenance: 'UNAVAILABLE',
};

const ASSESSMENT_SITE_B: Mf06AssessmentResponse = {
  assessmentId: '11111111-1111-4111-8111-111111111199',
  requestId: '22222222-2222-4222-8222-222222222299',
  siteId: SITE_B,
  eventId: '44444444-4444-4444-8444-444444444499',
  cameraId: '55555555-5555-4555-8555-555555555599',
  zoneId: '66666666-6666-4666-8666-666666666699',
  capturedAt: '2026-10-12T11:00:00.000Z',
  assessedAt: '2026-10-12T11:00:02.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'MEDIA_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_SITE_B_V1',
  provenance: 'UNAVAILABLE',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('MF06 Request -> Detail -> History -> Detail API-Client Journey', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  });

  it('navigates request -> detail -> close -> history -> detail with distinct bound records and aborts/clears on Site/session change', async () => {
    const client = new SmartSiteManagementClient(API_URL);
    let pendingDetailSignal: AbortSignal | undefined;
    let pendingListSignal: AbortSignal | undefined;
    let blockSiteARequests = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const authHeader = new Headers(init?.headers).get('Authorization');

        if (
          url === `${API_URL}/api/v1/sites/${SITE_A}/mf06-assessment-requests?offset=0&limit=20` &&
          authHeader === `Bearer ${TOKEN_A}`
        ) {
          const page: Mf06RequestStatusPage = {
            items: [REQUEST_1, REQUEST_2],
            total: 2,
            offset: 0,
            limit: 20,
          };
          return jsonResponse(page);
        }

        if (
          url === `${API_URL}/api/v1/sites/${SITE_A}/mf06-assessments?offset=0&limit=20` &&
          authHeader === `Bearer ${TOKEN_A}`
        ) {
          if (blockSiteARequests) {
            pendingListSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => {});
          }
          const page: Mf06AssessmentPage = {
            items: [ASSESSMENT_1, ASSESSMENT_2],
            total: 2,
            offset: 0,
            limit: 20,
          };
          return jsonResponse(page);
        }

        if (
          url ===
            `${API_URL}/api/v1/sites/${SITE_A}/mf06-assessments/${ASSESSMENT_1.assessmentId}` &&
          authHeader === `Bearer ${TOKEN_A}`
        ) {
          if (blockSiteARequests) {
            pendingDetailSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => {});
          }
          return jsonResponse(ASSESSMENT_1);
        }

        if (
          url ===
            `${API_URL}/api/v1/sites/${SITE_A}/mf06-assessments/${ASSESSMENT_2.assessmentId}` &&
          authHeader === `Bearer ${TOKEN_A}`
        ) {
          return jsonResponse(ASSESSMENT_2);
        }

        if (
          url === `${API_URL}/api/v1/sites/${SITE_B}/mf06-assessments?offset=0&limit=20` &&
          authHeader === `Bearer ${TOKEN_B}`
        ) {
          const page: Mf06AssessmentPage = {
            items: [ASSESSMENT_SITE_B],
            total: 1,
            offset: 0,
            limit: 20,
          };
          return jsonResponse(page);
        }

        return jsonResponse({ message: `Unexpected request: ${url}` }, 404);
      },
    );

    const queries = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    clients.push(queries);

    const { container, rerender } = render(
      <QueryClientProvider client={queries}>
        <Mf06ZoneAssessmentPanel
          token={TOKEN_A}
          siteId={SITE_A}
          credentialId={CRED_A}
          apiUrl={API_URL}
          client={client}
          initialTab="requests"
        />
      </QueryClientProvider>,
    );

    // 1. Request list loads both distinct records via SmartSiteManagementClient
    expect(await screen.findByText(new RegExp(REQUEST_1.requestId))).toBeTruthy();
    expect(screen.getByText(new RegExp(REQUEST_2.requestId))).toBeTruthy();

    // Open detail for Record 1 from Requests tab
    const requestRow1 = screen.getByText(new RegExp(REQUEST_1.requestId)).closest('li');
    expect(requestRow1).not.toBeNull();
    fireEvent.click(within(requestRow1!).getByRole('button', { name: 'View assessment' }));

    const requestDetailDialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(requestDetailDialog).findByText('Identity Unavailable')).toBeTruthy();
    expect(within(requestDetailDialog).getByText(ASSESSMENT_1.assessmentId)).toBeTruthy();
    expect(within(requestDetailDialog).getByText(ASSESSMENT_1.requestId)).toBeTruthy();
    expect(within(requestDetailDialog).getByText(ASSESSMENT_1.eventId)).toBeTruthy();
    expect(within(requestDetailDialog).queryByText(ASSESSMENT_2.assessmentId)).toBeNull();
    expect(within(requestDetailDialog).queryByText(ASSESSMENT_2.requestId)).toBeNull();
    expect(within(requestDetailDialog).queryByText(ASSESSMENT_2.eventId)).toBeNull();

    // 2. Close detail dialog
    fireEvent.click(
      within(requestDetailDialog).getByRole('button', { name: 'Close dialog' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
    });

    // 3. Switch to Assessments history tab and open Record 2 detail
    fireEvent.click(screen.getByRole('tab', { name: 'Assessments' }));
    expect(await screen.findByText(new RegExp(ASSESSMENT_2.cameraId))).toBeTruthy();

    const historyRow2 = screen.getByText(new RegExp(ASSESSMENT_2.cameraId)).closest('li');
    expect(historyRow2).not.toBeNull();
    fireEvent.click(within(historyRow2!).getByRole('button', { name: 'View assessment' }));

    const historyDetailDialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(historyDetailDialog).findByText('Service Disabled')).toBeTruthy();
    expect(within(historyDetailDialog).getByText(ASSESSMENT_2.assessmentId)).toBeTruthy();
    expect(within(historyDetailDialog).getByText(ASSESSMENT_2.requestId)).toBeTruthy();
    expect(within(historyDetailDialog).getByText(ASSESSMENT_2.eventId)).toBeTruthy();
    // Assert no stale Record 1 request detail leaks into History detail dialog
    expect(within(historyDetailDialog).queryByText(ASSESSMENT_1.assessmentId)).toBeNull();
    expect(within(historyDetailDialog).queryByText(ASSESSMENT_1.requestId)).toBeNull();
    expect(within(historyDetailDialog).queryByText(ASSESSMENT_1.eventId)).toBeNull();
    expect(within(historyDetailDialog).queryByText('Identity Unavailable')).toBeNull();

    // 4. Close Record 2 detail, start in-flight Record 1 detail + Site A history refresh, then rotate Site/session
    fireEvent.click(
      within(historyDetailDialog).getByRole('button', { name: 'Close dialog' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
    });

    blockSiteARequests = true;
    const historyRow1 = screen.getByText(new RegExp(ASSESSMENT_1.cameraId)).closest('li');
    expect(historyRow1).not.toBeNull();
    act(() => {
      void queries.invalidateQueries({ queryKey: ['mf06-assessments'], refetchType: 'active' });
    });
    fireEvent.click(within(historyRow1!).getByRole('button', { name: 'View assessment' }));

    await waitFor(() => {
      expect(pendingDetailSignal).toBeDefined();
      expect(pendingListSignal).toBeDefined();
    });
    expect(pendingDetailSignal?.aborted).toBe(false);
    expect(pendingListSignal?.aborted).toBe(false);

    rerender(
      <QueryClientProvider client={queries}>
        <Mf06ZoneAssessmentPanel
          token={TOKEN_B}
          siteId={SITE_B}
          credentialId={CRED_B}
          apiUrl={API_URL}
          client={client}
          initialTab="assessments"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(pendingDetailSignal?.aborted).toBe(true);
      expect(pendingListSignal?.aborted).toBe(true);
    });
    expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
    expect(await screen.findByText(new RegExp(ASSESSMENT_SITE_B.cameraId))).toBeTruthy();
    expect(container.textContent).not.toContain(ASSESSMENT_1.cameraId);
    expect(container.textContent).not.toContain(ASSESSMENT_2.cameraId);
  });
});
