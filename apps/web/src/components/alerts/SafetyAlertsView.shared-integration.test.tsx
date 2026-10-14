// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type ObservationIdentityContextResponse,
  type ObservationIdentityWorkerResponse,
  type Page,
  type SafetyAlertDetailResponse,
  type SafetyAlertResponse,
  type SiteResponse,
} from '@smartsite/api-client';
import i18n from '../../i18n';
import type { SharedSession } from '../../types/shared-session';
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

const sitesFixture: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'ALPHA',
      name: 'Alpha Tower',
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'site-beta',
      code: 'BETA',
      name: 'Beta Yard',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const alertAlphaSummary: SafetyAlertResponse = {
  id: 'alert-alpha-1',
  siteId: 'site-alpha',
  zoneId: null,
  candidateWorkerId: null,
  alertType: 'PPE_VIOLATION',
  candidateSubtype: 'PPE_HARD_HAT_MISSING',
  status: 'PENDING_REVIEW',
  firstDetectedAt: '2026-09-30T10:00:00Z',
  lastDetectedAt: '2026-09-30T10:00:00Z',
  detectionCount: 1,
  revision: 2,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
};

const alertAlphaDetail: SafetyAlertDetailResponse = {
  ...alertAlphaSummary,
  detectionsTotal: 1,
  detections: [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-09-30T10:00:00Z',
      processingStatus: 'PROCESSED',
      evidence: [],
    },
  ],
  reviewsTotal: 0,
  reviews: [],
};

const mockIdentityContext: ObservationIdentityContextResponse = {
  eventId: '00000000-0000-4000-8000-000000000001',
  payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  eventConsistent: true,
  frames: [],
  subjects: [],
};

const mockIdentityWorkers: Page<ObservationIdentityWorkerResponse> = {
  items: [],
  total: 0,
};

function makeAccount(
  id: string,
  roleAssignments: AccountResponse['roleAssignments'],
  overrides: Partial<AccountResponse> = {},
): AccountResponse {
  return {
    id,
    username: `${id}-user`,
    displayName: `${id} Display`,
    isActive: true,
    mustChangePassword: false,
    roleAssignments,
    ...overrides,
  };
}

function makeSharedSession(
  accessToken: string,
  sessionScope: string,
  account: Pick<AccountResponse, 'id' | 'displayName' | 'roleAssignments'>,
): SharedSession {
  return {
    accessToken,
    sessionScope,
    user: {
      id: account.id,
      displayName: account.displayName,
      roleAssignments: account.roleAssignments,
    },
  };
}

describe('SafetyAlertsView shared integration (MF05/MF06 + MF08)', () => {
  const caches: QueryClient[] = [];

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getObservationIdentityContext',
    ).mockResolvedValue(mockIdentityContext);
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listObservationIdentityWorkers',
    ).mockResolvedValue(mockIdentityWorkers);
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'listObservationIdentityDecisions',
    ).mockResolvedValue({ items: [], total: 0 });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('Unexpected unmocked transport'))),
    );
  });

  afterEach(async () => {
    cleanup();
    caches.splice(0).forEach((c) => c.clear());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  function createQueryClient() {
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    caches.push(qc);
    return qc;
  }

  it('allows SITE_MANAGER with matching sharedSession + authenticatedSession to use workflow tabs while blocking alert and identity queries', async () => {
    const queryClient = createQueryClient();

    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockResolvedValue(sitesFixture);
    const listAlertsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
      .mockResolvedValue({ items: [alertAlphaSummary], total: 1 });
    const detailSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
      .mockResolvedValue(alertAlphaDetail);
    const listIncidentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listIncidents')
      .mockResolvedValue({ items: [], total: 0 });
    const listTasksSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyTasks')
      .mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAssignees').mockResolvedValue({
      items: [],
      total: 0,
    });
    const getIdentityContextSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getObservationIdentityContext',
    );

    const managerRoles: AccountResponse['roleAssignments'] = [
      { role: 'SITE_MANAGER', siteId: 'site-alpha' },
    ];
    const account = makeAccount('acct-mgr', managerRoles);
    const sharedSession = makeSharedSession('token-mgr-1', 'scope-mgr-1', account);

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-mgr-1', user: account }}
          sharedSession={sharedSession}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(listSitesSpy).toHaveBeenCalledTimes(1);
      expect(listTasksSpy).toHaveBeenCalled();
    });

    expect(listAlertsSpy).not.toHaveBeenCalled();
    expect(detailSpy).not.toHaveBeenCalled();
    expect(getIdentityContextSpy).not.toHaveBeenCalled();

    const alertsTabBtn = screen.getByRole('button', { name: 'Alerts' }) as HTMLButtonElement;
    const incidentsTabBtn = screen.getByRole('button', { name: 'Incidents' }) as HTMLButtonElement;
    const tasksTabBtn = screen.getByRole('button', { name: 'Safety Tasks' }) as HTMLButtonElement;

    expect(alertsTabBtn.disabled).toBe(true);
    expect(incidentsTabBtn.disabled).toBe(false);
    expect(tasksTabBtn.disabled).toBe(false);

    fireEvent.click(incidentsTabBtn);
    await waitFor(() => {
      expect(listIncidentsSpy).toHaveBeenCalledWith(
        'token-mgr-1',
        'site-alpha',
        expect.anything(),
        { signal: expect.any(AbortSignal) },
      );
    });
    expect(listAlertsSpy).not.toHaveBeenCalled();
    expect(getIdentityContextSpy).not.toHaveBeenCalled();
  });

  it('prevents dual-site union from granting Alert or Identity rights on a Site where the user is only SITE_MANAGER', async () => {
    const queryClient = createQueryClient();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(sitesFixture);
    const listAlertsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
      .mockResolvedValue({ items: [alertAlphaSummary], total: 1 });
    const detailSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert')
      .mockResolvedValue(alertAlphaDetail);
    const listIncidentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listIncidents')
      .mockResolvedValue({ items: [], total: 0 });
    const listTasksSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSafetyTasks')
      .mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAssignees').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listContractors').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
      items: [],
      total: 0,
    });

    const dualRoles: AccountResponse['roleAssignments'] = [
      { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
      { role: 'SITE_MANAGER', siteId: 'site-beta' },
    ];
    const account = makeAccount('acct-dual', dualRoles);
    const sharedSession = makeSharedSession('token-dual-1', 'scope-dual-1', account);

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-dual-1', user: account }}
          sharedSession={sharedSession}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(detailSpy).toHaveBeenCalledWith(
        'token-dual-1',
        'site-alpha',
        'alert-alpha-1',
        expect.any(Object),
      );
    });
    expect((screen.getByRole('button', { name: 'Alerts' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(await screen.findByRole('button', { name: 'Confirm violation' })).not.toBeNull();

    // Workflow Site metadata is intentionally distinct from Alert-review Site metadata.
    fireEvent.click(screen.getByRole('button', { name: 'Incidents' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'BETA · Beta Yard' })).toBeTruthy(),
    );

    listAlertsSpy.mockClear();
    detailSpy.mockClear();
    listIncidentsSpy.mockClear();
    listTasksSpy.mockClear();

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'site-beta' } });

    await waitFor(() => {
      expect(listIncidentsSpy).toHaveBeenCalledWith(
        'token-dual-1',
        'site-beta',
        expect.anything(),
        { signal: expect.any(AbortSignal) },
      );
    });

    expect(listAlertsSpy).not.toHaveBeenCalled();
    expect(detailSpy).not.toHaveBeenCalled();
    // The tab is navigation back to the officer's authorized Site, not permission at Beta.
    expect((screen.getByRole('button', { name: 'Alerts' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole('button', { name: 'Confirm violation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Alerts' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('site-alpha'),
    );
    expect(listAlertsSpy.mock.calls.every((call) => call[1] === 'site-alpha')).toBe(true);
    expect(detailSpy.mock.calls.every((call) => call[1] === 'site-alpha')).toBe(true);
  });

  it('fails closed for workflow when authenticatedSession roles or credentials differ from sharedSession, and enables workflow only when aligned', async () => {
    const queryClient = createQueryClient();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(sitesFixture);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [alertAlphaSummary],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue({
      ...alertAlphaDetail,
      status: 'CONFIRMED',
      incidentId: null,
    });
    const listIncidentsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listIncidents')
      .mockResolvedValue({ items: [], total: 0 });

    const staleFullAccount = makeAccount('acct-so', [
      { role: 'ADMIN', siteId: null },
      { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
      { role: 'SITE_MANAGER', siteId: 'site-beta' },
    ]);
    const alignedFullAccount = makeAccount('acct-so', [
      { role: 'SAFETY_OFFICER', siteId: 'site-alpha' },
    ]);
    const currentShared = makeSharedSession('token-current', 'scope-current', alignedFullAccount);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-current', user: staleFullAccount }}
          sharedSession={currentShared}
        />
      </QueryClientProvider>,
    );

    await screen.findByText('ALPHA · Alpha Tower');

    expect(screen.queryByText('BETA · Beta Yard')).toBeNull();
    expect((screen.getByRole('button', { name: 'Incidents' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Safety Tasks' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Create incident from alert' })).toBeNull();
    expect(listIncidentsSpy).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-current', user: alignedFullAccount }}
          sharedSession={currentShared}
        />
      </QueryClientProvider>,
    );

    expect((screen.getByRole('button', { name: 'Incidents' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: 'Safety Tasks' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      await screen.findByRole('button', { name: 'Create incident from alert' }),
    ).not.toBeNull();
  });

  it('cancels and clears both Product evidence/identity queries and Main safety-workflow queries on controlled logout', async () => {
    const queryClient = createQueryClient();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(sitesFixture);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [alertAlphaSummary],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      alertAlphaDetail,
    );

    const account = makeAccount('acct-so', [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }]);
    const sharedSession = makeSharedSession('token-so-1', 'scope-so-1', account);

    queryClient.setQueryData(
      ['safety-alert-evidence', 'http://127.0.0.1:3001', 'scope-so-1', 'ev-alpha-1'],
      'blob:fake',
    );
    queryClient.setQueryData(
      ['observation-identity-workers', 'http://127.0.0.1:3001', 'scope-so-1', 'site-alpha'],
      [],
    );
    queryClient.setQueryData(
      ['safety-workflow', 'http://127.0.0.1:3001', 'scope-so-1', 'incidents', 'site-alpha'],
      [],
    );

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-so-1', user: account }}
          sharedSession={sharedSession}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole('button', { name: 'Confirm violation' });

    rerender(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-so-1', user: account }}
          sharedSession={null}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Session pending or expired')).not.toBeNull();
    expect(
      queryClient.getQueryData([
        'safety-alert-evidence',
        'http://127.0.0.1:3001',
        'scope-so-1',
        'ev-alpha-1',
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        'observation-identity-workers',
        'http://127.0.0.1:3001',
        'scope-so-1',
        'site-alpha',
      ]),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData([
        'safety-workflow',
        'http://127.0.0.1:3001',
        'scope-so-1',
        'incidents',
        'site-alpha',
      ]),
    ).toBeUndefined();
  });

  it('preserves selected Site, draft review reason, and machine review payload across EN -> VI -> EN locale switch', async () => {
    const queryClient = createQueryClient();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(sitesFixture);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [alertAlphaSummary],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(
      alertAlphaDetail,
    );
    const reviewSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
      .mockResolvedValue({
        alert: { ...alertAlphaSummary, status: 'CONFIRMED', revision: 3 },
        review: {
          id: 'rev-alpha-1',
          alertId: alertAlphaSummary.id,
          siteId: alertAlphaSummary.siteId,
          actorUserId: 'acct-so',
          fromStatus: 'PENDING_REVIEW',
          toStatus: 'CONFIRMED',
          reason: 'Confirmed hard hat missing on ramp',
          alertRevision: 2,
          createdAt: '2026-09-30T10:05:00Z',
        },
        replayed: false,
      });

    const account = makeAccount('acct-so', [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }]);
    const sharedSession = makeSharedSession('token-so-1', 'scope-so-1', account);

    render(
      <QueryClientProvider client={queryClient}>
        <SafetyAlertsView
          apiUrl="http://127.0.0.1:3001"
          authenticatedSession={{ accessToken: 'token-so-1', user: account }}
          sharedSession={sharedSession}
        />
      </QueryClientProvider>,
    );

    const textarea = await screen.findByRole('textbox', { name: /Decision reason/i });
    fireEvent.change(textarea, {
      target: { value: 'Confirmed hard hat missing on ramp' },
    });

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Vận hành an toàn' })).not.toBeNull();
    });

    expect(screen.getByDisplayValue('Confirmed hard hat missing on ramp')).not.toBeNull();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Safety operations' })).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm violation' }));

    await waitFor(() => {
      expect(reviewSpy).toHaveBeenCalledWith('token-so-1', 'site-alpha', 'alert-alpha-1', {
        expectedRevision: 2,
        targetStatus: 'CONFIRMED',
        reason: 'Confirmed hard hat missing on ramp',
        commandId: expect.any(String),
      });
    });
  });
});
