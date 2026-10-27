// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type AccountResponse,
  type WorkerResponse,
} from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeUiLanguage } from '../../../i18n/runtime';
import { WorkerEnrollmentView } from './WorkerEnrollmentView';

describe('account-first enrollment', () => {
  beforeEach(() => {
    changeUiLanguage('en');
  });

  afterEach(() => {
    changeUiLanguage('en');
    cleanup();
    vi.restoreAllMocks();
  });

  it('requires selection of an existing account and never offers free-form worker creation', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkerEnrollmentView
          apiUrl="https://api.example.test"
          siteId="site-1"
          sessionScope="synthetic-session"
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('face-account-search');
    expect(html).toContain('Select an existing account');
    expect(html).not.toContain('worker-select');
    expect(html).not.toContain('Tạo &amp; chọn');
    expect(html).not.toContain('name="externalId"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    queryClient.clear();
  });

  it('uses selected worker title and initials instead of No account selected when canManageAccounts is false', async () => {
    const user = userEvent.setup();
    const workerItem: WorkerResponse = {
      id: 'worker-1',
      siteId: 'site-1',
      contractorId: 'contractor-1',
      userId: null,
      externalId: 'WKR-001',
      displayName: 'Nguyen Van A',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const listUsersSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listUsers')
      .mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
      items: [workerItem],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getFaceProfile').mockRejectedValue(
      new ApiError('http', 'Face profile not found.', 404),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkerEnrollmentView
          apiUrl="https://api.example.test"
          token="token-1"
          siteId="site-1"
          sessionScope="synthetic-session"
          canManageAccounts={false}
        />
      </QueryClientProvider>,
    );

    const workerSelect = await screen.findByLabelText(/Existing Worker profile/i);
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Nguyen Van A · WKR-001' })).toBeTruthy();
    });
    await user.selectOptions(workerSelect, 'worker-1');

    await waitFor(() => {
      expect(screen.getByText(/Worker ID: WKR-001/)).toBeTruthy();
    });

    expect(screen.getByText('NG')).toBeTruthy();
    expect(screen.getByText('Nguyen Van A')).toBeTruthy();
    expect(screen.queryByText('WS')).toBeNull();
    expect(screen.queryByText('No account selected')).toBeNull();
    expect(screen.queryByText('No Worker Selected')).toBeNull();
    expect(screen.queryByText('Select an account before enrolling face biometrics')).toBeNull();
    expect(listUsersSpy).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it('shows worker-selection fallback copy instead of account-selection copy when canManageAccounts is false and no worker is selected', () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
      items: [],
      total: 0,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkerEnrollmentView
          apiUrl="https://api.example.test"
          token="token-1"
          siteId="site-1"
          sessionScope="synthetic-session"
          canManageAccounts={false}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('WS')).toBeTruthy();
    expect(screen.getByText('No Worker Selected')).toBeTruthy();
    expect(screen.getByText('Select a worker from this site')).toBeTruthy();
    expect(screen.queryByText('No account selected')).toBeNull();
    expect(screen.queryByText('Select an account before enrolling face biometrics')).toBeNull();
    queryClient.clear();
  });

  it('preserves legacy account-mode header behavior when canManageAccounts is true by default', async () => {
    const user = userEvent.setup();
    const accountItem: AccountResponse = {
      id: 'user-1',
      username: 'worker.account',
      displayName: 'Tran Van B',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [
        {
          role: 'WORKER',
          siteId: 'site-1',
        },
      ],
    };
    const linkedWorkerItem: WorkerResponse = {
      id: 'worker-2',
      siteId: 'site-1',
      contractorId: 'contractor-1',
      userId: 'user-1',
      externalId: 'WKR-002',
      displayName: 'Tran Van B',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers').mockResolvedValue({
      items: [accountItem],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
      items: [linkedWorkerItem],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'prepareFaceAccount').mockResolvedValue(
      linkedWorkerItem,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getFaceProfile').mockRejectedValue(
      new ApiError('http', 'Face profile not found.', 404),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkerEnrollmentView
          apiUrl="https://api.example.test"
          token="token-1"
          siteId="site-1"
          sessionScope="synthetic-session"
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('WS')).toBeTruthy();
    expect(screen.getByText('No account selected')).toBeTruthy();
    expect(screen.getByText('Select an account before enrolling face biometrics')).toBeTruthy();

    const accountSelect = await screen.findByLabelText(/Target Account/i);
    await waitFor(() => {
      expect(
        screen.getByRole('option', {
          name: 'worker.account — Tran Van B',
        }),
      ).toBeTruthy();
    });
    await user.selectOptions(accountSelect, 'user-1');

    await waitFor(() => {
      expect(screen.getByText('worker.account')).toBeTruthy();
      expect(screen.getByText(/Worker ID: WKR-002/)).toBeTruthy();
    });

    expect(screen.getByText('TR')).toBeTruthy();
    expect(screen.queryByText('No account selected')).toBeNull();
    queryClient.clear();
  });
});
