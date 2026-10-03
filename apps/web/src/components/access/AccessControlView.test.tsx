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
  ZoneResponse,
  WorkerResponse,
  ZoneAccessGrantResponse,
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

const mockZonesList: Page<ZoneResponse> = {
  items: [
    {
      id: 'zone-1',
      siteId: 'site-alpha',
      code: 'ZONE-RESTRICTED-01',
      name: 'Vùng Nguy Hiểm Đào Đất',
      type: 'RESTRICTED',
      restrictionPolicy: 'AUTHORIZATION_REQUIRED',
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
      configurationLocked: false,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
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

const mockGrantsList: Page<ZoneAccessGrantResponse> = {
  items: [
    {
      id: 'grant-101',
      siteId: 'site-alpha',
      zoneId: 'zone-1',
      workerId: 'worker-1',
      effect: 'ALLOW',
      validFrom: '2026-09-28T08:00:00.000Z',
      validUntil: '2026-10-28T18:00:00.000Z',
      revokedAt: null,
      createdAt: '2026-09-28T08:00:00.000Z',
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

describe('AccessControlView MF06 Zone Clearance & Multi-Tab Integration Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });

    authSessionMock.user = mockAdminLoginResponse.user;
    authSessionMock.logout.mockReset();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  async function loginAsAdmin() {
    const loginSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'login')
      .mockResolvedValue(mockAdminLoginResponse);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue(mockZonesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue(mockWorkersList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZoneAccessGrants').mockResolvedValue(
      mockGrantsList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZoneEntryDecisions').mockResolvedValue(
      mockDecisionsList,
    );

    render(
      <QueryClientProvider client={queryClient}>
        <AccessControlView apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );

    // The app session already authenticated the user. Site Access must reuse it
    // without displaying or submitting a second login form.
    await waitFor(() => {
      expect(screen.getByText(/Quản trị viên Hệ thống/i)).not.toBeNull();
      expect(screen.queryByText(/Loading construction sites…/i)).toBeNull();
    });
    expect(screen.queryByLabelText(/username/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /open access control/i })).toBeNull();
    expect(loginSpy).not.toHaveBeenCalled();
  }

  it('1. Reuses the authenticated Admin session & isolates sites by active siteId', async () => {
    const user = userEvent.setup();
    const listZonesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones');
    const listWorkersSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers');

    await loginAsAdmin();

    expect(screen.getByText(/Site Access & Biometric Identity Control/i)).not.toBeNull();
    // Default site is the first site in the list: site-alpha
    expect(listZonesSpy).toHaveBeenCalledWith('mock-admin-token', 'site-alpha', expect.any(Object));
    expect(listWorkersSpy).toHaveBeenCalledWith(
      'mock-admin-token',
      'site-alpha',
      expect.any(Object),
    );

    // Switch active managed site to site-beta to prove site isolation
    const siteSelect = screen.getByLabelText(/active managed site:/i);
    await user.selectOptions(siteSelect, 'site-beta');

    await waitFor(() => {
      expect(listZonesSpy).toHaveBeenCalledWith(
        'mock-admin-token',
        'site-beta',
        expect.any(Object),
      );
      expect(listWorkersSpy).toHaveBeenCalledWith(
        'mock-admin-token',
        'site-beta',
        expect.any(Object),
      );
    });
  });

  it('2. List Workers & Zone selection: displays worker roster and active zone options', async () => {
    await loginAsAdmin();

    // Verify worker in roster scoped to Worker roster section
    const rosterHeading = await screen.findByRole('heading', { name: /worker roster/i });
    const rosterSection = rosterHeading.closest('section')!;
    expect(rosterSection).not.toBeNull();

    await waitFor(() => {
      const rosterScope = within(rosterSection);
      expect(rosterScope.getByText('Nguyen Van A')).not.toBeNull();
      expect(rosterScope.getByText('WKR-001')).not.toBeNull();
      expect(rosterScope.getByText('ACTIVE')).not.toBeNull();
    });

    // Verify zone in selector
    const zoneSelect = screen.getByRole('combobox', { name: /restricted zone/i });
    expect(
      within(zoneSelect).getByText(
        /ZONE-RESTRICTED-01 · Vùng Nguy Hiểm Đào Đất · AUTHORIZATION_REQUIRED/i,
      ),
    ).not.toBeNull();
  });

  it('3. Actual Zone Access Grant creation & revocation: calls createZoneAccessGrant and revokeZoneAccessGrant', async () => {
    const user = userEvent.setup();
    const createGrantSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createZoneAccessGrant')
      .mockResolvedValue({
        id: 'grant-new',
        siteId: 'site-alpha',
        zoneId: 'zone-1',
        workerId: 'worker-1',
        effect: 'ALLOW',
        validFrom: '2026-10-02T08:00:00.000Z',
        validUntil: null,
        revokedAt: null,
        createdAt: '2026-10-02T08:00:00.000Z',
      });
    const revokeGrantSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'revokeZoneAccessGrant')
      .mockResolvedValue({
        id: 'grant-101',
        siteId: 'site-alpha',
        zoneId: 'zone-1',
        workerId: 'worker-1',
        effect: 'ALLOW',
        validFrom: '2026-09-28T08:00:00.000Z',
        validUntil: '2026-10-28T18:00:00.000Z',
        revokedAt: '2026-10-02T00:00:00.000Z',
        createdAt: '2026-09-28T08:00:00.000Z',
      });

    await loginAsAdmin();

    // Test Revocation of existing grant
    const revokeButton = await screen.findByRole('button', { name: /revoke permission/i });
    await user.click(revokeButton);
    expect(revokeGrantSpy).toHaveBeenCalledWith(
      'mock-admin-token',
      'site-alpha',
      'zone-1',
      'grant-101',
    );

    // Test Creation of new grant scoped to Zone permissions section (level 2 to avoid matching h3 tab label)
    const permissionsHeading = screen.getByRole('heading', { name: /zone permissions/i, level: 2 });
    const grantSection = permissionsHeading.closest('section')!;
    expect(grantSection).not.toBeNull();

    const workerSelect = within(grantSection).getByRole('combobox', { name: /^worker$/i });
    await user.selectOptions(workerSelect, 'worker-1');
    const submitButton = within(grantSection).getByRole('button', { name: /create permission/i });
    await user.click(submitButton);

    expect(createGrantSpy).toHaveBeenCalledWith(
      'mock-admin-token',
      'site-alpha',
      'zone-1',
      expect.objectContaining({
        workerId: 'worker-1',
        effect: 'ALLOW',
      }),
    );
  });

  it('4. Candidate UNAVAILABLE in Entry Decisions: renders fail-closed label and candidateWorkerId', async () => {
    await loginAsAdmin();

    // Locate the table row containing candidate CANDIDATE-WKR-99
    const candidateCell = await screen.findByText('Candidate: CANDIDATE-WKR-99');
    const row = candidateCell.closest('tr')!;
    expect(row).not.toBeNull();

    // Verify Decision row with UNAVAILABLE status, track, reason, and ensure it is not Denied/Allowed
    const rowScope = within(row);
    expect(rowScope.getByText('Authorization unavailable')).not.toBeNull();
    expect(rowScope.getByText('#104')).not.toBeNull();
    expect(rowScope.getByText(/ZONE ENTRY IDENTITY UNAVAILABLE/i)).not.toBeNull();
    expect(rowScope.queryByText('Denied')).toBeNull();
    expect(rowScope.queryByText('Allowed')).toBeNull();
  });

  it('5. Navigation across 5 tabs: preserves default MF06 flow and switches to other tabs on click', async () => {
    const user = userEvent.setup();
    await loginAsAdmin();

    // Verify all 5 tab buttons exist in the navigation bar
    expect(screen.getByRole('button', { name: /MF06 Zone Permissions/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /MF02 Security Gate Desk/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /MF01 Worker Biometrics/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /RBAC Gate Permissions/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /MF04 QR Visitor Passes/i })).not.toBeNull();

    // Default tab is MF06 Zone Permissions: Worker roster & Zone permissions are visible
    expect(screen.getByText(/Worker roster/i)).not.toBeNull();
    expect(screen.getByText(/Rules in selected Zone/i)).not.toBeNull();

    // Switch to MF04 Visitor Passes tab
    const visitorTabButton = screen.getByRole('button', { name: /MF04 QR Visitor Passes/i });
    await user.click(visitorTabButton);

    // Verify Visitor Passes view is mounted without logging out
    await waitFor(() => {
      expect(screen.queryByText(/Rules in selected Zone/i)).toBeNull();
    });
  });

  it('6. Sign out uses the shared authenticated session instead of a local access session', async () => {
    const user = userEvent.setup();

    await loginAsAdmin();
    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutButton);
    expect(authSessionMock.logout).toHaveBeenCalledTimes(1);
  });

  it('7. Does not bypass access authorization for a non-global-admin session', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-alpha' }],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AccessControlView apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /active gate operator, Site Manager, Worker or Admin account/i,
    );
    expect(screen.queryByLabelText(/username/i)).toBeNull();
  });
  it('8. Site Manager opens its site visitor approval queue without Admin-only tabs', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSitesList.items[0]!],
      total: 1,
    });
    const visits = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listVisits')
      .mockResolvedValue({ items: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessControlView apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );
    await screen.findByText('No visitor pass requests at this site.');
    expect(visits).toHaveBeenCalledWith('mock-admin-token', 'site-alpha');
    expect(screen.queryByRole('button', { name: /MF01 Worker Biometrics/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /MF06 Zone Permissions/i })).toBeNull();
  });
  it('9. Worker can request its own QR without seeing gate operator or Admin actions', async () => {
    authSessionMock.user = {
      ...mockAdminLoginResponse.user,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-alpha' }],
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [mockSitesList.items[0]!],
      total: 1,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccessControlView apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );
    await screen.findByRole('button', { name: 'Get My QR' });
    expect(screen.queryByRole('button', { name: /Security Gate Desk/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Visitor Passes/i })).toBeNull();
  });
});
