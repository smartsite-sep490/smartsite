// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type LoginResponse,
  type Page,
  type SafetyAlertDetailResponse,
  type SafetyAlertResponse,
  type SiteResponse,
} from '@smartsite/api-client';
import i18n from '../../i18n';
import {
  ALERTS_TOUR_VERSION,
  SAFETY_TOUR_STORAGE_KEY,
  readSafetyTourProgress,
} from '../safety/safetyTaskTourModel';
import { SafetyAlertsView } from './SafetyAlertsView';

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock-url-${blob.size}`);
  URL.revokeObjectURL = vi.fn();
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const SITE_ALPHA: SiteResponse = {
  id: 'site-alpha',
  code: 'ALPHA',
  name: 'Site Alpha',
  createdAt: '2026-10-01T00:00:00Z',
};

const SITE_BETA: SiteResponse = {
  id: 'site-beta',
  code: 'BETA',
  name: 'Site Beta',
  createdAt: '2026-10-01T00:00:00Z',
};

const officerSession: LoginResponse = {
  accessToken: 'token-officer-1',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-11-18T00:00:00Z',
  refreshTokenExpiresAt: '2026-11-19T00:00:00Z',
  user: {
    id: 'user-so-1',
    username: 'officer.alpha',
    displayName: 'Officer Alpha',
    roleAssignments: [
      { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
      { role: 'SAFETY_OFFICER', siteId: 'site-beta' },
    ],
    isActive: true,
    mustChangePassword: false,
  },
};

const secondOfficerSession: LoginResponse = {
  ...officerSession,
  accessToken: 'token-officer-2',
  user: {
    ...officerSession.user,
    id: 'user-so-2',
    username: 'officer.two',
    displayName: 'Officer Two',
  },
};

const adminSession: LoginResponse = {
  accessToken: 'token-admin-1',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-11-18T00:00:00Z',
  refreshTokenExpiresAt: '2026-11-19T00:00:00Z',
  user: {
    id: 'user-admin-1',
    username: 'global.admin',
    displayName: 'Global Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
    isActive: true,
    mustChangePassword: false,
  },
};

const baseAlert: SafetyAlertResponse = {
  id: 'alert-pending-1',
  siteId: 'site-alpha',
  zoneId: 'zone-1',
  candidateWorkerId: null,
  alertType: 'PPE_VIOLATION',
  candidateSubtype: 'NO_HARD_HAT',
  status: 'PENDING_REVIEW',
  firstDetectedAt: '2026-11-16T09:00:00Z',
  lastDetectedAt: '2026-11-16T09:05:00Z',
  detectionCount: 1,
  revision: 1,
  createdAt: '2026-11-16T09:00:00Z',
  updatedAt: '2026-11-16T09:05:00Z',
};

const pendingAlertDetail: SafetyAlertDetailResponse = {
  ...baseAlert,
  detectionsTotal: 1,
  detections: [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-11-16T09:05:00Z',
      processingStatus: 'PROCESSED',
      evidence: [],
    },
  ],
  reviewsTotal: 0,
  reviews: [],
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

describe('SafetyAlertsView contextual guided tour (FE-F06)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    await i18n.changeLanguage('en');

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [SITE_ALPHA, SITE_BETA],
      total: 2,
    } satisfies Page<SiteResponse>);

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [baseAlert],
      total: 1,
    } satisfies Page<SafetyAlertResponse>);

    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      pendingAlertDetail,
    );

    vi.spyOn(SmartSiteManagementClient.prototype, 'getAlertWorkContext').mockResolvedValue({
      capturedAt: '2026-11-16T09:05:00Z',
      identity: 'UNKNOWN',
      zoneName: 'North Gate Zone',
      cameraName: 'Gate Camera 01',
      workers: [],
      relatedTeams: [],
      warning: 'Historical event context only.',
    });

    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getObservationIdentityContext',
    ).mockRejectedValue(new ApiError('http', 'Not found', 404));
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('walks an authorized Safety Officer through all 4 real anchors, supports Back/Escape/Done/Replay, preserves reviewReason draft, and never mutates reviews or incidents', async () => {
    const reviewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert');
    const createIncidentSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createIncident');
    const user = userEvent.setup();

    renderWithClient(
      <SafetyAlertsView
        apiUrl="http://localhost:3000"
        authenticatedSession={officerSession}
        initialSiteId="site-alpha"
        initialAlertId="alert-pending-1"
      />,
    );

    const inviteStart = await screen.findByTestId('safety-task-tour-invitation-start');
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Guided help');

    const reasonInput = await screen.findByLabelText(/decision reason/i);
    await user.type(reasonInput, 'Clear missing hard hat in CAM-01 frame');
    expect((reasonInput as HTMLTextAreaElement).value).toBe(
      'Clear missing hard hat in CAM-01 frame',
    );

    await user.click(inviteStart);

    const tour = await screen.findByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('alerts-queue-filter');
    expect(tour.textContent).toContain('Step 1 of 4');
    expect(
      document
        .querySelector('[data-tour-anchor="alerts-queue-filter"]')
        ?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 4');

    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-action-bar',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 3 of 4');

    await user.click(screen.getByTestId('safety-task-tour-back'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );

    // Escape closes without persisting COMPLETED/SKIPPED and preserves draft
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    });
    expect(readSafetyTourProgress('user-so-1', 'alerts', ALERTS_TOUR_VERSION)).toBeNull();
    expect((reasonInput as HTMLTextAreaElement).value).toBe(
      'Clear missing hard hat in CAM-01 frame',
    );

    // Reopen via trigger and complete all 4 steps
    await user.click(screen.getByTestId('safety-task-tour-trigger'));
    expect((await screen.findByTestId('safety-task-tour')).getAttribute('data-tour-step')).toBe(
      'alerts-queue-filter',
    );
    await user.click(screen.getByTestId('safety-task-tour-next'));
    await user.click(screen.getByTestId('safety-task-tour-next'));
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-followup',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 4 of 4');

    await user.click(screen.getByTestId('safety-task-tour-done'));
    await waitFor(() => {
      expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    });

    expect(readSafetyTourProgress('user-so-1', 'alerts', ALERTS_TOUR_VERSION)).toBe('COMPLETED');
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');
    expect(screen.getByTestId('safety-task-tour-reset')).toBeTruthy();
    expect((reasonInput as HTMLTextAreaElement).value).toBe(
      'Clear missing hard hat in CAM-01 frame',
    );
    expect(reviewSpy).not.toHaveBeenCalled();
    expect(createIncidentSpy).not.toHaveBeenCalled();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Xem lại hướng dẫn');
  });

  it('skips unavailable steps by role and alert status so no step ever points to an absent control', async () => {
    const user = userEvent.setup();

    // 1) Read-only Global Admin on PENDING_REVIEW alert: skips alerts-action-bar (3 steps)
    const adminView = renderWithClient(
      <SafetyAlertsView
        apiUrl="http://localhost:3000"
        authenticatedSession={adminSession}
        initialSiteId="site-alpha"
        initialAlertId="alert-pending-1"
      />,
    );

    await user.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 3');
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-followup',
    );
    expect(document.querySelector('[data-tour-anchor="alerts-action-bar"]')).toBeNull();
    adminView.unmount();
    window.localStorage.clear();

    // 2) Safety Officer on CONFIRMED alert without incidentId and 0 detections:
    //    skips alerts-action-bar, binds alerts-followup to real Create incident button without clicking it
    const confirmedNoDetections: SafetyAlertDetailResponse = {
      ...pendingAlertDetail,
      id: 'alert-confirmed-1',
      status: 'CONFIRMED',
      incidentId: null,
      detectionsTotal: 0,
      detections: [],
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [{ ...baseAlert, id: 'alert-confirmed-1', status: 'CONFIRMED' }],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      confirmedNoDetections,
    );

    const confirmedView = renderWithClient(
      <SafetyAlertsView
        apiUrl="http://localhost:3000"
        authenticatedSession={officerSession}
        initialSiteId="site-alpha"
        initialAlertId="alert-confirmed-1"
      />,
    );

    await user.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 3');
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-followup',
    );
    const createIncidentBtn = screen.getByRole('button', { name: /create incident from alert/i });
    expect(createIncidentBtn.getAttribute('data-tour-anchor')).toBe('alerts-followup');
    await user.click(screen.getByTestId('safety-task-tour-done'));
    // Still on Alerts tab, never navigated to Incidents
    expect(screen.getByRole('button', { name: /^alerts$/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    confirmedView.unmount();
    window.localStorage.clear();

    // 3) DISMISSED alert with 0 detections: skips BOTH alerts-action-bar and alerts-followup (2 steps)
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [{ ...baseAlert, id: 'alert-dismissed-1', status: 'DISMISSED' }],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue({
      ...confirmedNoDetections,
      id: 'alert-dismissed-1',
      status: 'DISMISSED',
    });

    renderWithClient(
      <SafetyAlertsView
        apiUrl="http://localhost:3000"
        authenticatedSession={officerSession}
        initialSiteId="site-alpha"
        initialAlertId="alert-dismissed-1"
      />,
    );

    await user.click(await screen.findByTestId('safety-task-tour-invitation-start'));
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 2');
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );
    expect(screen.getByTestId('safety-task-tour-done')).toBeTruthy();
    expect(document.querySelector('[data-tour-anchor="alerts-action-bar"]')).toBeNull();
    expect(document.querySelector('[data-tour-anchor="alerts-followup"]')).toBeNull();
  });

  it('persists Skip per user/version and resets active tour on site, workspace tab, session, or 403/404 access-denied changes', async () => {
    const user = userEvent.setup();

    const view = renderWithClient(
      <SafetyAlertsView
        apiUrl="http://localhost:3000"
        authenticatedSession={officerSession}
        initialSiteId="site-alpha"
        initialAlertId="alert-pending-1"
      />,
    );

    // Skip invitation persists SKIPPED for user-so-1 only
    await user.click(await screen.findByTestId('safety-task-tour-invitation-skip'));
    expect(readSafetyTourProgress('user-so-1', 'alerts', ALERTS_TOUR_VERSION)).toBe('SKIPPED');
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toContain(
      `user-so-1:alerts:v${ALERTS_TOUR_VERSION}`,
    );

    // Switching session to user-so-2 shows invitation again (user-scoped persistence)
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <SafetyAlertsView
          apiUrl="http://localhost:3000"
          authenticatedSession={secondOfficerSession}
          initialSiteId="site-alpha"
          initialAlertId="alert-pending-1"
        />
      </QueryClientProvider>,
    );
    const startBtnUser2 = await screen.findByTestId('safety-task-tour-invitation-start');
    await user.click(startBtnUser2);
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();

    // Switching Site closes/resets the active tour session
    const siteSelect = screen.getByRole('combobox', { name: /site/i });
    await user.selectOptions(siteSelect, 'site-beta');
    await waitFor(() => {
      expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    });

    // Reopen tour on site-beta, then switch workspace tab to Overview -> tour unmounts cleanly
    await user.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect(await screen.findByTestId('safety-task-tour')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /overview/i }));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();

    // Switch back to Alerts, then simulate 403 detail access denial -> tour suppresses immediately
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockRejectedValue(
      new ApiError('http', 'Forbidden', 403),
    );
    view.queryClient.removeQueries({ queryKey: ['safety-alert'] });
    await user.click(screen.getByRole('button', { name: /^alerts$/i }));
    await screen.findByRole('alert');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  });
});
