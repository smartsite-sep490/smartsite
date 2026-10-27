// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentPage,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import type { AssessmentTargetContext } from './mf06AssessmentDetailBinding';

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const CREDENTIAL_1 = 'cred-usability-1';
const TOKEN_1 = 'token-usability-1';
const TOKEN_2 = 'token-usability-2';

const sampleTarget: AssessmentTargetContext = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  siteId: SITE_1,
  requestId: '22222222-2222-4222-8222-222222222222',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  capturedAt: '2026-10-12T10:00:00.123456Z',
};

function createAssessment(overrides?: Partial<Mf06AssessmentResponse>): Mf06AssessmentResponse {
  return {
    assessmentId: sampleTarget.assessmentId,
    requestId: sampleTarget.requestId,
    siteId: SITE_1,
    eventId: sampleTarget.eventId,
    cameraId: sampleTarget.cameraId,
    zoneId: sampleTarget.zoneId,
    capturedAt: sampleTarget.capturedAt,
    assessedAt: '2026-10-12T10:00:02.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    outcome: 'UNAVAILABLE',
    reasonCode: 'IDENTITY_UNAVAILABLE',
    evaluatorVersion: 'SYNTHETIC_READ_V1',
    provenance: 'UNAVAILABLE',
    ...overrides,
  };
}

function createPage(
  items: Mf06AssessmentResponse[] = [createAssessment()],
  total = items.length,
  offset = 0,
  limit = 20,
): Mf06AssessmentPage {
  return { items, total, offset, limit };
}

const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function mount(ui: (queries: QueryClient) => React.ReactElement) {
  const queries = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  clients.push(queries);
  const view = render(<QueryClientProvider client={queries}>{ui(queries)}</QueryClientProvider>);
  return {
    ...view,
    queries,
  };
}

describe('MF06 recorded assessment usability & accessibility regressions', () => {
  let mockListMf06Assessments: ReturnType<typeof vi.fn>;
  let mockGetMf06Assessment: ReturnType<typeof vi.fn>;
  let mockClient: SmartSiteManagementClient;

  beforeEach(() => {
    mockListMf06Assessments = vi.fn();
    mockGetMf06Assessment = vi.fn();
    mockClient = {
      getMf06AssessmentFrame: vi
        .fn()
        .mockRejectedValue(new ApiError('http', 'No frame fixture', 404)),
      listMf06Assessments: mockListMf06Assessments,
      getMf06Assessment: mockGetMf06Assessment,
    } as unknown as SmartSiteManagementClient;
  });

  it('announces busy status live region while retrying transient 503 history failure and settles to genuine empty state without false empty flash', async () => {
    let resolveRetry!: (page: Mf06AssessmentPage) => void;
    const pendingRetry = new Promise<Mf06AssessmentPage>((resolve) => {
      resolveRetry = resolve;
    });

    mockListMf06Assessments
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockImplementationOnce(() => pendingRetry);

    mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(
      await screen.findByText('Assessment service temporarily unavailable (503).'),
    ).toBeTruthy();
    expect(screen.queryByText('No recorded assessment history.')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockListMf06Assessments).toHaveBeenCalledTimes(2);
    });

    const busyStatus = screen.getByRole('status');
    expect(busyStatus.getAttribute('aria-live')).toBe('polite');
    expect(busyStatus.getAttribute('aria-busy')).toBe('true');
    expect(within(busyStatus).getByText('Loading assessment history...')).toBeTruthy();
    expect(retryBtn.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(mockListMf06Assessments).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No recorded assessment history.')).toBeNull();

    await act(async () => {
      resolveRetry(createPage([], 0, 0, 20));
    });

    expect(await screen.findByText('No recorded assessment history.')).toBeTruthy();
    const settledEmpty = screen.getByRole('status');
    expect(settledEmpty.getAttribute('aria-live')).toBe('polite');
    expect(settledEmpty.getAttribute('aria-busy')).not.toBe('true');
  });

  it('announces busy status live region on initial load and while retrying transient 503 failure in Mf06AssessmentDetailDialog', async () => {
    let rejectInitial!: (err: Error) => void;
    let resolveRetry!: (record: Mf06AssessmentResponse) => void;

    mockGetMf06Assessment
      .mockImplementationOnce(
        () =>
          new Promise<Mf06AssessmentResponse>((_, reject) => {
            rejectInitial = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Mf06AssessmentResponse>((resolve) => {
            resolveRetry = resolve;
          }),
      );

    mount(() => (
      <Mf06AssessmentDetailDialog
        open={true}
        onClose={vi.fn()}
        target={sampleTarget}
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    const initialStatus = within(dialog).getByRole('status');
    expect(initialStatus.getAttribute('aria-live')).toBe('polite');
    expect(initialStatus.getAttribute('aria-busy')).toBe('true');
    expect(within(initialStatus).getByText('Loading assessment details...')).toBeTruthy();

    await act(async () => {
      rejectInitial(new ApiError('http', 'Service Unavailable', 503));
    });

    expect(
      await within(dialog).findByText('Assessment service temporarily unavailable (503).'),
    ).toBeTruthy();
    expect(dialog.querySelector('[role="status"][aria-busy="true"]')).toBeNull();

    const retryBtn = within(dialog).getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockGetMf06Assessment).toHaveBeenCalledTimes(2);
    });

    const retryStatus = within(dialog).getByRole('status');
    expect(retryStatus.getAttribute('aria-live')).toBe('polite');
    expect(retryStatus.getAttribute('aria-busy')).toBe('true');
    expect(within(retryStatus).getByText('Loading assessment details...')).toBeTruthy();
    expect(retryBtn.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    await act(async () => {
      resolveRetry(createAssessment());
    });

    expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();
    expect(within(dialog).getByText('Unavailable')).toBeTruthy();
    expect(within(dialog).queryByText('Allowed')).toBeNull();
    expect(dialog.querySelector('[role="status"][aria-busy="true"]')).toBeNull();
  });

  it('prioritizes Camera and Zone spatial context before technical correlation IDs in detail dialog and collapses long technical references in history cards with scope reset', async () => {
    const record = createAssessment();
    mockListMf06Assessments.mockResolvedValue(createPage([record], 1, 0, 20));
    mockGetMf06Assessment.mockResolvedValue(record);

    const view = mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(await screen.findByText('Identity Unavailable')).toBeTruthy();

    const cameraText = screen.getByText(record.cameraId);
    const zoneText = screen.getByText(record.zoneId);
    const viewBtn = screen.getByRole('button', { name: 'View assessment' });
    expect(cameraText.closest('details')).toBeTruthy();
    expect(zoneText.closest('details')).toBe(cameraText.closest('details'));
    expect(viewBtn.closest('details')).toBeNull();
    expect(viewBtn.className).toContain('focus-visible:outline');

    const summary = screen.getByText('Technical references');
    const details = summary.closest('details');
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(within(details!).getByText(record.assessmentId)).toBeTruthy();
    expect(within(details!).getByText(record.provenance)).toBeTruthy();
    expect(within(details!).getByText(record.requestId)).toBeTruthy();
    expect(within(details!).getByText(record.eventId)).toBeTruthy();

    if (details) {
      details.open = true;
    }
    expect(details?.open).toBe(true);

    fireEvent.click(viewBtn);
    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();

    const dialogCameraLabel = within(dialog).getByText('Camera ID:');
    const dialogZoneLabel = within(dialog).getByText('Zone ID:');
    const dialogAssessmentLabel = within(dialog).getByText('Assessment ID:');
    const dialogRequestLabel = within(dialog).getByText('Request ID:');
    const dialogEventLabel = within(dialog).getByText('Event ID:');
    const dialogProvenanceLabel = within(dialog).getByText('Provenance:');

    expect(
      Boolean(
        dialogCameraLabel.compareDocumentPosition(dialogAssessmentLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        dialogZoneLabel.compareDocumentPosition(dialogAssessmentLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(within(dialog).getByText(record.requestId)).toBeTruthy();
    expect(within(dialog).getByText(record.eventId)).toBeTruthy();
    expect(dialogRequestLabel).toBeTruthy();
    expect(dialogEventLabel).toBeTruthy();
    expect(dialogProvenanceLabel).toBeTruthy();

    view.rerender(
      <QueryClientProvider client={view.queries}>
        <Mf06AssessmentHistory
          token={TOKEN_2}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(mockListMf06Assessments).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Recorded assessment' })).toBeNull();
    });

    const nextDetails = screen.getByText('Technical references').closest('details');
    expect(nextDetails).toBeTruthy();
    expect(nextDetails).not.toBe(details);
    expect(nextDetails?.open).toBe(false);
  });

  it('keeps Load more accessible without false empty message when adapter page filters out cross-site rows and preserves case-insensitive UUID target binding', async () => {
    const otherSite = '99999999-9999-4999-8999-999999999999';
    const crossSitePage = createPage(
      Array.from({ length: 20 }, (_, i) =>
        createAssessment({
          assessmentId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
          siteId: otherSite,
        }),
      ),
      21,
      0,
      20,
    );
    const validRecordUpperSite = createAssessment({
      assessmentId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
      siteId: SITE_1.toUpperCase(),
      cameraId: '77777777-7777-4777-8777-777777777777',
    });
    const secondPage = createPage([validRecordUpperSite], 21, 20, 20);

    mockListMf06Assessments.mockResolvedValueOnce(crossSitePage).mockResolvedValueOnce(secondPage);
    mockGetMf06Assessment.mockResolvedValue({
      ...validRecordUpperSite,
      assessmentId: validRecordUpperSite.assessmentId.toLowerCase(),
      siteId: SITE_1.toLowerCase(),
    });

    mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const loadMoreBtn = await screen.findByRole('button', { name: 'Load more (20)' });
    expect(loadMoreBtn).toBeTruthy();
    expect(screen.queryByText('No recorded assessment history.')).toBeNull();

    fireEvent.click(loadMoreBtn);

    expect(await screen.findByText(validRecordUpperSite.cameraId)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View assessment' }));

    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(dialog).findByText('Identity Unavailable')).toBeTruthy();
  });
});
