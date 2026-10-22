// @vitest-environment jsdom
import React, { useState } from 'react';
import { render, screen, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import {
  SmartSiteManagementClient,
  ApiError,
  type Mf06AssessmentResponse,
  type Mf06AssessmentPage,
  type SiteResponse,
} from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import type { DecodedPreview } from '../cameras/useRealtimePreview';

process.env.VITE_AI_WORK_PAUSED = 'true';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'DISCONNECTED' as 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'REPLAY' | 'UNAVAILABLE',
  error: null as string | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: state.preview,
    status: state.status,
    sourceKind: state.status === 'REPLAY' ? 'REPLAY' : state.status === 'LIVE' ? 'LIVE' : null,
    error: state.error,
    capturedAt: state.preview?.frame.capturedAt ?? null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const SITE_2 = '33333333-3333-4333-8333-333333333332';

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
  total = items.length,
  offset = 0,
  limit = 20,
): Mf06AssessmentPage {
  return { items, total, offset, limit };
}

const mockSites: [SiteResponse, SiteResponse] = [
  {
    id: SITE_1,
    code: 'SITE-A',
    name: 'Site Alpha',
    createdAt: '2026-09-30T00:00:00Z',
  },
  {
    id: SITE_2,
    code: 'SITE-B',
    name: 'Site Beta',
    createdAt: '2026-09-30T00:00:00Z',
  },
];

const mockCamerasSite1 = [
  {
    id: 'cam-1',
    siteId: SITE_1,
    externalId: 'CAM-01',
    code: 'CAM-01',
    name: 'Camera 01',
    status: 'ACTIVE' as const,
    configurationVersion: 1,
    createdAt: '2026-09-30T00:00:00Z',
  },
  {
    id: 'cam-2',
    siteId: SITE_1,
    externalId: 'CAM-02',
    code: 'CAM-02',
    name: 'Camera 02',
    status: 'ACTIVE' as const,
    configurationVersion: 1,
    createdAt: '2026-09-30T00:00:00Z',
  },
];

const mockSharedSession: SharedSession = {
  accessToken: 'token-admin-zone',
  sessionScope: 'scope-admin-zone',
  user: {
    id: 'admin-1',
    displayName: 'Admin User',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

describe('RestrictedZoneView MF06 Assessment History Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = null;
    state.status = 'UNAVAILABLE';
    state.error = null;
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
    state.status = 'DISCONNECTED';
    state.error = null;
  });

  it('credential rotation preserves unrelated history cache and can load the new session', async () => {
    const unrelatedKey = [
      'mf06-assessments',
      'http://localhost:3000',
      'other-client',
      SITE_1,
      'other-session:999',
      999,
    ];
    queryClient.setQueryDefaults(unrelatedKey, { gcTime: Infinity });
    queryClient.setQueryData(unrelatedKey, { privateOtherScope: 'preserve-me' });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [],
      total: 0,
    });
    const list = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockImplementation(async (token) =>
        createPage([
          createAssessment({
            evaluatorVersion: token === 'new-token' ? 'new-access' : 'old-access',
          }),
        ]),
      );
    const element = (accessToken: string) => (
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView
          apiUrl="http://localhost:3000"
          sharedSession={{ ...mockSharedSession, accessToken }}
        />
      </QueryClientProvider>
    );
    const view = render(element(mockSharedSession.accessToken));
    await screen.findByText('vold-access');
    expect(queryClient.getQueryData(unrelatedKey)).toEqual({ privateOtherScope: 'preserve-me' });
    view.rerender(element('new-token'));
    await screen.findByText('vnew-access');
    expect(queryClient.getQueryData(unrelatedKey)).toEqual({ privateOtherScope: 'preserve-me' });
    expect(list).toHaveBeenCalledWith(
      'new-token',
      SITE_1,
      { offset: 0, limit: 20 },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('loads and displays site-scoped assessment history even when site has zero cameras', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    const listPreviewCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue({
        items: [],
        total: 0,
      });
    const listAssessmentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockResolvedValue(
        createPage([createAssessment({ assessmentId: '11111111-1111-4111-8111-111111111111' })]),
      );

    state.preview = null;
    state.status = 'UNAVAILABLE';

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Allowed')).not.toBeNull();
    expect(screen.getByText('Authorized')).not.toBeNull();
    expect(screen.getByText('MF06 Restricted Zone Assessment History')).not.toBeNull();

    expect(listAssessmentsSpy).toHaveBeenCalledWith(
      mockSharedSession.accessToken,
      SITE_1,
      expect.objectContaining({ offset: 0, limit: 20 }),
      expect.any(Object),
    );
    expect(listPreviewCamerasSpy).toHaveBeenCalled();
  });

  it('current camera catalog flows through history and detail, then clears on camera scope denial', async () => {
    const record = createAssessment();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    const cameras = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue({
        items: [{ ...mockCamerasSite1[0]!, id: record.cameraId, name: 'Current North Gate' }],
        total: 1,
      });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments').mockResolvedValue(
      createPage([record]),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getMf06Assessment').mockResolvedValue(record);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getMf06AssessmentFrame').mockRejectedValue(
      new ApiError('http', 'No synthetic frame', 404),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );
    const label = await screen.findByText('Camera (current catalog)');
    const card = label.closest('li');
    expect(card).not.toBeNull();
    expect(within(card!).getByText('CAM-01 · Current North Gate')).toBeTruthy();
    await userEvent.click(within(card!).getByRole('button', { name: 'View assessment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Recorded assessment' });
    expect(await within(dialog).findByText('CAM-01 · Current North Gate')).toBeTruthy();
    cameras.mockRejectedValue(new ApiError('http', 'Camera scope revoked', 403));
    await act(async () => {
      await queryClient.refetchQueries({
        predicate: (query) =>
          query.queryKey[0] === 'zone-admin' && query.queryKey.includes('cameras'),
      });
    });
    await waitFor(() => expect(screen.queryByText('CAM-01 · Current North Gate')).toBeNull());
    expect(screen.queryByText('Camera (current catalog)')).toBeNull();
  });

  it('distinguishes between 503 service unavailable and empty assessment history', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: mockCamerasSite1,
      total: mockCamerasSite1.length,
    });

    const listAssessmentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503));

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText('Assessment service temporarily unavailable (503).'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: /Retry/i })).not.toBeNull();
    expect(screen.queryByText('No recorded assessment history.')).toBeNull();

    unmount();
    cleanup();
    queryClient.clear();

    listAssessmentsSpy.mockResolvedValueOnce(createPage([], 0));

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('No recorded assessment history.')).not.toBeNull();
    expect(screen.getByText('No zone assessments recorded for this site yet.')).not.toBeNull();
    expect(screen.queryByText('Assessment service temporarily unavailable (503).')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/i })).toBeNull();
  });

  it('does not leak or resurrect late responses from prior site when switching sites', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: mockSites,
      total: mockSites.length,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: mockCamerasSite1,
      total: mockCamerasSite1.length,
    });

    let resolveSite1: (val: Mf06AssessmentPage) => void = () => {};
    const site1Promise = new Promise<Mf06AssessmentPage>((res) => {
      resolveSite1 = res;
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments').mockImplementation(
      async (_token, siteId) => {
        if (siteId === SITE_1) {
          return site1Promise;
        }
        if (siteId === SITE_2) {
          return createPage([
            createAssessment({
              assessmentId: '22222222-2222-4222-8222-222222222222',
              siteId: SITE_2,
              reasonCode: 'POLICY_PROHIBITED',
              outcome: 'DENIED',
            }),
          ]);
        }
        return createPage([], 0);
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Site Beta/i });
    const siteSelect = screen.getByLabelText(/Site/i);

    await user.selectOptions(siteSelect, SITE_2);

    expect(await screen.findByText('Denied')).not.toBeNull();
    expect(screen.getByText('Prohibited by Policy')).not.toBeNull();

    await act(async () => {
      resolveSite1(
        createPage([
          createAssessment({
            assessmentId: '11111111-1111-4111-8111-111111111111',
            siteId: SITE_1,
            outcome: 'ALLOWED',
            reasonCode: 'AUTHORIZED',
          }),
        ]),
      );
    });

    expect(screen.queryByText('Allowed')).toBeNull();
    expect(screen.queryByText('Authorized')).toBeNull();
    expect(screen.getByText('Denied')).not.toBeNull();
  });

  it('triggers session expiry on 401 error from assessment history once without repeat', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: mockCamerasSite1,
      total: mockCamerasSite1.length,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments').mockRejectedValue(
      new ApiError('http', 'Unauthorized', 401),
    );

    const onSignOutSpy = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView
          sharedSession={{
            ...mockSharedSession,
            onSignOut: onSignOutSpy,
          }}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(onSignOutSpy).toHaveBeenCalledTimes(1);
    });

    await new Promise((r) => setTimeout(r, 60));
    expect(onSignOutSpy).toHaveBeenCalledTimes(1);
  });

  it('hides assessment history immediately upon sign out or session revocation', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: mockCamerasSite1,
      total: mockCamerasSite1.length,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments').mockResolvedValue(
      createPage([createAssessment()]),
    );

    function Harness() {
      const [session, setSession] = useState<SharedSession | null>(mockSharedSession);
      return (
        <>
          <button type="button" onClick={() => setSession(null)}>
            Sign out of shell
          </button>
          <RestrictedZoneView sharedSession={session} />
        </>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Allowed')).not.toBeNull();
    expect(screen.getByText('MF06 Restricted Zone Assessment History')).not.toBeNull();

    const signOutBtn = screen.getByRole('button', { name: /Sign out/i });
    await user.click(signOutBtn);

    await waitFor(() => {
      expect(screen.queryByText('MF06 Restricted Zone Assessment History')).toBeNull();
    });
    expect(screen.queryByText('Allowed')).toBeNull();

    cleanup();
    queryClient.clear();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView
          sharedSession={{
            accessToken: 'token-unauthorized',
            sessionScope: 'scope-unauthorized',
            user: {
              id: 'worker-1',
              displayName: 'Worker User',
              roleAssignments: [{ role: 'WORKER', siteId: SITE_1 }],
            },
          }}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Zone Configuration is restricted')).not.toBeNull();
    expect(
      screen.queryByRole('region', { name: /Restricted Zone Assessment History/i }),
    ).toBeNull();
    expect(screen.queryByText('MF06 Restricted Zone Assessment History')).toBeNull();
  });

  it('does not refetch assessment history when switching cameras on the same site', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSites[0]],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: mockCamerasSite1,
      total: mockCamerasSite1.length,
    });
    const listAssessmentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments')
      .mockResolvedValue(createPage([createAssessment()]));

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Allowed')).not.toBeNull();
    expect(listAssessmentsSpy).toHaveBeenCalledTimes(1);

    await screen.findByRole('option', { name: /Camera 02/i });
    const cameraSelect = screen.getByLabelText(/Camera/i);

    await user.selectOptions(cameraSelect, 'cam-2');
    expect((cameraSelect as HTMLSelectElement).value).toBe('cam-2');

    await new Promise((r) => setTimeout(r, 60));
    expect(listAssessmentsSpy).toHaveBeenCalledTimes(1);
  });

  it('hides history and issues no assessment requests when site metadata has base error', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new ApiError('http', 'Internal Server Error', 500),
    );
    const listAssessmentsSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listMf06Assessments');

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: /Restricted Zone Assessment History/i }),
      ).toBeNull();
    });
    expect(screen.queryByText('MF06 Restricted Zone Assessment History')).toBeNull();
    expect(listAssessmentsSpy).not.toHaveBeenCalled();
  });
});
