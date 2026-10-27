// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type SafetyAlertDetailResponse,
  type SafetyAlertResponse,
  type SafetyObservationFindingsResponse,
} from '@smartsite/api-client';
import i18n from '../../i18n';
import { SafetyAlertsView } from './SafetyAlertsView';
import { SafetyObservationFindings } from './SafetyObservationFindings';
let queries: QueryClient;
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queries?.clear();
  vi.restoreAllMocks();
});
const result: SafetyObservationFindingsResponse = {
  subject: { kind: 'EVENT_LOCAL', eventId: 'event', personObservationIndex: 4 },
  total: 2,
  items: [
    {
      id: 'alert',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      status: 'PENDING_REVIEW',
      revision: 1,
      zoneId: null,
    },
    {
      id: 'vest',
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
      status: 'DISMISSED',
      revision: 2,
      zoneId: null,
    },
  ],
};
async function mount() {
  await i18n.changeLanguage('en');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelectAlert = vi.fn();
  const client = new SmartSiteManagementClient('https://api.example.test');
  render(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api.example.test"
        sessionScope="synthetic-scope"
        token="synthetic"
        siteId="site"
        alertId="alert"
        eventId="event"
        onSelectAlert={onSelectAlert}
      />
    </QueryClientProvider>,
  );
  return onSelectAlert;
}
it('loads only on expansion and opens individual findings without merging their review state', async () => {
  const load = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings')
    .mockResolvedValue(result);
  const select = await mount();
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  const open = await screen.findAllByRole('button', { name: 'Open alert' });
  expect(open).toHaveLength(1);
  fireEvent.click(open[0]!);
  expect(select).toHaveBeenCalledWith('vest');
  expect(load).toHaveBeenCalledWith(
    'synthetic',
    'site',
    'alert',
    'event',
    { offset: 0, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it('hides cached findings after access failure and shows unresolved provenance honestly', async () => {
  const load = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings')
    .mockResolvedValue(result);
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  await screen.findByRole('button', { name: 'Open alert' });
  load.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  await queries.invalidateQueries({ queryKey: ['safety-observation-findings'] });
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Open alert' })).toBeNull();
  load.mockResolvedValue({ subject: null, items: [], total: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByText('Person association is unavailable for this image.')).toBeTruthy(),
  );
});
it('separates multiple subjects sharing a frame and collapses prior findings when switching alerts', async () => {
  await i18n.changeLanguage('en');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const person1Findings: SafetyObservationFindingsResponse = {
    subject: { kind: 'EVENT_LOCAL', eventId: 'event-shared', personObservationIndex: 0 },
    total: 2,
    items: [
      {
        id: 'alert-p1-hat',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'PENDING_REVIEW',
        revision: 1,
        zoneId: null,
      },
      {
        id: 'alert-p1-vest',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'NEEDS_MORE_EVIDENCE',
        revision: 2,
        zoneId: 'zone-excavation',
      },
    ],
  };
  const person2Findings: SafetyObservationFindingsResponse = {
    subject: { kind: 'EVENT_LOCAL', eventId: 'event-shared', personObservationIndex: 1 },
    total: 1,
    items: [
      {
        id: 'alert-p2-zone',
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        candidateSubtype: 'RESTRICTED_ZONE_INTRUSION',
        status: 'PENDING_REVIEW',
        revision: 1,
        zoneId: 'zone-crane',
      },
    ],
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings').mockImplementation(
    async (_token, _siteId, alertId) =>
      alertId === 'alert-p2-zone' ? person2Findings : person1Findings,
  );
  const client = new SmartSiteManagementClient('https://api.example.test');
  const onSelectAlert = vi.fn();
  const view = render(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api.example.test"
        sessionScope="synthetic-scope"
        token="synthetic"
        siteId="site"
        alertId="alert-p1-hat"
        eventId="event-shared"
        onSelectAlert={onSelectAlert}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  expect(await screen.findByText('Person #1 in this image')).toBeTruthy();
  expect(screen.getByText('This image only')).toBeTruthy();
  expect(screen.getByText('1–2 of 2')).toBeTruthy();
  expect(screen.getByText('Missing Hard Hat')).toBeTruthy();
  expect(screen.getByText('Missing Safety Vest')).toBeTruthy();

  // Scope explanation and technical provenance/IDs live behind a single collapsed TechnicalDetails disclosure
  const summaries = screen.getAllByText('Technical details');
  expect(summaries).toHaveLength(1);
  const detailsEl = summaries[0]!.closest('details') as HTMLDetailsElement;
  expect(detailsEl).toBeTruthy();
  expect(detailsEl.open).toBe(false);
  expect(detailsEl.textContent).toContain(
    'Same person in this image only. Review each alert separately; it may include other frames.',
  );
  expect(
    screen.getByText('Subject EVENT_LOCAL · Event event-shared · Person index #0'),
  ).toBeTruthy();
  expect(screen.getByText('Alert alert-p1-hat · Revision 1')).toBeTruthy();
  expect(screen.getByText('Alert alert-p1-vest · Revision 2')).toBeTruthy();

  // User expands technical details for Person #1
  fireEvent.click(summaries[0]!);
  expect(detailsEl.open).toBe(true);

  // Switching to the second subject in the same frame immediately resets prior findings and open detail state
  view.rerender(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api.example.test"
        sessionScope="synthetic-scope"
        token="synthetic"
        siteId="site"
        alertId="alert-p2-zone"
        eventId="event-shared"
        onSelectAlert={onSelectAlert}
      />
    </QueryClientProvider>,
  );

  expect(screen.queryByText('Person #1 in this image')).toBeNull();
  expect(screen.queryByText('Missing Safety Vest')).toBeNull();
  expect(screen.queryByText('Alert alert-p1-vest · Revision 2')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Findings for this person' }).getAttribute('aria-expanded'),
  ).toBe('false');

  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  expect(await screen.findByText('Person #2 in this image')).toBeTruthy();
  expect(screen.getByText('This image only')).toBeTruthy();
  expect(screen.getByText('1–1 of 1')).toBeTruthy();
  expect(screen.getByText('Restricted Zone Intrusion')).toBeTruthy();
  expect(screen.queryByText('Missing Hard Hat')).toBeNull();
  const nextDetailsEl = screen
    .getByText('Technical details')
    .closest('details') as HTMLDetailsElement;
  expect(nextDetailsEl.open).toBe(false);
  expect(
    screen.getByText('Subject EVENT_LOCAL · Event event-shared · Person index #1'),
  ).toBeTruthy();

  // Changing apiUrl or rotating token resets expansion without leaking raw token into query keys
  const loadSpy = vi.mocked(SmartSiteManagementClient.prototype.listSafetyObservationFindings);
  loadSpy.mockClear();
  view.rerender(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api-rotated.example.test"
        sessionScope="synthetic-scope"
        token="synthetic"
        siteId="site"
        alertId="alert-p2-zone"
        eventId="event-shared"
        onSelectAlert={onSelectAlert}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Findings for this person' }).getAttribute('aria-expanded'),
  ).toBe('false');
  expect(screen.queryByText('Person #2 in this image')).toBeNull();
  expect(loadSpy).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  expect(await screen.findByText('Person #2 in this image')).toBeTruthy();
  loadSpy.mockClear();

  view.rerender(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api-rotated.example.test"
        sessionScope="synthetic-scope"
        token="rotated-secret-token"
        siteId="site"
        alertId="alert-p2-zone"
        eventId="event-shared"
        onSelectAlert={onSelectAlert}
      />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Findings for this person' }).getAttribute('aria-expanded'),
  ).toBe('false');
  expect(screen.queryByText('Person #2 in this image')).toBeNull();
  expect(loadSpy).not.toHaveBeenCalled();
  const serializedKeys = JSON.stringify(
    queries
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey),
  );
  expect(serializedKeys).not.toContain('synthetic"');
  expect(serializedKeys).not.toContain('rotated-secret-token');
});
function setupAlertsWorkspaceMocks(includeSecondSite = false) {
  vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
  const alphaSite = {
    id: 'site-alpha',
    code: 'SITE-A',
    name: 'Công trường Alpha',
    createdAt: '2026-10-01T00:00:00Z',
  };
  const betaSite = {
    id: 'site-beta',
    code: 'SITE-B',
    name: 'Công trường Beta',
    createdAt: '2026-10-01T00:00:00Z',
  };
  const sites = includeSecondSite ? [alphaSite, betaSite] : [alphaSite];
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: sites,
    total: sites.length,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getObservationIdentityContext').mockResolvedValue({
    eventId: 'event-shared',
    payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    eventConsistent: true,
    frames: [],
    subjects: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listObservationIdentityWorkers').mockResolvedValue(
    { items: [], total: 0 },
  );
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'listObservationIdentityDecisions',
  ).mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getAlertWorkContext').mockResolvedValue({
    capturedAt: '2026-10-01T08:00:00Z',
    identity: 'UNKNOWN',
    zoneName: 'Excavation North',
    cameraName: 'CAM-GATE-02',
    workers: [],
    relatedTeams: [],
    warning: '',
  });
  const evidenceSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlertEvidence');
  const alertP1Hat: SafetyAlertResponse = {
    id: 'alert-p1-hat',
    siteId: 'site-alpha',
    zoneId: 'zone-excavation',
    candidateWorkerId: null,
    alertType: 'PPE_VIOLATION',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    status: 'PENDING_REVIEW',
    firstDetectedAt: '2026-10-01T08:00:00Z',
    lastDetectedAt: '2026-10-01T08:00:00Z',
    detectionCount: 1,
    revision: 1,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  };
  const alertP1Vest: SafetyAlertResponse = {
    ...alertP1Hat,
    id: 'alert-p1-vest',
    candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
    revision: 2,
  };
  const alertP2Zone: SafetyAlertResponse = {
    ...alertP1Hat,
    id: 'alert-p2-zone',
    zoneId: 'zone-crane',
    alertType: 'RESTRICTED_ZONE_INTRUSION',
    candidateSubtype: 'RESTRICTED_ZONE_INTRUSION',
    status: 'CONFIRMED',
    incidentId: 'incident-linked-1',
  };
  const listAlertsSpy = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listSafetyAlerts')
    .mockResolvedValue({
      items: [alertP1Hat, alertP2Zone],
      total: 2,
    });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSafetyAlert').mockImplementation(
    async (_token, _siteId, id): Promise<SafetyAlertDetailResponse> => ({
      ...(id === 'alert-p2-zone' ? alertP2Zone : id === 'alert-p1-vest' ? alertP1Vest : alertP1Hat),
      detectionsTotal: 1,
      detections: [
        {
          eventId: 'event-shared',
          cameraExternalId: 'CAM-GATE-02',
          capturedAt: '2026-10-01T08:00:00Z',
          processingStatus: 'PROCESSED',
          evidence: [{ index: 0, kind: 'FRAME', available: true }],
        },
      ],
      reviewsTotal: 0,
      reviews: [],
    }),
  );
  return { listAlertsSpy, evidenceSpy };
}
it('keeps list filter and selection state distinct, clears prior person findings/draft on switch, and supports closing the detail inspector', async () => {
  await i18n.changeLanguage('en');
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const { listAlertsSpy } = setupAlertsWorkspaceMocks();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings').mockImplementation(
    async (_token, _siteId, id) =>
      id === 'alert-p2-zone'
        ? {
            subject: { kind: 'EVENT_LOCAL', eventId: 'event-shared', personObservationIndex: 1 },
            total: 1,
            items: [
              {
                id: 'alert-p2-zone',
                alertType: 'RESTRICTED_ZONE_INTRUSION',
                candidateSubtype: 'RESTRICTED_ZONE_INTRUSION',
                status: 'CONFIRMED',
                revision: 1,
                zoneId: 'zone-crane',
              },
            ],
          }
        : {
            subject: { kind: 'EVENT_LOCAL', eventId: 'event-shared', personObservationIndex: 0 },
            total: 2,
            items: [
              {
                id: 'alert-p1-hat',
                alertType: 'PPE_VIOLATION',
                candidateSubtype: 'PPE_HARD_HAT_MISSING',
                status: 'PENDING_REVIEW',
                revision: 1,
                zoneId: 'zone-excavation',
              },
              {
                id: 'alert-p1-vest',
                alertType: 'PPE_VIOLATION',
                candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
                status: 'PENDING_REVIEW',
                revision: 1,
                zoneId: 'zone-excavation',
              },
            ],
          },
  );

  render(
    <QueryClientProvider client={queries}>
      <SafetyAlertsView
        apiUrl="https://api.example.test"
        initialSiteId="site-alpha"
        initialAlertId="alert-p1-hat"
        authenticatedSession={{
          accessToken: 'so-token',
          user: {
            id: 'user-so-1',
            username: 'safety.officer',
            displayName: 'Safety Officer Alpha',
            roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
            isActive: true,
            mustChangePassword: false,
          },
        }}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('CAM-GATE-02')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  expect(await screen.findByText('Person #1 in this image')).toBeTruthy();

  const reasonInput = screen.getByRole('textbox', {
    name: /Decision reason/i,
  }) as HTMLTextAreaElement;
  fireEvent.change(reasonInput, { target: { value: 'Person 1 missing hard hat in frame' } });
  expect(reasonInput.value).toBe('Person 1 missing hard hat in frame');

  // Changing list status filter updates list query without clearing pinned selection or review draft
  const listStatusSelect = screen
    .getByRole('option', { name: 'All statuses' })
    .closest('select') as HTMLSelectElement;
  fireEvent.change(listStatusSelect, { target: { value: 'PENDING_REVIEW' } });
  await waitFor(() =>
    expect(listAlertsSpy).toHaveBeenCalledWith(
      'so-token',
      'site-alpha',
      expect.objectContaining({ status: 'PENDING_REVIEW', offset: 0 }),
      expect.any(Object),
    ),
  );
  expect(reasonInput.value).toBe('Person 1 missing hard hat in frame');

  // Opening a sibling finding for the same person resets the prior alert's review draft while keeping list filter
  fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
  expect(await screen.findByText('Alert alert-p1-vest · Revision 2')).toBeTruthy();
  expect(
    (screen.getByRole('textbox', { name: /Decision reason/i }) as HTMLTextAreaElement).value,
  ).toBe('');
  expect(listStatusSelect.value).toBe('PENDING_REVIEW');

  // Selecting the second subject's alert clears prior person findings/draft and shows linked incident action
  fireEvent.click(screen.getByRole('button', { name: /Restricted Zone Intrusion/i }));
  expect(await screen.findByText('Linked to a safety incident record.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Open linked incident' })).toBeTruthy();
  expect(screen.queryByText('Person #1 in this image')).toBeNull();
  expect(screen.queryByRole('textbox', { name: /Decision reason/i })).toBeNull();

  // Closing the detail inspector hides the complementary panel and restores focus to the selected queue row
  const zoneAlertRowButton = screen.getByRole('button', { name: /Restricted Zone Intrusion/i });
  fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
  expect(screen.queryByRole('complementary', { name: 'Alert detail' })).toBeNull();
  expect(document.activeElement).toBe(zoneAlertRowButton);

  fireEvent.click(screen.getByRole('button', { name: /Missing Hard Hat/i }));
  expect(await screen.findByRole('complementary', { name: 'Alert detail' })).toBeTruthy();
});
it('retains rows and retries same offset on transient next-page error, uses latest successful page total while preserving first-page subject, and revokes cached rows on hard 404 from next-page or refetch', async () => {
  const firstPageResult: SafetyObservationFindingsResponse = {
    subject: { kind: 'EVENT_LOCAL', eventId: 'event', personObservationIndex: 4 },
    total: 21,
    items: Array.from({ length: 20 }, (_, index) => ({
      id: index === 0 ? 'alert' : `finding-${index + 1}`,
      alertType: 'PPE_VIOLATION',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      status: 'PENDING_REVIEW',
      revision: 1,
      zoneId: null,
    })),
  };
  const secondPageResult: SafetyObservationFindingsResponse = {
    subject: null,
    total: 25,
    items: [
      {
        id: 'finding-21',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'PENDING_REVIEW',
        revision: 1,
        zoneId: null,
      },
      {
        id: 'finding-22',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_GLOVES_MISSING',
        status: 'CONFIRMED',
        revision: 2,
        zoneId: 'zone-1',
      },
    ],
  };

  const load = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings')
    .mockResolvedValueOnce(firstPageResult)
    .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
    .mockResolvedValueOnce(secondPageResult)
    .mockRejectedValueOnce(new ApiError('http', 'Not Found', 404))
    .mockResolvedValueOnce(firstPageResult)
    .mockResolvedValueOnce({
      subject: null,
      total: 18,
      items: [secondPageResult.items[0]!],
    })
    .mockRejectedValueOnce(new ApiError('http', 'Not Found', 404));

  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Findings for this person' }));
  expect(await screen.findByText('Person #5 in this image')).toBeTruthy();
  expect(screen.getByText('1–20 of 21')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open alert' })).toHaveLength(19);

  // 1. Transient 503 on next-page (offset 20) retains page-1 rows and retries exact same offset
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.getByText('1–20 of 21')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open alert' })).toHaveLength(19);
  expect(load).toHaveBeenLastCalledWith(
    'synthetic',
    'site',
    'alert',
    'event',
    { offset: 20, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );

  // 2. Retrying succeeds at offset 20: counter updates to latest page total (25) while preserving first-page subject
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('1–22 of 25')).toBeTruthy();
  expect(load).toHaveBeenLastCalledWith(
    'synthetic',
    'site',
    'alert',
    'event',
    { offset: 20, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByText('Person #5 in this image')).toBeTruthy();
  expect(screen.getByText('Subject EVENT_LOCAL · Event event · Person index #4')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Open alert' })).toHaveLength(21);

  // 3. Hard 404 on next-page (offset 22) revokes all cached rows immediately
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Open alert' })).toBeNull();
  expect(screen.queryByText('1–22 of 25')).toBeNull();
  expect(screen.queryByText('Person #5 in this image')).toBeNull();

  // 4. Retry refetches pages: when loaded rows (21) exceed latest server total (18), shows loaded and latest total separately without clamping
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('21 loaded · Latest server total: 18')).toBeTruthy();
  expect(screen.queryByText('1–21 of 18')).toBeNull();
  expect(screen.queryByText('1–21 of 21')).toBeNull();

  // 5. Hard 404 on refetch also revokes cached rows
  await queries.invalidateQueries({ queryKey: ['safety-observation-findings'] });
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Open alert' })).toBeNull();
  expect(screen.queryByText('21 loaded · Latest server total: 18')).toBeNull();
});
it('provides an optional Alerts guide tied to visible queue/case/review/followup controls, skips absent or unauthorized steps, and resets on Site or credential change', async () => {
  window.localStorage.clear();
  await i18n.changeLanguage('en');
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const { evidenceSpy } = setupAlertsWorkspaceMocks(true);

  const view = render(
    <QueryClientProvider client={queries}>
      <SafetyAlertsView
        apiUrl="https://api.example.test"
        initialSiteId="site-alpha"
        initialAlertId="alert-p1-hat"
        authenticatedSession={{
          accessToken: 'so-token',
          user: {
            id: 'user-so-1',
            username: 'safety.officer',
            displayName: 'Safety Officer Alpha',
            roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
            isActive: true,
            mustChangePassword: false,
          },
        }}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('CAM-GATE-02')).toBeTruthy();
  const reasonInput = screen.getByRole('textbox', {
    name: /Decision reason/i,
  }) as HTMLTextAreaElement;
  fireEvent.change(reasonInput, { target: { value: 'Draft kept safe during guide' } });

  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-queue-filter',
  );
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-case-summary',
  );
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-action-bar',
  );
  expect(screen.getByText(/never modifies your draft or submits a decision/i)).toBeTruthy();
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-followup',
  );
  expect(screen.getByText(/work context recorded at event time/i)).toBeTruthy();
  expect(reasonInput.value).toBe('Draft kept safe during guide');
  expect(evidenceSpy).not.toHaveBeenCalled();

  // Closing the detail panel dynamically skips case/review/followup steps without auto-selecting an alert
  fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
  await waitFor(() => expect(screen.getByText('Step 1 of 1')).toBeTruthy());
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-queue-filter',
  );

  // Rotating session to Global Admin closes the open tour and omits the Safety Officer review-decision step (3 steps)
  view.rerender(
    <QueryClientProvider client={queries}>
      <SafetyAlertsView
        apiUrl="https://api.example.test"
        initialSiteId="site-alpha"
        initialAlertId="alert-p1-hat"
        authenticatedSession={{
          accessToken: 'admin-token',
          user: {
            id: 'user-admin-1',
            username: 'admin',
            displayName: 'System Admin',
            roleAssignments: [{ role: 'ADMIN', siteId: null }],
            isActive: true,
            mustChangePassword: false,
          },
        }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('CAM-GATE-02')).toBeTruthy();
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();

  fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
  expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  fireEvent.click(screen.getByTestId('safety-task-tour-next'));
  expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
    'alerts-followup',
  );

  // Switching Site resets/closes the open tour immediately
  const siteSelect = screen
    .getByRole('option', { name: 'SITE-A · Công trường Alpha' })
    .closest('select') as HTMLSelectElement;
  fireEvent.change(siteSelect, { target: { value: 'site-beta' } });
  expect(screen.queryByTestId('safety-task-tour')).toBeNull();
});
it('renders concise Vietnamese event-local hierarchy with wrapping labels and keeps technical provenance collapsed by default', async () => {
  await i18n.changeLanguage('vi');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSafetyObservationFindings').mockResolvedValue({
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: 'evt-very-long-technical-identifier-20261025-segment-0099',
      personObservationIndex: 0,
    },
    total: 2,
    items: [
      {
        id: 'alert-long-technical-identifier-primary-0001',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'PENDING_REVIEW',
        revision: 3,
        zoneId: 'khu-vuc-thi-cong-도-sau-phia-bac-block-c-tang-ham-02',
      },
      {
        id: 'alert-long-technical-identifier-sibling-0002',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'NEEDS_MORE_EVIDENCE',
        revision: 4,
        zoneId: null,
      },
    ],
  });
  const client = new SmartSiteManagementClient('https://api.example.test');
  render(
    <QueryClientProvider client={queries}>
      <SafetyObservationFindings
        client={client}
        apiUrl="https://api.example.test"
        sessionScope="synthetic-scope"
        token="synthetic"
        siteId="site"
        alertId="alert-long-technical-identifier-primary-0001"
        eventId="evt-very-long-technical-identifier-20261025-segment-0099"
        onSelectAlert={vi.fn()}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Các phát hiện của người này' }));
  expect(await screen.findByText('Người #1 trong ảnh này')).toBeTruthy();
  expect(screen.getByText('Chỉ ảnh này')).toBeTruthy();
  expect(screen.getByText('Cảnh báo đang xem')).toBeTruthy();
  const currentRow = screen.getByText('Cảnh báo đang xem').closest('li');
  expect(currentRow?.getAttribute('aria-current')).toBe('true');

  const openSiblingBtn = screen.getByRole('button', { name: 'Mở cảnh báo' });
  expect(openSiblingBtn).toBeTruthy();
  const siblingRow = openSiblingBtn.closest('li');
  expect(siblingRow?.getAttribute('aria-current')).toBeNull();
  const describedById = openSiblingBtn.getAttribute('aria-describedby');
  expect(describedById).toBeTruthy();
  expect(document.getElementById(describedById!)?.textContent).toBe('Thiếu áo phản quang');

  const detailsList = document.querySelectorAll('details');
  expect(detailsList).toHaveLength(1);
  expect(detailsList[0]?.open).toBe(false);
  expect(detailsList[0]?.textContent).toContain(
    'Chủ thể EVENT_LOCAL · Sự kiện evt-very-long-technical-identifier-20261025-segment-0099 · Chỉ mục người #0',
  );
});
