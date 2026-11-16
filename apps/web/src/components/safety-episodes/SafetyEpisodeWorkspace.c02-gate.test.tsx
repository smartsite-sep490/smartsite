// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse, type SafetyEpisode } from '@smartsite/api-client';
import { SafetyEpisodeWorkspace } from './SafetyEpisodeWorkspace';
import i18n from '../../i18n';

const client = vi.hoisted(() => ({
  listSites: vi.fn(),
  listSafetyEpisodeInbox: vi.fn(),
  listSafetyFrameInbox: vi.fn(),
  listSafetyEpisodes: vi.fn(),
  getSafetyEpisode: vi.fn(),
  getTrackedEpisode: vi.fn(),
  listTrackedEpisodeObservations: vi.fn(),
  readSafetyEpisodeInbox: vi.fn(),
  getSafetyAlert: vi.fn(),
  listSafetyIdentificationRequests: vi.fn(),
  getSafetyIdentificationAssignee: vi.fn(),
  previewSafetyIdentificationEvidence: vi.fn(),
}));

vi.mock('../../features/auth/auth-session', () => ({ useManagementClient: () => client }));
vi.mock('../alerts/SafetyAlertEvidencePanel', () => ({
  SafetyAlertEvidencePanel: () => <div>Authorized evidence</div>,
}));

const SITE_A = '11111111-1111-4111-8111-111111111111';
const RECIPIENT_ID = '55555555-5555-4555-8555-555555555555';
const EPISODE_ID = '22222222-2222-4222-8222-222222222222';
const CAMERA_ID = '33333333-3333-4333-8333-333333333333';
const MANAGER_ID = '99999999-9999-4999-8999-999999999999';

function makeSession(
  role: 'SAFETY_OFFICER' | 'SITE_MANAGER',
): Pick<LoginResponse, 'accessToken' | 'user'> {
  return {
    accessToken: 'synthetic-pr223-token',
    user: {
      id: role === 'SAFETY_OFFICER' ? '00000000-0000-4000-8000-000000000011' : MANAGER_ID,
      username: role.toLowerCase(),
      displayName: role,
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role, siteId: SITE_A }],
    },
  };
}

const localEpisode: SafetyEpisode = {
  id: EPISODE_ID,
  siteId: SITE_A,
  cameraId: CAMERA_ID,
  subject: {
    kind: 'EVENT_LOCAL',
    eventId: '44444444-4444-4444-8444-444444444444',
    personObservationIndex: 0,
  },
  configurationBundleId: null,
  firstObservedAt: '2026-11-16T08:00:00Z',
  lastObservedAt: '2026-11-16T08:00:00Z',
  contentRevision: 1,
  collectionState: 'SEALED',
  findingCount: 1,
  identityDecision: null,
  findings: [
    {
      alertId: 'alert-hat',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      status: 'PENDING_REVIEW',
      alertRevision: 0,
      zoneId: null,
      evidenceRefs: [],
    },
  ],
  workflowLinks: [],
};

let queryClient: QueryClient;

function mount(
  session: Pick<LoginResponse, 'accessToken' | 'user'>,
  initialEntry: string,
  onSignOut?: () => void,
) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SafetyEpisodeWorkspace apiUrl="http://api.test" session={session} onSignOut={onSignOut}>
          <div data-testid="legacy-incidents-view">Legacy workflow</div>
        </SafetyEpisodeWorkspace>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage('en');
  client.listSites.mockResolvedValue({
    items: [{ id: SITE_A, code: 'ALPHA', name: 'Site Alpha' }],
    total: 1,
  });
  client.listSafetyEpisodes.mockResolvedValue({ items: [localEpisode], total: 1 });
  client.getSafetyIdentificationAssignee.mockResolvedValue({
    assignee: { id: MANAGER_ID, displayName: 'Tran Minh Quan' },
  });
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.unstubAllEnvs();
});

describe('C02 PR #223 scoped read availability (SAFETY_IDENTIFICATION_ENABLED=false 404 vs empty 200 vs 403/401/500)', () => {
  it('distinguishes Backend 404 disabled state from an empty 200 queue, withholds create/assignee calls while disabled, and exposes the flow without UI code edits once enabled', async () => {
    let backendEnabled = false;
    client.listSafetyIdentificationRequests.mockImplementation(async () => {
      if (!backendEnabled) {
        throw new ApiError('http', 'Configuration resource not found', 404);
      }
      return { items: [], total: 0 };
    });

    mount(
      makeSession('SAFETY_OFFICER'),
      `/incidents?${new URLSearchParams({
        tab: 'identification',
        siteId: SITE_A,
        episodeId: EPISODE_ID,
        originRecipientId: RECIPIENT_ID,
      })}`,
    );

    // 1. While SAFETY_IDENTIFICATION_ENABLED=false (HTTP 404):
    //    - Shows dedicated unavailable/not-yet-enabled status (EN & VI)
    //    - Does NOT show empty 200 queue ("No matching requests" / "0 requests") or generic record-not-found
    //    - Withholds New request from episode, create form, and /assignee call
    const unavailableBox = await screen.findByTestId('identification-unavailable-state');
    expect(unavailableBox.textContent).toContain('Identification workflow not yet enabled');
    expect(screen.getByText('Not enabled')).toBeTruthy();
    expect(screen.queryByText('No matching requests')).toBeNull();
    expect(screen.queryByText('0 requests')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /New request from episode|Close create form/i }),
    ).toBeNull();
    expect(client.getSafetyIdentificationAssignee).not.toHaveBeenCalled();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('identification-unavailable-state').textContent).toContain(
      'Luồng xác minh danh tính chưa được kích hoạt',
    );
    expect(screen.getByText('Chưa kích hoạt')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // 2. Backend enables SAFETY_IDENTIFICATION_ENABLED=true -> Retry exposes empty 200 queue + prefilled create form without UI edits!
    backendEnabled = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('No matching requests')).toBeTruthy();
    expect(screen.getByText('0 requests')).toBeTruthy();
    expect(screen.queryByTestId('identification-unavailable-state')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Close create form' })).toBeTruthy();
    await waitFor(() => expect(client.getSafetyIdentificationAssignee).toHaveBeenCalledTimes(1));
  });

  it('uses scoped read availability on EVENT_LOCAL and TRACKED episode detail: hides Request identification on 404 disabled and exposes it on 200 enabled without env flags', async () => {
    let backendEnabled = false;
    client.listSafetyIdentificationRequests.mockImplementation(async () => {
      if (!backendEnabled) {
        throw new ApiError('http', 'Configuration resource not found', 404);
      }
      return { items: [], total: 0 };
    });
    client.listSafetyEpisodeInbox.mockResolvedValue({
      total: 2,
      unreadCount: 2,
      items: [
        {
          id: RECIPIENT_ID,
          episode: localEpisode,
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: localEpisode.firstObservedAt,
          updatedAt: localEpisode.lastObservedAt,
        },
        {
          id: '66666666-6666-4666-8666-666666666666',
          episode: {
            ...localEpisode,
            id: '77777777-7777-4777-8777-777777777777',
            subject: {
              kind: 'TRACKED',
              segmentId: '88888888-8888-4888-8888-888888888888',
              scopeSha256: 'a'.repeat(64),
            },
          },
          seenRevision: 0,
          unread: true,
          firstDeliveredAt: localEpisode.firstObservedAt,
          updatedAt: localEpisode.lastObservedAt,
        },
      ],
    });
    client.getSafetyEpisode.mockResolvedValue(localEpisode);
    client.getTrackedEpisode.mockResolvedValue({
      episodeId: '77777777-7777-4777-8777-777777777777',
      siteId: SITE_A,
      cameraId: CAMERA_ID,
      subject: {
        kind: 'TRACKED',
        segmentId: '88888888-8888-4888-8888-888888888888',
        scopeSha256: 'a'.repeat(64),
      },
      firstObservedAt: localEpisode.firstObservedAt,
      lastObservedAt: localEpisode.lastObservedAt,
      contentRevision: 1,
      collectionState: 'SEALED',
      findings: [],
    });
    client.listTrackedEpisodeObservations.mockResolvedValue({
      episodeId: '77777777-7777-4777-8777-777777777777',
      contentRevision: 1,
      throughSequence: '1',
      offset: 0,
      limit: 20,
      total: 0,
      hasMore: false,
      items: [],
    });

    mount(makeSession('SAFETY_OFFICER'), `/incidents?tab=episodes&siteId=${SITE_A}`);

    fireEvent.click(await screen.findByRole('button', { name: /Subject 1/i }));
    await screen.findByRole('link', { name: /Review finding/i });
    expect(await screen.findByTestId('episode-identification-unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Request identification' })).toBeNull();

    // Preserves Main PR #218 Tracked person label on TRACKED row as well
    fireEvent.click(screen.getByRole('button', { name: /Tracked person/i }));
    await screen.findByTestId('tracked-episode-workspace');
    expect(await screen.findByTestId('episode-identification-unavailable')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Request identification' })).toBeNull();

    cleanup();
    queryClient.clear();

    // Flip Backend profile to enabled (200 OK) -> Request identification link appears with zero UI code edits
    backendEnabled = true;
    mount(makeSession('SAFETY_OFFICER'), `/incidents?tab=episodes&siteId=${SITE_A}`);
    fireEvent.click(await screen.findByRole('button', { name: /Subject 1/i }));
    const reqLink = await screen.findByRole('link', { name: 'Request identification' });
    expect(reqLink.getAttribute('href')).toContain('tab=identification');
  });

  it('preserves distinct denied (403), expired (401), and server/network error (500) states in C02 queue', async () => {
    // 1. 403 Forbidden -> denied alert, never unavailable-not-enabled or empty 200
    client.listSafetyIdentificationRequests.mockRejectedValueOnce(
      new ApiError('http', 'Forbidden', 403),
    );
    mount(makeSession('SITE_MANAGER'), `/incidents?tab=identification&siteId=${SITE_A}`);
    expect(await screen.findByTestId('identification-queue-denied')).toBeTruthy();
    expect(screen.queryByTestId('identification-unavailable-state')).toBeNull();
    expect(screen.queryByText('No matching requests')).toBeNull();
    cleanup();
    queryClient.clear();

    // 2. 401 Unauthorized -> triggers onSignOut and renders expired/unauthorized alert
    const onSignOut = vi.fn();
    client.listSafetyIdentificationRequests.mockRejectedValueOnce(
      new ApiError('http', 'Unauthorized', 401),
    );
    mount(
      makeSession('SAFETY_OFFICER'),
      `/incidents?tab=identification&siteId=${SITE_A}`,
      onSignOut,
    );
    expect(await screen.findByTestId('identification-queue-expired')).toBeTruthy();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('identification-unavailable-state')).toBeNull();
    cleanup();
    queryClient.clear();

    // 3. 500 Server Error -> renders transient error alert with Retry, distinct from 404 and 200
    client.listSafetyIdentificationRequests.mockRejectedValueOnce(
      new ApiError('http', 'Temporary server failure', 500),
    );
    mount(makeSession('SAFETY_OFFICER'), `/incidents?tab=identification&siteId=${SITE_A}`);
    expect(await screen.findByTestId('identification-queue-error')).toBeTruthy();
    expect(screen.queryByTestId('identification-unavailable-state')).toBeNull();
    expect(screen.queryByText('No matching requests')).toBeNull();
  });
});
