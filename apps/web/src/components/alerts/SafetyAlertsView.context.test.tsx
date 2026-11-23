// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type SafetyAlertDetailResponse,
  type SafetyAlertWorkContextResponse,
} from '@smartsite/api-client';
import { SafetyAlertsView } from './SafetyAlertsView';
import i18n from '../../i18n';

const context: SafetyAlertWorkContextResponse = {
  capturedAt: '2026-11-22T01:00:00Z',
  identity: 'UNKNOWN',
  workers: [],
  relatedTeams: [],
  zoneName: 'Lobby level 1',
  cameraName: 'Lobby camera',
  warning: '',
};
const alert: SafetyAlertDetailResponse = {
  id: 'alert-a',
  siteId: 'site-a',
  zoneId: null,
  candidateWorkerId: null,
  alertType: 'PPE_VIOLATION',
  candidateSubtype: 'PPE_HARD_HAT_MISSING',
  status: 'CONFIRMED',
  firstDetectedAt: context.capturedAt,
  lastDetectedAt: context.capturedAt,
  detectionCount: 0,
  revision: 1,
  createdAt: '',
  updatedAt: '',
  detections: [],
  detectionsTotal: 0,
  reviews: [],
  reviewsTotal: 0,
};
beforeEach(async () => {
  await i18n.changeLanguage('en');
  const proto = SmartSiteManagementClient.prototype;
  vi.spyOn(proto, 'listSites').mockResolvedValue({
    items: [{ id: 'site-a', code: 'A', name: 'Site A', createdAt: '' }],
    total: 1,
  });
  vi.spyOn(proto, 'listSafetyAlerts').mockResolvedValue({ items: [alert], total: 1 });
  vi.spyOn(proto, 'getSafetyAlert').mockResolvedValue(alert);
  vi.spyOn(proto, 'getAlertWorkContext').mockResolvedValue(context);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <SafetyAlertsView
        view="Alerts"
        apiUrl="https://example.test"
        initialSiteId="site-a"
        initialAlertId="alert-a"
        authenticatedSession={{
          accessToken: 'synthetic',
          user: {
            id: 'safety',
            username: 'safety',
            displayName: 'Safety',
            isActive: true,
            mustChangePassword: false,
            roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
          },
        }}
      />
    </QueryClientProvider>,
  );
}
it('shows one work context without source records or photos in Review and Evidence', async () => {
  mount();
  expect(await screen.findByText(/Lobby level 1.*Lobby camera/)).toBeTruthy();
  expect(screen.getAllByRole('heading', { name: 'Work context' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
  expect(screen.getByText(/Lobby level 1.*Lobby camera/)).toBeTruthy();
  expect(screen.getAllByRole('heading', { name: 'Work context' })).toHaveLength(1);
});
it('keeps explicit metadata placeholders when the context exists but names are missing', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getAlertWorkContext).mockResolvedValue({
    ...context,
    zoneName: null,
    cameraName: null,
  });
  mount();
  expect(
    await screen.findByText(/Zone: No information yet.*Camera: No information yet/),
  ).toBeTruthy();
});
it('does not repeat the alert context for multiple source observations', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getSafetyAlert).mockResolvedValue({
    ...alert,
    detectionsTotal: 2,
    detections: ['source-a', 'source-b'].map((eventId) => ({
      eventId,
      cameraExternalId: 'test-camera',
      capturedAt: context.capturedAt,
      processingStatus: 'PROCESSED',
      evidence: [],
    })),
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getObservationIdentityContext').mockImplementation(
    async (_token, _site, _alert, eventId) => ({
      eventId,
      payloadHash: '0123456789abcdef'.repeat(4),
      eventConsistent: true,
      frames: [],
      subjects: [],
    }),
  );
  mount();
  await screen.findByText(/Lobby level 1.*Lobby camera/);
  fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
  expect(screen.getAllByText('test-camera')).toHaveLength(2);
  expect(screen.getAllByRole('heading', { name: 'Work context' })).toHaveLength(1);
});
it('shows a retryable context error without inventing camera or zone metadata', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getAlertWorkContext)
    .mockRejectedValueOnce(new ApiError('http', 'Context unavailable', 403))
    .mockResolvedValueOnce(context);
  mount();
  const heading = await screen.findByRole('heading', { name: 'Work context' });
  const section = within(heading.parentElement!);
  const retry = await section.findByRole('button', { name: 'Retry' });
  expect(section.queryByText(/Lobby level 1|Lobby camera/)).toBeNull();
  fireEvent.click(retry);
  expect(await section.findByText(/Lobby level 1.*Lobby camera/)).toBeTruthy();
});
it('does not display the alerts guide entry or reset controls', async () => {
  mount();
  await screen.findByText(/No source observation is linked/);
  expect(screen.queryByRole('button', { name: /guide|guided help|reset tutorial/i })).toBeNull();
});
