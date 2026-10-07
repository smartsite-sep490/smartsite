// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type {
  LoginResponse,
  SiteResponse,
  WorkerResponse,
  ZoneEntryDecisionResponse,
  Page,
} from '@smartsite/api-client';
import { AccessControlView } from './AccessControlView';

const authSessionMock = vi.hoisted(() => ({
  accessToken: 'mock-admin-token',
  user: null as unknown,
  logout: vi.fn(),
}));

vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({
    accessToken: authSessionMock.accessToken,
    setAccessToken: vi.fn(),
    isSessionExpired: false,
    triggerSessionExpired: vi.fn(),
    dismissSessionExpired: vi.fn(),
  }),
  useCurrentUser: () => ({
    data: authSessionMock.user,
    isPending: false,
    isError: false,
    error: null,
  }),
  useLogout: () => ({
    mutate: authSessionMock.logout,
    isPending: false,
  }),
}));

const mockAdminLoginResponse: LoginResponse = {
  accessToken: 'mock-admin-token',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-01T23:59:59Z',
  refreshTokenExpiresAt: '2026-10-02T23:59:59Z',
  user: {
    id: 'user-admin-1',
    username: 'admin',
    displayName: 'Quản trị viên Hệ thống',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
    isActive: true,
    mustChangePassword: false,
  },
};

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Công trường Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'site-beta',
      code: 'SITE-B',
      name: 'Công trường Beta',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const mockWorkersList: Page<WorkerResponse> = {
  items: [
    {
      id: 'worker-1',
      siteId: 'site-alpha',
      contractorId: null,
      userId: null,
      externalId: 'WKR-001',
      displayName: 'Nguyen Van A',
      isActive: true,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockDecisionsList: Page<ZoneEntryDecisionResponse> = {
  items: [
    {
      id: 'decision-201',
      eventId: 'evt-ai-101',
      siteId: 'site-alpha',
      zoneId: 'zone-1',
      workerId: null,
      candidateWorkerId: 'CANDIDATE-WKR-99',
      trackId: 104,
      status: 'UNAVAILABLE',
      reasonCode: 'ZONE_ENTRY_IDENTITY_UNAVAILABLE',
      evaluatedAt: '2026-09-30T10:15:00.000Z',
      createdAt: '2026-09-30T10:15:00.000Z',
    },
  ],
  total: 1,
};

const setupData = {
  canReviewAssignments: true,
  canGrantContractorZones: true,
  canGrantWorkerZones: true,
  participations: [
    {
      id: 'participation-1',
      contractorId: 'contractor-1',
      name: 'Contractor One',
      validFrom: '2026-10-01T00:00:00Z',
      validUntil: '2026-10-31T00:00:00Z',
    },
  ],
  workers: [{ id: 'worker-1', name: 'Nguyen Van A', contractorId: 'contractor-1' }],
  zones: [{ id: 'zone-1', name: 'Restricted area' }],
  assignments: [
    {
      id: 'assignment-1',
      workerId: 'worker-1',
      workerName: 'Nguyen Van A',
      siteContractorId: 'participation-1',
      status: 'PENDING',
      validFrom: '2026-10-05T00:00:00Z',
      validUntil: '2026-10-06T00:00:00Z',
      version: 1,
      reviewNote: null,
    },
  ],
  contractorPermissions: [
    {
      id: 'cp-1',
      siteContractorId: 'participation-1',
      zoneId: 'zone-1',
      validFrom: '2026-10-05T00:00:00Z',
      validUntil: '2026-10-06T00:00:00Z',
      revokedAt: null,
    },
  ],
  workerPermissions: [],
};
describe('Site Access ERD integration', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    authSessionMock.user = mockAdminLoginResponse.user;
    authSessionMock.logout.mockReset();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue(setupData);
    vi.spyOn(SmartSiteManagementClient.prototype, 'attendanceOverview').mockResolvedValue({
      canRequestCorrection: false,
      canReviewCorrection: false,
      sessions: [],
      corrections: [],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue(mockWorkersList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZoneEntryDecisions').mockResolvedValue(
      mockDecisionsList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({ items: [] });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });
  function mount() {
    render(
      <QueryClientProvider client={queryClient}>
        <AccessControlView apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );
  }
  it('reuses authenticated session and scopes setup to the selected Site', async () => {
    const login = vi.spyOn(SmartSiteManagementClient.prototype, 'login');
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'Worker assignments and Zone permissions' });
    expect(login).not.toHaveBeenCalled();
    expect(SmartSiteManagementClient.prototype.accessSetup).toHaveBeenCalledWith(
      'mock-admin-token',
      'site-alpha',
    );
    await user.selectOptions(screen.getByLabelText(/active managed site:/i), 'site-beta');
    await waitFor(() =>
      expect(SmartSiteManagementClient.prototype.accessSetup).toHaveBeenCalledWith(
        'mock-admin-token',
        'site-beta',
      ),
    );
  });
  it('Site Manager reviews the pending assignment directly with its version', async () => {
    const user = userEvent.setup();
    const decide = vi
      .spyOn(SmartSiteManagementClient.prototype, 'decideWorkerSiteZoneAssignment')
      .mockResolvedValue({} as never);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        'mock-admin-token',
        'assignment-1',
        true,
        expect.objectContaining({ expectedVersion: 1 }),
      ),
    );
  });
  it('revokes the Contractor Zone parent permission through the new scoped endpoint', async () => {
    const user = userEvent.setup();
    const revoke = vi
      .spyOn(SmartSiteManagementClient.prototype, 'revokeZonePermission')
      .mockResolvedValue({ id: 'cp-1' });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Revoke Contractor Zone' }));
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('mock-admin-token', 'site-alpha', 'cp-1', 'contractor'),
    );
    expect(screen.queryByRole('button', { name: 'Create permission' })).toBeNull();
  });
  it('keeps AI candidate history as authorization unavailable', async () => {
    mount();
    const candidate = await screen.findByText('Candidate: CANDIDATE-WKR-99');
    const row = within(candidate.closest('tr')!);
    expect(row.getByText('Authorization unavailable')).toBeTruthy();
    expect(row.getByText('#104')).toBeTruthy();
    expect(row.queryByText('Allowed')).toBeNull();
  });
  it('switches to Visitor passes while keeping the shared session', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'Worker assignments and Zone permissions' });
    await user.click(screen.getByRole('button', { name: /MF04 QR Visitor Passes/i }));
    await screen.findByText('No visitor pass requests at this site.');
    expect(authSessionMock.logout).not.toHaveBeenCalled();
  });
  it('signs out through the shared session', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('heading', { name: 'Worker assignments and Zone permissions' });
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(authSessionMock.logout).toHaveBeenCalledTimes(1);
  });
  it('Representative sees scoped assignment/Zone setup without Admin account or gate controls', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-alpha' }],
    };
    vi.mocked(SmartSiteManagementClient.prototype.accessSetup).mockResolvedValue({
      ...setupData,
      canReviewAssignments: false,
      canGrantContractorZones: false,
    });
    mount();
    await screen.findByRole('heading', { name: 'Worker assignments and Zone permissions' });
    expect(screen.queryByRole('button', { name: /Security Gate Desk/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke Contractor Zone' })).toBeNull();
  });
  it('Site Manager can open its approval queue and configure Site permissions', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
    };
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: /MF04 QR Visitor Passes/i });
    await user.click(screen.getByRole('button', { name: /MF04 QR Visitor Passes/i }));
    await screen.findByText('No visitor pass requests at this site.');
    expect(screen.getByRole('button', { name: /MF06 Zone Permissions/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Worker Biometrics/i })).toBeNull();
  });
  it('Worker sees personal QR and attendance without gate operations', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-alpha' }],
    };
    mount();
    await screen.findByRole('button', { name: 'Get My QR' });
    expect(screen.queryByRole('button', { name: /Security Gate Desk/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Visitor Passes/i })).toBeNull();
    await screen.findByText(/Attendance/i);
  });
});
