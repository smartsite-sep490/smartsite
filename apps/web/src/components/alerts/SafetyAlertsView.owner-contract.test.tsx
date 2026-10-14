// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';
import i18n from '../../i18n';
import { SafetyAlertsView, type SafetyAlertsViewProps } from './SafetyAlertsView';

const mounted = vi.hoisted(() => ({ incident: vi.fn(), tasks: vi.fn() }));
vi.mock('../safety/IncidentView', () => ({
  IncidentView: (props: unknown) => {
    mounted.incident(props);
    return <div data-testid="owned-workflow">Workflow fixture</div>;
  },
}));
vi.mock('../safety/SafetyTasksView', () => ({
  SafetyTasksView: (props: unknown) => {
    mounted.tasks(props);
    return <div data-testid="owned-tasks">Tasks fixture</div>;
  },
}));

const siteId = '33333333-3333-4333-8333-333333333333';
const account: AccountResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'fixture-officer',
  displayName: 'Officer fixture',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: 'SAFETY_OFFICER', siteId }],
};
const shared = (
  user = account,
  token = 'fixture-current',
  scope = 'fixture-scope',
): SharedSession => ({
  accessToken: token,
  sessionScope: scope,
  user: { id: user.id, displayName: user.displayName, roleAssignments: user.roleAssignments },
});
const caches: QueryClient[] = [];
const base: SafetyAlertsViewProps = {
  apiUrl: 'https://backend.invalid',
  initialSiteId: siteId,
  sharedSession: shared(),
  authenticatedSession: { accessToken: 'fixture-current', user: account },
};
function mount(props: SafetyAlertsViewProps) {
  const cache = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  caches.push(cache);
  const ui = (value: SafetyAlertsViewProps) => (
    <QueryClientProvider client={cache}>
      <SafetyAlertsView {...value} />
    </QueryClientProvider>
  );
  const view = render(ui(props));
  return { ...view, update: (value: SafetyAlertsViewProps) => view.rerender(ui(value)) };
}
async function openIncident() {
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Incidents' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Incidents' })));
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
  mounted.incident.mockClear();
  mounted.tasks.mockClear();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      { id: siteId, code: 'SITE-A', name: 'Site fixture', createdAt: '2026-10-01T00:00:00Z' },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('Unexpected unmocked transport'))),
  );
});
afterEach(() => {
  cleanup();
  caches.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Owner-approved real-account boundary without modifying MF08', () => {
  it.each(['inactive', 'password-change'] as const)(
    'blocks protected requests for an explicitly %s full Account in both controlled modes',
    async (state) => {
      const rejected = {
        ...account,
        isActive: state !== 'inactive',
        mustChangePassword: state === 'password-change',
      };
      for (const hasShared of [false, true]) {
        const view = mount({
          ...base,
          sharedSession: hasShared ? shared() : undefined,
          authenticatedSession: { accessToken: 'fixture-current', user: rejected },
        });
        await act(async () => {
          await Promise.resolve();
        });
        expect(SmartSiteManagementClient.prototype.listSites).not.toHaveBeenCalled();
        expect(SmartSiteManagementClient.prototype.listSafetyAlerts).not.toHaveBeenCalled();
        expect(screen.queryByTestId('owned-workflow')).toBeNull();
        view.unmount();
      }
    },
  );
  it('shows a truthful full-account prompt for a shared-only Manager instead of falsely reporting no assigned Site', async () => {
    const manager = { ...account, roleAssignments: [{ role: 'SITE_MANAGER' as const, siteId }] };
    mount({ ...base, sharedSession: shared(manager), authenticatedSession: undefined });
    await waitFor(() => expect(SmartSiteManagementClient.prototype.listSites).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Session pending or expired'),
    );
    expect(
      screen.queryByText('No Site with Safety workflow access is assigned to this account.'),
    ).toBeNull();
    expect(mounted.incident).not.toHaveBeenCalled();
  });
  it('allows a dual-role officer to return from a manager workflow Site to their authorized Alert Site without granting manager-site Alert rights', async () => {
    const otherSite = '44444444-4444-4444-8444-444444444444';
    const dual = {
      ...account,
      roleAssignments: [
        ...account.roleAssignments,
        { role: 'SITE_MANAGER' as const, siteId: otherSite },
      ],
    };
    vi.mocked(SmartSiteManagementClient.prototype.listSites).mockResolvedValue({
      items: [
        { id: siteId, code: 'SITE-A', name: 'Site fixture', createdAt: '2026-10-01T00:00:00Z' },
        {
          id: otherSite,
          code: 'SITE-B',
          name: 'Other Site fixture',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 2,
    });
    mount({
      ...base,
      sharedSession: shared(dual),
      authenticatedSession: { accessToken: 'fixture-current', user: dual },
    });
    await openIncident();
    await act(async () =>
      fireEvent.change(screen.getByLabelText('Site'), { target: { value: otherSite } }),
    );
    await waitFor(() => expect(mounted.incident.mock.lastCall?.[0].siteId).toBe(otherSite));
    const alerts = screen.getByRole('button', { name: 'Alerts' }) as HTMLButtonElement;
    expect(alerts.disabled).toBe(false);
    await act(async () => fireEvent.click(alerts));
    await waitFor(() =>
      expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe(siteId),
    );
    expect(
      vi
        .mocked(SmartSiteManagementClient.prototype.listSafetyAlerts)
        .mock.calls.every((call) => call[1] === siteId),
    ).toBe(true);
  });
  it('hands the original aligned full Account to workflow without synthetic fields', async () => {
    mount(base);
    await openIncident();
    await waitFor(() => expect(screen.getByTestId('owned-workflow')).toBeTruthy());
    expect(mounted.incident.mock.lastCall?.[0].user).toBe(account);
    expect(mounted.incident.mock.lastCall?.[0].token).toBe('fixture-current');
  });
  it('rejects same-token same-user stale full-account roles instead of restoring revoked officer controls', async () => {
    const current = {
      ...account,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId }],
    };
    mount({ ...base, sharedSession: shared(current), initialIncidentId: 'fixture-deep-link' });
    await act(async () => {
      await Promise.resolve();
    });
    const incidentTab = screen.queryByRole('button', { name: 'Incidents' });
    if (incidentTab && !(incidentTab as HTMLButtonElement).disabled) {
      await act(async () => fireEvent.click(incidentTab));
    }
    expect(screen.queryByTestId('owned-workflow')).toBeNull();
    expect(mounted.incident).not.toHaveBeenCalled();
    expect(SmartSiteManagementClient.prototype.listSafetyAlerts).not.toHaveBeenCalled();
  });
  it('unmounts a previously aligned workflow when current shared roles change while the full Account lags', async () => {
    const view = mount(base);
    await openIncident();
    await waitFor(() => expect(screen.getByTestId('owned-workflow')).toBeTruthy());
    const current = {
      ...account,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId }],
    };
    view.update({ ...base, sharedSession: shared(current) });
    expect(screen.queryByTestId('owned-workflow')).toBeNull();
  });
  it('does not remount a stale full Account after controlled logout', async () => {
    const view = mount(base);
    await openIncident();
    await waitFor(() => expect(screen.getByTestId('owned-workflow')).toBeTruthy());
    view.update({ ...base, sharedSession: null });
    expect(screen.queryByTestId('owned-workflow')).toBeNull();
  });
  it('withholds workflow during credential rotation until its genuine full Account matches the new session', async () => {
    const view = mount(base);
    await openIncident();
    await waitFor(() => expect(screen.getByTestId('owned-workflow')).toBeTruthy());
    const next = { ...base, sharedSession: shared(account, 'fixture-next', 'fixture-next-scope') };
    view.update(next);
    expect(screen.queryByTestId('owned-workflow')).toBeNull();
    view.update({ ...next, authenticatedSession: { accessToken: 'fixture-next', user: account } });
    await openIncident();
    await waitFor(() => expect(screen.getByTestId('owned-workflow')).toBeTruthy());
    expect(mounted.incident.mock.lastCall?.[0].token).toBe('fixture-next');
  });
});
