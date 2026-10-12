// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractorDashboardView } from './ContractorDashboardView';
import { DashboardView } from '../dashboard/DashboardView';

const api = vi.hoisted(() => ({
  contractorDashboardScopes: vi.fn(),
  contractorDashboard: vi.fn(),
  listContractorTeams: vi.fn(),
  contractorTeamDetail: vi.fn(),
  createContractorTeam: vi.fn(),
  updateContractorTeam: vi.fn(),
  archiveContractorTeam: vi.fn(),
  listContractorTeamWorkers: vi.fn(),
  assignContractorTeam: vi.fn(),
}));

vi.mock('@smartsite/api-client', () => ({
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));

interface MockUser {
  data: {
    id: string;
    username: string;
    roleAssignments: Array<{
      role: string;
      siteId: string | null;
      contractorId?: string | null;
    }>;
  };
}

const mockCurrentUser: MockUser = vi.hoisted(() => ({
  data: {
    id: 'user-contractor-1',
    username: 'contractor.demo',
    roleAssignments: [
      {
        role: 'CONTRACTOR_REPRESENTATIVE',
        siteId: 'site-alpha',
        contractorId: 'contractor-paint',
      },
    ],
  },
}));

vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({
    accessToken: 'synthetic-jwt-token',
  }),
  useCurrentUser: () => mockCurrentUser,
}));

const syntheticScopes = [
  {
    siteId: 'site-alpha',
    siteName: 'Skyline Tower A',
    siteCode: 'SKY-A',
    contractorId: 'contractor-paint',
    contractorName: 'Apex Painting Ltd',
  },
  {
    siteId: 'site-beta',
    siteName: 'Riverside Complex',
    siteCode: 'RIV-B',
    contractorId: 'contractor-paint',
    contractorName: 'Apex Painting Ltd',
  },
];

const syntheticDashboard = {
  scope: syntheticScopes[0]!,
  workerCount: 24,
  teamCount: 3,
  unassignedWorkerCount: 5,
};

const syntheticTeams = [
  {
    id: 'team-1',
    siteId: 'site-alpha',
    contractorId: 'contractor-paint',
    name: 'Interior Paint Team',
    description: 'Drywall & Interior finish',
    isActive: true,
    version: 2,
    memberCount: 12,
  },
  {
    id: 'team-2',
    siteId: 'site-alpha',
    contractorId: 'contractor-paint',
    name: 'Exterior Coating Team',
    description: 'Scaffolding & weather coating',
    isActive: true,
    version: 1,
    memberCount: 7,
  },
  {
    id: 'team-3',
    siteId: 'site-alpha',
    contractorId: 'contractor-paint',
    name: 'Old Prep Team',
    description: 'Decommissioned preparation squad',
    isActive: true,
    version: 4,
    memberCount: 0,
  },
];

const syntheticWorkers = [
  {
    workerId: 'worker-101',
    displayName: 'Nguyen Van A',
    membershipId: 'mem-101',
    teamId: 'team-1',
    teamName: 'Interior Paint Team',
  },
  {
    workerId: 'worker-102',
    displayName: 'Tran Van B',
    membershipId: null,
    teamId: null,
    teamName: null,
  },
];

let queryClient: QueryClient;

function renderView(props = {}) {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ContractorDashboardView apiUrl="https://api.example.test" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUser.data.roleAssignments = [
    {
      role: 'CONTRACTOR_REPRESENTATIVE',
      siteId: 'site-alpha',
      contractorId: 'contractor-paint',
    },
  ];
  api.contractorDashboardScopes.mockResolvedValue({ items: [syntheticScopes[0]!] });
  api.contractorDashboard.mockResolvedValue(syntheticDashboard);
  api.listContractorTeams.mockResolvedValue({
    items: syntheticTeams,
    total: syntheticTeams.length,
    offset: 0,
    limit: 10,
  });
  api.listContractorTeamWorkers.mockResolvedValue({
    items: syntheticWorkers,
    total: syntheticWorkers.length,
    offset: 0,
    limit: 10,
  });
  api.createContractorTeam.mockResolvedValue({
    id: 'team-new',
    siteId: 'site-alpha',
    contractorId: 'contractor-paint',
    name: 'Specialist Spray Team',
    description: 'Spray painting',
    isActive: true,
    version: 1,
    memberCount: 0,
  });
  api.updateContractorTeam.mockResolvedValue({
    ...syntheticTeams[0],
    name: 'Interior Finish Master Team',
    version: 3,
  });
  api.archiveContractorTeam.mockResolvedValue({
    ...syntheticTeams[2],
    isActive: false,
    version: 5,
  });
  api.assignContractorTeam.mockResolvedValue({
    workerId: 'worker-102',
    displayName: 'Tran Van B',
    membershipId: 'mem-102-new',
    teamId: 'team-1',
    teamName: 'Interior Paint Team',
  });
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  vi.restoreAllMocks();
});

describe('ContractorDashboardView Integration & UI Rules', () => {
  it('loads scopes, displays selected scope name/code, and renders KPI metrics from backend', async () => {
    renderView();

    expect(screen.getByRole('status', { name: /loading contractor scopes/i })).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Skyline Tower A/i })).not.toBeNull();
      expect(screen.getByText('(SKY-A)')).not.toBeNull();
      expect(screen.getAllByText('Apex Painting Ltd')[0]).not.toBeNull();

      // Check KPI cards
      expect(screen.getByText('24')).not.toBeNull(); // Managed Workers
      expect(screen.getByText('3')).not.toBeNull(); // Active Teams
      expect(screen.getByText('5')).not.toBeNull(); // Unassigned Workers
      expect(
        screen.getByText(/Workers not in a team cannot participate in shift swaps/i),
      ).not.toBeNull();

      // Check teams table
      expect(screen.getByText('Interior Paint Team')).not.toBeNull();
      expect(screen.getByText('Exterior Coating Team')).not.toBeNull();
      expect(screen.getByText('Old Prep Team')).not.toBeNull();
    });
  });

  it('requires explicit scope selection when multiple scopes exist and triggers queries upon selection', async () => {
    api.contractorDashboardScopes.mockResolvedValueOnce({ items: syntheticScopes });
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/Scope Selection Required/i)).not.toBeNull();
    });

    const select = screen.getByLabelText(/Active Site Scope/i);
    fireEvent.change(select, { target: { value: 'site-beta:contractor-paint' } });

    await waitFor(() => {
      expect(api.contractorDashboard).toHaveBeenCalledWith(
        'synthetic-jwt-token',
        'site-beta',
        'contractor-paint',
      );
      expect(screen.getByRole('heading', { name: /Riverside Complex/i })).not.toBeNull();
    });
  });

  it('handles empty scopes gracefully', async () => {
    api.contractorDashboardScopes.mockResolvedValueOnce({ items: [] });
    renderView();

    await waitFor(() => {
      expect(screen.getByText(/No Contractor Scopes Available/i)).not.toBeNull();
    });
  });

  it('handles 403 access denied on scopes discovery with clear error and retry', async () => {
    const error403 = Object.assign(new Error('Forbidden'), { status: 403 });
    api.contractorDashboardScopes.mockRejectedValueOnce(error403);

    renderView();

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull();
      expect(screen.getByText(/Access Denied/i)).not.toBeNull();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).not.toBeNull();
  });

  it('creates a new contractor team and sends requestId', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Create Team/i })).not.toBeNull();
    });

    await user.click(screen.getByRole('button', { name: /\+ Create Team/i }));

    expect(screen.getByText(/Create New Contractor Team/i)).not.toBeNull();

    const nameInput = screen.getByLabelText(/Team Name/i);
    const descInput = screen.getByLabelText(/Description \(Optional\)/i);

    await user.type(nameInput, 'Specialist Spray Team');
    await user.type(descInput, 'Spray painting');

    const submitBtn = screen.getByRole('button', { name: /^Create Team$/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api.createContractorTeam).toHaveBeenCalledWith(
        'synthetic-jwt-token',
        'site-alpha',
        'contractor-paint',
        expect.objectContaining({
          name: 'Specialist Spray Team',
          description: 'Spray painting',
          requestId: expect.any(String),
        }),
      );
    });
  });

  it('disables archiving for teams with active members and allows archiving for empty teams', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('Interior Paint Team')).not.toBeNull();
    });

    // Team 1 (memberCount = 12) has disabled archive
    const archiveButtons = screen.getAllByRole('button', { name: /Archive/i });
    expect((archiveButtons[0] as HTMLButtonElement).disabled).toBe(true);

    // Team 3 (memberCount = 0) has enabled archive
    expect((archiveButtons[2] as HTMLButtonElement).disabled).toBe(false);

    await user.click(archiveButtons[2]!);

    expect(screen.getByText(/Archive Contractor Team/i)).not.toBeNull();

    const confirmBtn = screen.getByRole('button', { name: /Confirm Archive/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.archiveContractorTeam).toHaveBeenCalledWith(
        'synthetic-jwt-token',
        'site-alpha',
        'contractor-paint',
        'team-3',
        {
          expectedVersion: 4,
          reason: 'Archived by contractor representative',
        },
      );
    });
  });

  it('assigns an unassigned worker without asking for or sending a reason', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Worker Assignments/i })).not.toBeNull();
    });

    await user.click(screen.getByRole('button', { name: /Worker Assignments/i }));

    await waitFor(() => {
      expect(screen.getByText('Tran Van B')).not.toBeNull();
      expect(screen.getAllByText(/Unassigned/i).length).toBeGreaterThan(0);
    });

    // Click Assign Team for unassigned worker
    const assignBtn = screen.getByRole('button', { name: /Assign Team/i });
    await user.click(assignBtn);

    expect(screen.getByText(/Assign Worker to Team/i)).not.toBeNull();

    const targetSelect = screen.getByLabelText(/Target Team/i);
    fireEvent.change(targetSelect, { target: { value: 'team-1' } });

    expect(screen.queryByLabelText(/^Reason/i)).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: /Confirm Assignment/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.assignContractorTeam).toHaveBeenCalledWith(
        'synthetic-jwt-token',
        'site-alpha',
        'contractor-paint',
        'worker-102',
        expect.objectContaining({
          expectedMembershipId: null,
          teamId: 'team-1',
          requestId: expect.any(String),
        }),
      );
    });
    expect(api.assignContractorTeam.mock.calls[0]?.[4]).not.toHaveProperty('reason');
  });

  it('no longer requires a reason when transferring or removing an existing membership', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole('button', { name: /Worker Assignments/i }));
    await user.click(await screen.findByRole('button', { name: /Transfer \/ Remove/i }));

    const confirm = screen.getByRole('button', { name: /Confirm Assignment/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByLabelText(/^Reason/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/Target Team/i), { target: { value: 'team-2' } });
    await user.click(confirm);

    await waitFor(() => {
      expect(api.assignContractorTeam).toHaveBeenCalledWith(
        'synthetic-jwt-token',
        'site-alpha',
        'contractor-paint',
        'worker-101',
        expect.objectContaining({
          expectedMembershipId: 'mem-101',
          teamId: 'team-2',
          reason: 'Updated by contractor representative',
          requestId: expect.any(String),
        }),
      );
    });
  });

  it('DashboardView renders ContractorDashboardView for CONTRACTOR_REPRESENTATIVE role', async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const onNavigate = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DashboardView onNavigate={onNavigate} apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Contractor Dashboard/i)).not.toBeNull();
      expect(screen.getByRole('heading', { name: /Skyline Tower A/i })).not.toBeNull();
    });
  });

  it('DashboardView preserves standard site overview for ADMIN role', async () => {
    mockCurrentUser.data.roleAssignments = [{ role: 'ADMIN', siteId: null }];

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const onNavigate = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DashboardView onNavigate={onNavigate} apiUrl="https://api.example.test" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Site Operational Overview')).not.toBeNull();
    });
  });
});
