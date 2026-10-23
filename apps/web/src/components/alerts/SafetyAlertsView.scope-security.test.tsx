// @vitest-environment jsdom
import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type SafetyAlertDetailResponse,
} from '@smartsite/api-client';
import { SafetyAlertsView } from './SafetyAlertsView';

const apiUrl = 'http://127.0.0.1:3001';
const siteId = '11111111-1111-4111-8111-111111111111';
const alertId = '22222222-2222-4222-8222-222222222222';
const eventId = '33333333-3333-4333-8333-333333333333';
const scope = 'safety-security-scope';
const timestamp = '2026-10-08T12:00:00Z';
const session = {
  accessToken: 'private-software-test-token',
  sessionScope: scope,
  user: {
    id: 'officer-security-test',
    displayName: 'Fixture Safety Officer',
    roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId }],
  },
};
const detail: SafetyAlertDetailResponse = {
  id: alertId,
  siteId,
  zoneId: null,
  candidateWorkerId: null,
  alertType: 'PPE_VIOLATION',
  candidateSubtype: 'PPE_HARD_HAT_MISSING',
  status: 'PENDING_REVIEW',
  firstDetectedAt: timestamp,
  lastDetectedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  detectionCount: 1,
  revision: 0,
  detections: [
    {
      eventId,
      cameraExternalId: 'PRIVATE-CAMERA-OBSERVATION',
      capturedAt: timestamp,
      processingStatus: 'PROCESSED',
      evidence: [],
    },
  ],
  detectionsTotal: 1,
  reviews: [],
  reviewsTotal: 0,
};

describe('Safety Alerts suppress stale protected content after scope revalidation fails', () => {
  let client: QueryClient;
  let originalFetch: typeof globalThis.fetch;
  let onSignOut: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    originalFetch = globalThis.fetch;
    onSignOut = vi.fn();
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error('Unexpected network in isolated component test')),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [{ id: siteId, code: 'SITE-FIXTURE', name: 'Private Site', createdAt: timestamp }],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
      items: [detail],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockResolvedValue(detail);
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });
  async function openView() {
    const view = render(
      <QueryClientProvider client={client}>
        <SafetyAlertsView
          apiUrl={apiUrl}
          initialSiteId={siteId}
          sharedSession={{ ...session, onSignOut }}
        />
      </QueryClientProvider>,
    );
    await screen.findByText('PRIVATE-CAMERA-OBSERVATION');
    expect(screen.getByText(eventId)).toBeDefined();
    expect(
      screen.getByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
    ).toBeDefined();
    return view;
  }

  it.each([401, 403, 404])(
    'a Site%s after successful loading removes cached alert/detail and review controls',
    async (status) => {
      await openView();
      vi.mocked(SmartSiteManagementClient.prototype.listSites).mockRejectedValue(
        new ApiError('http', 'Access revoked', status),
      );
      await act(async () => {
        await client.refetchQueries({ queryKey: ['sites', apiUrl, scope], exact: true });
      });
      await waitFor(() => expect(screen.queryByText(eventId)).toBeNull());
      expect(screen.queryByText(eventId)).toBeNull();
      expect(screen.queryByText('PRIVATE-CAMERA-OBSERVATION')).toBeNull();
      expect(
        screen.queryByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
      ).toBeNull();
      expect(onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it.each([401, 403, 404])(
    'an alert-list%s removes cached selected detail instead of showing it beside the denied error',
    async (status) => {
      await openView();
      vi.mocked(SmartSiteManagementClient.prototype.listSafetyAlerts).mockRejectedValue(
        new ApiError('http', 'Access revoked', status),
      );
      await act(async () => {
        await client.refetchQueries({ queryKey: ['safety-alerts', apiUrl, scope, siteId] });
      });
      await waitFor(() => expect(screen.queryByText(eventId)).toBeNull());
      expect(screen.queryByText(eventId)).toBeNull();
      expect(screen.queryByText('PRIVATE-CAMERA-OBSERVATION')).toBeNull();
      expect(
        screen.queryByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
      ).toBeNull();
      expect(onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it.each([401, 403, 404])(
    'a selected-detail%s removes its old observation and review controls',
    async (status) => {
      await openView();
      const protectedKeys = [
        ['safety-alert-evidence', apiUrl, scope, siteId, alertId, eventId, 0],
        ['observation-identity-context', apiUrl, scope, siteId, alertId, eventId],
        ['safety-workflow', apiUrl, scope, siteId, 'alert-context', alertId, 0],
      ];
      protectedKeys.forEach((key) => client.setQueryData(key, { privateFixture: true }));
      vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockRejectedValue(
        new ApiError('http', 'Access revoked', status),
      );
      await act(async () => {
        await client.refetchQueries({
          queryKey: ['safety-alert', apiUrl, scope, siteId, alertId],
          exact: true,
        });
      });
      await waitFor(() => expect(screen.queryByText(eventId)).toBeNull());
      await waitFor(() => {
        protectedKeys.forEach((key) => expect(client.getQueryData(key)).toBeUndefined());
      });
      expect(screen.queryByText(eventId)).toBeNull();
      expect(screen.queryByText('PRIVATE-CAMERA-OBSERVATION')).toBeNull();
      expect(
        screen.queryByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
      ).toBeNull();
      expect(onSignOut).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it('a new account/token with a reused sessionScope cannot render the prior account cache while revalidating', async () => {
    const view = await openView();
    const sites = vi.mocked(SmartSiteManagementClient.prototype.listSites);
    sites.mockImplementation(() => new Promise(() => {}));
    const next = {
      ...session,
      accessToken: 'different-account-token',
      user: { ...session.user, id: 'different-account', displayName: 'Different Admin' },
      onSignOut,
    };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} initialSiteId={siteId} sharedSession={next} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(eventId)).toBeNull();
    expect(screen.queryByText('PRIVATE-CAMERA-OBSERVATION')).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
    ).toBeNull();
    await waitFor(() =>
      expect(sites.mock.calls.some(([token]) => token === next.accessToken)).toBe(true),
    );
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ),
    ).not.toContain(next.accessToken);
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.queryKey),
      ),
    ).not.toContain(session.accessToken);
  });

  it('a same-account token rotation with reused scope revalidates instead of exposing old cache', async () => {
    const view = await openView();
    const sites = vi.mocked(SmartSiteManagementClient.prototype.listSites);
    sites.mockImplementation(() => new Promise(() => {}));
    const next = { ...session, accessToken: 'rotated-same-account-token', onSignOut };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={next} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(eventId)).toBeNull();
    await waitFor(() =>
      expect(sites.mock.calls.some(([token]) => token === next.accessToken)).toBe(true),
    );
  });

  it('a controlled 401 signs out once and cannot restore protected cache while parent props stay unchanged', async () => {
    await openView();
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockRejectedValue(
      new ApiError('http', 'Expired', 401),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: ['safety-alert', apiUrl, scope, siteId, alertId],
        exact: true,
      });
    });
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue(detail);
    await act(async () => {
      await client.refetchQueries({ type: 'active' });
    });
    expect(screen.queryByText(eventId)).toBeNull();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.state.data !== undefined && query.queryKey[2] === scope),
    ).toBe(false);
  });

  it('a revoked Site403 can recover through Retry Sites without signing out', async () => {
    await openView();
    const sites = vi.mocked(SmartSiteManagementClient.prototype.listSites);
    const originalPage = await sites.mock.results[0]!.value;
    sites.mockRejectedValue(new ApiError('http', 'Revoked', 403));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['sites', apiUrl, scope], exact: true });
    });
    await waitFor(() => expect(screen.queryByText(eventId)).toBeNull());
    sites.mockResolvedValue(originalPage);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry Sites' }));
    await screen.findByText(eventId);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('a late old-token401 cannot sign out the newer account using the same incoming scope', async () => {
    const view = await openView();
    let rejectOld!: (error: unknown) => void;
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = client.refetchQueries({
        queryKey: ['safety-alert', apiUrl, scope, siteId, alertId],
        exact: true,
      });
    });
    const next = {
      ...session,
      accessToken: 'new-current-account-token',
      user: { ...session.user, id: 'new-current-account' },
      onSignOut,
    };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={next} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(SmartSiteManagementClient.prototype.getSafetyAlert)
          .mock.calls.some(([token]) => token === next.accessToken),
      ).toBe(true),
    );
    await act(async () => {
      rejectOld(new ApiError('http', 'Old token expired', 401));
      await refresh;
    });
    await screen.findByText(eventId);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('a standalone authenticated401 clears its session, cache and returns to sign-in', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue({
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      accessTokenExpiresAt: timestamp,
      refreshTokenExpiresAt: timestamp,
      user: { ...session.user, username: 'fixture', isActive: true, mustChangePassword: false },
    });
    render(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Username'), 'fixture');
    await user.type(screen.getByLabelText('Password'), 'fixture-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Alerts' }));
    await screen.findByText(eventId);
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockRejectedValue(
      new ApiError('http', 'Expired', 401),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['safety-alert', apiUrl] });
    });
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText(eventId)).toBeNull();
    expect(vi.mocked(SmartSiteManagementClient.prototype.logout)).toHaveBeenCalledTimes(1);
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.state.data !== undefined),
    ).toBe(false);
  });

  it('each new incoming scope can sign out once even when its local numeric generation starts at zero', async () => {
    const view = await openView();
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockRejectedValue(
      new ApiError('http', 'Expired', 401),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: ['safety-alert', apiUrl, scope, siteId, alertId],
        exact: true,
      });
    });
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue(detail);
    const nextScope = 'independent-next-safety-scope';
    const next = { ...session, accessToken: 'new-scope-token', sessionScope: nextScope, onSignOut };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={next} />
      </QueryClientProvider>,
    );
    await screen.findByText(eventId);
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockRejectedValue(
      new ApiError('http', 'Expired again', 401),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: ['safety-alert', apiUrl, nextScope, siteId, alertId],
        exact: true,
      });
    });
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(eventId)).toBeNull();
  });

  it('a review401 expires the current session and suppresses cached observations', async () => {
    await openView();
    vi.spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert').mockRejectedValue(
      new ApiError('http', 'Review session expired', 401),
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
      'Evidence review software fixture',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(eventId)).toBeNull();
  });

  it('a delayed old-session review401 does not expire the newer reused-scope session', async () => {
    const view = await openView();
    let rejectOld!: (error: unknown) => void;
    const review = vi
      .spyOn(SmartSiteManagementClient.prototype, 'reviewSafetyAlert')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      );
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
      'Evidence review software fixture',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(1));
    const next = { ...session, accessToken: 'new-review-account-token', onSignOut };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={next} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(SmartSiteManagementClient.prototype.getSafetyAlert)
          .mock.calls.some(([token]) => token === next.accessToken),
      ).toBe(true),
    );
    await act(async () => {
      rejectOld(new ApiError('http', 'Old review expired', 401));
    });
    await screen.findByText(eventId);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('a child evidence401 expires the parent session and removes cached alert observations', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue({
      ...detail,
      detections: [
        { ...detail.detections[0]!, evidence: [{ index: 0, kind: 'FRAME', available: true }] },
      ],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence').mockRejectedValue(
      new ApiError('http', 'Evidence session expired', 401),
    );
    await openView();
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(eventId)).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Decision reason (minimum 5 characters)' }),
    ).toBeNull();
  });

  it('a child identity-context401 expires a scoped Safety Officer parent session', async () => {
    vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getObservationIdentityContext',
    ).mockRejectedValue(new ApiError('http', 'Identity session expired', 401));
    const officer = {
      ...session,
      user: { ...session.user, roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId }] },
      onSignOut,
    };
    render(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={officer} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(eventId)).toBeNull();
  });

  it.each([403, 404])('a child evidence%s keeps the parent signed in', async (status) => {
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue({
      ...detail,
      detections: [
        { ...detail.detections[0]!, evidence: [{ index: 0, kind: 'FRAME', available: true }] },
      ],
    });
    const evidence = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence')
      .mockRejectedValue(new ApiError('http', 'Evidence unavailable in this scope', status));
    await openView();
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    await waitFor(() => expect(evidence).toHaveBeenCalledTimes(1));
    await screen.findByText(status === 403 ? /cannot view evidence/i : /no longer available/i);
    expect(screen.getByText(eventId)).toBeDefined();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('a delayed old-token child evidence401 cannot expire a newer reused-scope session', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue({
      ...detail,
      detections: [
        { ...detail.detections[0]!, evidence: [{ index: 0, kind: 'FRAME', available: true }] },
      ],
    });
    let rejectOld!: (error: unknown) => void;
    const evidence = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      );
    const view = await openView();
    await userEvent.setup().click(screen.getByRole('button', { name: 'View Frame' }));
    await waitFor(() => expect(evidence).toHaveBeenCalledTimes(1));
    const next = { ...session, accessToken: 'rotated-child-evidence-token', onSignOut };
    view.rerender(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} sharedSession={next} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        vi
          .mocked(SmartSiteManagementClient.prototype.getSafetyAlert)
          .mock.calls.some(([token]) => token === next.accessToken),
      ).toBe(true),
    );
    await act(async () => {
      rejectOld(new ApiError('http', 'Expired old child request', 401));
    });
    await screen.findByText(eventId);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('a standalone child evidence401 logs out once and returns to the expired-session sign-in form', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue({
      accessToken: session.accessToken,
      tokenType: 'Bearer',
      accessTokenExpiresAt: timestamp,
      refreshTokenExpiresAt: timestamp,
      user: {
        ...session.user,
        username: 'fixture.admin',
        isActive: true,
        mustChangePassword: false,
      },
    });
    vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue({
      ...detail,
      detections: [
        { ...detail.detections[0]!, evidence: [{ index: 0, kind: 'FRAME', available: true }] },
      ],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence').mockRejectedValue(
      new ApiError('http', 'Evidence session expired', 401),
    );
    render(
      <QueryClientProvider client={client}>
        <SafetyAlertsView apiUrl={apiUrl} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Username/i), 'fixture.admin');
    await user.type(screen.getByLabelText(/Password/i), 'synthetic-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Alerts' }));
    await screen.findByText(eventId);
    await user.click(screen.getByRole('button', { name: 'View Frame' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.getByText('Your session is no longer valid. Sign in again.')).toBeDefined();
    expect(screen.queryByText(eventId)).toBeNull();
    expect(SmartSiteManagementClient.prototype.logout).toHaveBeenCalledTimes(1);
  });
});
