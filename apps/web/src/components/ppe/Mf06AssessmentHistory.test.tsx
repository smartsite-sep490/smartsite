// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentResponse,
  type Mf06AssessmentPage,
} from '@smartsite/api-client';

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const SITE_2 = '33333333-3333-4333-8333-333333333332';
const CREDENTIAL_1 = 'cred-test-1';
const TOKEN_1 = 'token-test-1';

function createAssessment(overrides?: Partial<Mf06AssessmentResponse>): Mf06AssessmentResponse {
  return {
    assessmentId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    siteId: SITE_1,
    eventId: '44444444-4444-4444-8444-444444444444',
    cameraId: '55555555-5555-4555-8555-555555555555',
    zoneId: '66666666-6666-4666-8666-666666666666',
    capturedAt: '2026-10-12T10:00:00.000Z',
    assessedAt: '2026-10-12T10:00:01.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    outcome: 'ALLOWED',
    reasonCode: 'AUTHORIZED',
    evaluatorVersion: 'mf06-v1.0.0',
    provenance: 'TRUSTED_SERVICE',
    ...overrides,
  };
}

function createPage(
  items: Mf06AssessmentResponse[] = [createAssessment()],
  total = 1,
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

describe('Mf06AssessmentHistory Component (B5)', () => {
  let mockListMf06Assessments: ReturnType<typeof vi.fn>;
  let mockClient: SmartSiteManagementClient;

  beforeEach(() => {
    mockListMf06Assessments = vi.fn();
    mockClient = {
      listMf06Assessments: mockListMf06Assessments,
    } as unknown as SmartSiteManagementClient;
  });

  it('renders unselected prompt when token or siteId is missing', () => {
    mount(() => (
      <Mf06AssessmentHistory
        token={null}
        siteId={null}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    expect(screen.queryByText('Select a site to view historical zone assessments.')).not.toBeNull();
    expect(mockListMf06Assessments).not.toHaveBeenCalled();
  });

  it('shows accessible loading state while query is pending', () => {
    mockListMf06Assessments.mockReturnValue(new Promise(() => {}));

    mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    const loadingElem = screen.getByRole('status');
    expect(loadingElem).not.toBeNull();
    expect(loadingElem.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('Loading assessment history...')).not.toBeNull();
  });

  it('renders settled empty state when API returns no recorded assessments', async () => {
    mockListMf06Assessments.mockResolvedValue(createPage([], 0, 0, 20));

    mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    await waitFor(() => {
      expect(screen.queryByText('No recorded assessment history.')).not.toBeNull();
    });

    expect(
      screen.queryByText(
        'Historical records reflect technical camera observations at capture time. They do not constitute active access permissions, confirmed worker identity, or safety alerts.',
      ),
    ).not.toBeNull();
  });

  it('renders populated assessment cards with technical timestamps and IDs', async () => {
    const item = createAssessment();
    mockListMf06Assessments.mockResolvedValue(createPage([item], 1, 0, 20));

    mount(() => (
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={mockClient}
      />
    ));

    await waitFor(() => {
      expect(screen.queryByText('Allowed')).not.toBeNull();
      expect(screen.queryByText('Authorized')).not.toBeNull();
      expect(screen.queryByText('Initial Observation')).not.toBeNull();
    });

    expect(screen.queryByText(new RegExp(item.cameraId))).not.toBeNull();
    expect(screen.queryByText(new RegExp(item.zoneId))).not.toBeNull();
    expect(screen.queryByText('vmf06-v1.0.0')).not.toBeNull();
    expect(screen.queryByText('Total: 1')).not.toBeNull();
  });

  describe('error handling & hard clearance', () => {
    it('handles 401 error, displays expiration message, and calls onUnauthorized callback once', async () => {
      const onUnauthorized = vi.fn();
      mockListMf06Assessments.mockRejectedValue(new ApiError('http', 'Session expired', 401));

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          onUnauthorized={onUnauthorized}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(
          screen.queryByText('Session expired or unauthorized. Please sign in again.'),
        ).not.toBeNull();
      });

      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(screen.queryByText('No recorded assessment history.')).toBeNull();
    });

    it('handles 403 Forbidden error, hides old metadata, and purges QueryCache', async () => {
      mockListMf06Assessments.mockRejectedValue(new ApiError('http', 'Forbidden site', 403));

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(
          screen.queryByText('You do not have permission to view assessments for this site.'),
        ).not.toBeNull();
      });
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      await waitFor(() => {
        const hasLiveRows = view.queries
          .getQueryCache()
          .getAll()
          .some((query) => {
            const data = query.state.data as { pages?: Mf06AssessmentPage[] } | undefined;
            return data?.pages?.some((p) => p.items.length > 0);
          });
        expect(hasLiveRows).toBe(false);
      });
    });

    it('revokes cached history from QueryCache when next-page hits hard 403 error', async () => {
      const page1Items = [
        createAssessment({
          assessmentId: '11111111-1111-4111-8111-111111111111',
          cameraId: 'cam-initial-page',
        }),
      ];
      mockListMf06Assessments.mockImplementation((_token, _siteId, pageOptions) => {
        if (pageOptions?.offset === 0) {
          return Promise.resolve(createPage(page1Items, 40, 0, 20));
        }
        return Promise.reject(new ApiError('http', 'Forbidden next page', 403));
      });

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText(/cam-initial-page/)).not.toBeNull();
      });

      const loadMoreBtn = screen.getByRole('button', { name: 'Load more (20)' });
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(screen.queryByText(/cam-initial-page/)).toBeNull();
      });

      expect(
        screen.queryByText('You do not have permission to view assessments for this site.'),
      ).not.toBeNull();

      await waitFor(() => {
        const hasLiveRows = view.queries
          .getQueryCache()
          .getAll()
          .some((query) => {
            const data = query.state.data as { pages?: Mf06AssessmentPage[] } | undefined;
            return data?.pages?.some((p) => p.items.length > 0);
          });
        expect(hasLiveRows).toBe(false);
      });
    });

    it('releases hard-error latch and enables fresh query when site scope changes', async () => {
      mockListMf06Assessments.mockImplementation((_token, siteId) => {
        if (siteId === SITE_1) {
          return Promise.reject(new ApiError('http', 'Forbidden site 1', 403));
        }
        return Promise.resolve(
          createPage(
            [
              createAssessment({
                assessmentId: '22222222-2222-4222-8222-222222222222',
                siteId: SITE_2,
                cameraId: 'cam-site-2-allowed',
              }),
            ],
            1,
          ),
        );
      });

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(
          screen.queryByText('You do not have permission to view assessments for this site.'),
        ).not.toBeNull();
      });

      // Switch scope to SITE_2 using same QueryClient
      view.rerender(
        <QueryClientProvider client={view.queries}>
          <Mf06AssessmentHistory
            token={TOKEN_1}
            siteId={SITE_2}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByText(/cam-site-2-allowed/)).not.toBeNull();
      });
      expect(
        screen.queryByText('You do not have permission to view assessments for this site.'),
      ).toBeNull();
    });

    it('handles 404 resource unavailable error', async () => {
      mockListMf06Assessments.mockRejectedValue(new ApiError('http', 'Site not found', 404));

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText('Site or assessment resource unavailable.')).not.toBeNull();
      });
      await waitFor(() => {
        const hasLiveRows = view.queries
          .getQueryCache()
          .getAll()
          .some((query) => {
            const data = query.state.data as { pages?: Mf06AssessmentPage[] } | undefined;
            return data?.pages?.some((p) => p.items.length > 0);
          });
        expect(hasLiveRows).toBe(false);
      });
    });

    it('handles 503 service unavailable error and does not show false empty message', async () => {
      mockListMf06Assessments.mockRejectedValue(new ApiError('http', 'Service unavailable', 503));

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(
          screen.queryByText('Assessment service temporarily unavailable (503).'),
        ).not.toBeNull();
      });

      expect(screen.queryByText('No recorded assessment history.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeNull();
    });
  });

  describe('scope changes & late response isolation', () => {
    it('isolates data when siteId changes under the same QueryClient and prevents cross-site leakage', async () => {
      const itemSite1 = createAssessment({
        assessmentId: '11111111-1111-4111-8111-111111111111',
        siteId: SITE_1,
        cameraId: 'cam-site-1',
      });
      const itemSite2 = createAssessment({
        assessmentId: '22222222-2222-4222-8222-222222222222',
        siteId: SITE_2,
        cameraId: 'cam-site-2',
      });

      mockListMf06Assessments.mockImplementation((_token, siteId) => {
        if (siteId === SITE_1) return Promise.resolve(createPage([itemSite1], 1));
        if (siteId === SITE_2) return Promise.resolve(createPage([itemSite2], 1));
        return Promise.reject(new Error('Unknown site'));
      });

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText(/cam-site-1/)).not.toBeNull();
      });

      // Switch site to SITE_2 using the SAME QueryClient instance
      view.rerender(
        <QueryClientProvider client={view.queries}>
          <Mf06AssessmentHistory
            token={TOKEN_1}
            siteId={SITE_2}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByText(/cam-site-2/)).not.toBeNull();
      });
      expect(screen.queryByText(/cam-site-1/)).toBeNull();
    });

    it('ignores late response from previous scope when siteId switched', async () => {
      let resolveSite1: (val: Mf06AssessmentPage) => void;
      mockListMf06Assessments.mockImplementation((_token, siteId) => {
        if (siteId === SITE_1) {
          return new Promise((resolve) => {
            resolveSite1 = resolve;
          });
        }
        if (siteId === SITE_2) {
          return Promise.resolve(
            createPage(
              [
                createAssessment({
                  assessmentId: '22222222-2222-4222-8222-222222222222',
                  siteId: SITE_2,
                  cameraId: 'cam-site-2',
                }),
              ],
              1,
            ),
          );
        }
        return Promise.reject(new Error('Unknown'));
      });

      const view = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      // Switch to site 2 before site 1 resolves, using same queries client
      view.rerender(
        <QueryClientProvider client={view.queries}>
          <Mf06AssessmentHistory
            token={TOKEN_1}
            siteId={SITE_2}
            credentialId={CREDENTIAL_1}
            client={mockClient}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.queryByText(/cam-site-2/)).not.toBeNull();
      });

      // Late resolution of site 1
      act(() => {
        resolveSite1(
          createPage(
            [
              createAssessment({
                assessmentId: '11111111-1111-4111-8111-111111111111',
                siteId: SITE_1,
                cameraId: 'cam-site-1',
              }),
            ],
            1,
          ),
        );
      });

      // Must still show only site 2
      expect(screen.queryByText(/cam-site-1/)).toBeNull();
      expect(screen.queryByText(/cam-site-2/)).not.toBeNull();
    });
  });

  describe('pagination & transient next-page failure', () => {
    it('preserves first page records on next-page failure and allows retry', async () => {
      const page1Items = Array.from({ length: 20 }, (_, i) =>
        createAssessment({
          assessmentId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
          cameraId: `cam-p1-${i}`,
        }),
      );
      const page2Items = Array.from({ length: 20 }, (_, i) =>
        createAssessment({
          assessmentId: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
          cameraId: `cam-p2-${i}`,
        }),
      );

      let callCount = 0;
      mockListMf06Assessments.mockImplementation((_token, _siteId, pageOptions) => {
        callCount++;
        if (pageOptions?.offset === 0) {
          return Promise.resolve(createPage(page1Items, 40, 0, 20));
        }
        if (pageOptions?.offset === 20 && callCount === 2) {
          // Transient failure on second page fetch
          return Promise.reject(new ApiError('network', 'Network glitch', 500));
        }
        if (pageOptions?.offset === 20 && callCount === 3) {
          // Success on retry
          return Promise.resolve(createPage(page2Items, 40, 20, 20));
        }
        return Promise.reject(new Error('Unexpected call'));
      });

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      // Verify page 1 loaded
      await waitFor(() => {
        expect(screen.queryByText(/cam-p1-0/)).not.toBeNull();
      });

      const loadMoreBtn = screen.getByRole('button', { name: 'Load more (20)' });
      expect(loadMoreBtn).not.toBeNull();

      // Trigger next page failure
      fireEvent.click(loadMoreBtn);

      await waitFor(() => {
        expect(screen.queryByText('Failed to load additional assessments.')).not.toBeNull();
      });

      // Crucial: Authorized page 1 rows must remain preserved!
      expect(screen.queryByText(/cam-p1-0/)).not.toBeNull();
      expect(screen.queryByText(/cam-p1-19/)).not.toBeNull();

      // Click retry
      const retryBtn = screen.getByRole('button', { name: 'Retry loading next page' });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.queryByText(/cam-p2-0/)).not.toBeNull();
      });
      expect(screen.queryByText(/cam-p1-0/)).not.toBeNull();
    });

    it('deduplicates items appearing across pages', async () => {
      const duplicateItem = createAssessment({
        assessmentId: '11111111-1111-4111-8111-111111111111',
        cameraId: 'cam-unique-1',
      });
      const page1 = createPage([duplicateItem], 2, 0, 20);
      const page2 = createPage([duplicateItem], 2, 1, 20);

      mockListMf06Assessments.mockImplementation((_token, _siteId, pageOptions) => {
        if (pageOptions?.offset === 0) return Promise.resolve(page1);
        return Promise.resolve(page2);
      });

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText(/cam-unique-1/)).not.toBeNull();
      });

      // Item should be rendered only once
      const matches = screen.getAllByText(/cam-unique-1/);
      expect(matches).toHaveLength(1);
    });
  });

  describe('safe label matrix coverage', () => {
    it('displays correct outcome labels for ALLOWED, DENIED, UNAVAILABLE', async () => {
      const items = [
        createAssessment({
          assessmentId: '11111111-1111-4111-8111-111111111111',
          outcome: 'ALLOWED',
          reasonCode: 'AUTHORIZED',
        }),
        createAssessment({
          assessmentId: '22222222-2222-4222-8222-222222222222',
          outcome: 'DENIED',
          reasonCode: 'UNAUTHORIZED',
        }),
        createAssessment({
          assessmentId: '33333333-3333-4333-8333-333333333333',
          outcome: 'UNAVAILABLE',
          reasonCode: 'SERVICE_DISABLED',
          provenance: 'UNAVAILABLE',
        }),
      ];

      mockListMf06Assessments.mockResolvedValue(createPage(items, 3));

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText('Allowed')).not.toBeNull();
        expect(screen.queryByText('Denied')).not.toBeNull();
        expect(screen.queryByText('Unavailable')).not.toBeNull();
      });
    });

    it('displays human-readable labels for reason codes and retrospective review', async () => {
      const items = [
        createAssessment({
          assessmentId: '11111111-1111-4111-8111-111111111111',
          outcome: 'DENIED',
          reasonCode: 'POLICY_PROHIBITED',
          purpose: 'RETROSPECTIVE_REVIEW',
        }),
        createAssessment({
          assessmentId: '22222222-2222-4222-8222-222222222222',
          outcome: 'UNAVAILABLE',
          reasonCode: 'IDENTITY_UNAVAILABLE',
          provenance: 'UNAVAILABLE',
        }),
        createAssessment({
          assessmentId: '33333333-3333-4333-8333-333333333333',
          outcome: 'UNAVAILABLE',
          reasonCode: 'MEDIA_UNAVAILABLE',
          provenance: 'UNAVAILABLE',
        }),
      ];

      mockListMf06Assessments.mockResolvedValue(createPage(items, 3));

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      await waitFor(() => {
        expect(screen.queryByText('Prohibited by Policy')).not.toBeNull();
        expect(screen.queryByText('Retrospective Review')).not.toBeNull();
        expect(screen.queryByText('Identity Unavailable')).not.toBeNull();
        expect(screen.queryByText('Media Unavailable')).not.toBeNull();
      });
    });

    it('revokes parent history metadata after detail forbidden response', async () => {
      const assessment = createAssessment();
      mockListMf06Assessments.mockResolvedValue(createPage([assessment]));
      Object.assign(mockClient, {
        getMf06Assessment: vi.fn().mockRejectedValue(new ApiError('http', 'Access denied', 403)),
      });
      const unauthorized = vi.fn();
      const { queries, container } = mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
          onUnauthorized={unauthorized}
        />
      ));
      fireEvent.click(await screen.findByRole('button', { name: 'View assessment' }));
      await waitFor(() =>
        expect(
          queries
            .getQueriesData({ queryKey: ['mf06-assessments'] })
            .some(([key, data]) => key.length === 6 && data !== undefined),
        ).toBe(false),
      );
      expect(container.textContent).not.toContain(assessment.assessmentId);
      expect(mockListMf06Assessments).toHaveBeenCalledTimes(1);
      expect(unauthorized).not.toHaveBeenCalled();
    });

    it('opens the recorded assessment detail dialog when clicking View assessment', async () => {
      const assessment = createAssessment({
        assessmentId: '11111111-1111-4111-8111-111111111111',
        outcome: 'UNAVAILABLE',
        reasonCode: 'IDENTITY_UNAVAILABLE',
        provenance: 'UNAVAILABLE',
      });
      const get = vi.fn().mockResolvedValue(assessment);
      mockListMf06Assessments.mockResolvedValue(createPage([assessment]));
      Object.assign(mockClient, { getMf06Assessment: get });

      mount(() => (
        <Mf06AssessmentHistory
          token={TOKEN_1}
          siteId={SITE_1}
          credentialId={CREDENTIAL_1}
          client={mockClient}
        />
      ));

      const viewBtn = await screen.findByRole('button', { name: 'View assessment' });
      fireEvent.click(viewBtn);

      const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
      expect(dialog).toBeTruthy();
      expect(
        await screen.findByText('Historical Technical Assessment · Not Access Permission'),
      ).toBeTruthy();
      expect(get).toHaveBeenCalledWith(
        TOKEN_1,
        SITE_1,
        assessment.assessmentId,
        expect.objectContaining({ signal: expect.anything() }),
      );
    });
  });
});
