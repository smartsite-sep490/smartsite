// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type SafetyAlertDetailResponse,
  type SafetyEpisode,
} from '@smartsite/api-client';
import { EpisodeEvidence } from './EpisodeEvidence';
import i18n from '../../i18n';

const evidencePanelSpy = vi.hoisted(() => vi.fn());
vi.mock('../alerts/SafetyAlertEvidencePanel', () => ({
  SafetyAlertEvidencePanel: (props: unknown) => {
    evidencePanelSpy(props);
    return <div>Authorized evidence</div>;
  },
}));

const siteId = '11111111-1111-4111-8111-111111111111';
const eventId = '44444444-4444-4444-8444-444444444444';

function makeEpisode(overrides?: Partial<SafetyEpisode>): SafetyEpisode {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    siteId,
    cameraId: '33333333-3333-4333-8333-333333333333',
    subject: {
      kind: 'EVENT_LOCAL',
      eventId,
      personObservationIndex: 0,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-10-31T10:00:00Z',
    lastObservedAt: '2026-10-31T10:00:00Z',
    contentRevision: 7,
    collectionState: 'COLLECTING',
    findingCount: 2,
    identityDecision: null,
    findings: [
      {
        alertId: 'hat-alert',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'PENDING_REVIEW',
        alertRevision: 0,
        zoneId: null,
        evidenceRefs: [
          {
            eventId,
            personObservationIndex: 0,
            evidenceIndex: 1,
            sha256: 'a'.repeat(64),
            available: true,
          },
        ],
      },
      {
        alertId: 'vest-alert',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'CONFIRMED',
        alertRevision: 1,
        zoneId: null,
        evidenceRefs: [],
      },
    ],
    workflowLinks: [],
    ...overrides,
  };
}

function makeAlertDetail(
  overrides?: Partial<SafetyAlertDetailResponse>,
): SafetyAlertDetailResponse {
  return {
    id: 'hat-alert',
    siteId,
    zoneId: null,
    candidateWorkerId: null,
    alertType: 'PPE_VIOLATION',
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    status: 'PENDING_REVIEW',
    firstDetectedAt: '2026-10-31T10:00:00Z',
    lastDetectedAt: '2026-10-31T10:00:00Z',
    detectionCount: 1,
    revision: 0,
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-10-31T10:00:00Z',
    detectionsTotal: 1,
    detections: [],
    reviewsTotal: 0,
    reviews: [],
    ...overrides,
  };
}

describe('EpisodeEvidence presentation and selection semantics', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('vi');
  });

  afterEach(() => {
    cleanup();
  });

  function renderEvidence(
    episode = makeEpisode(),
    client = new SmartSiteManagementClient('http://api.test'),
  ) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return {
      client,
      queryClient,
      ...render(
        <QueryClientProvider client={queryClient}>
          <EpisodeEvidence
            episode={episode}
            client={client}
            token="synthetic-session-token"
            scope="scope-nonce-1"
            apiUrl="http://api.test"
          />
        </QueryClientProvider>,
      ),
    };
  }

  it('renders a labeled finding selector group without auto-selecting or auto-fetching evidence', () => {
    const client = new SmartSiteManagementClient('http://api.test');
    const getSafetyAlertSpy = vi.spyOn(client, 'getSafetyAlert');

    renderEvidence(makeEpisode(), client);

    const group = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    const [first, second] = buttons;
    if (!first || !second) throw new Error('Expected both finding controls');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(first.getAttribute('data-state')).toBe('unselected');
    expect(first.getAttribute('title')).toBe('Dấu hiệu thiếu mũ bảo hộ');
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();
    expect(getSafetyAlertSpy).not.toHaveBeenCalled();
  });

  it('updates selected choice state on click and filters evidence strictly by event and personObservationIndex', async () => {
    const client = new SmartSiteManagementClient('http://api.test');
    const getSafetyAlertSpy = vi.spyOn(client, 'getSafetyAlert').mockResolvedValue(
      makeAlertDetail({
        id: 'hat-alert',
        detectionsTotal: 2,
        detections: [
          {
            eventId: 'other-event',
            cameraExternalId: 'CAM-01',
            capturedAt: '2026-10-31T10:00:00Z',
            processingStatus: 'PROCESSED',
            evidence: [{ index: 1, kind: 'CROP', available: true }],
          },
          {
            eventId,
            cameraExternalId: 'CAM-01',
            capturedAt: '2026-10-31T10:00:00Z',
            processingStatus: 'PROCESSED',
            evidence: [
              { index: 0, kind: 'FRAME', available: true },
              { index: 1, kind: 'CROP', available: true },
            ],
          },
        ],
      }),
    );

    renderEvidence(makeEpisode(), client);

    const hatButton = screen.getByRole('button', { name: 'Dấu hiệu thiếu mũ bảo hộ' });
    const vestButton = screen.getByRole('button', { name: 'Dấu hiệu thiếu áo phản quang' });

    fireEvent.click(hatButton);

    expect(hatButton.getAttribute('aria-pressed')).toBe('true');
    expect(hatButton.getAttribute('data-state')).toBe('selected');
    expect(vestButton.getAttribute('aria-pressed')).toBe('false');
    expect(vestButton.getAttribute('data-state')).toBe('unselected');

    await screen.findByText('Authorized evidence');
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
    const panelProps = evidencePanelSpy.mock.calls.at(-1)?.[0] as {
      alertId: string;
      detection: { eventId: string; evidence: { index: number }[] };
    };
    expect(panelProps.alertId).toBe('hat-alert');
    expect(panelProps.detection.eventId).toBe(eventId);
    expect(panelProps.detection.evidence.map((item) => item.index)).toEqual([1]);
  });

  it('preserves readable English labels and unavailable status feedback when switching languages', async () => {
    await i18n.changeLanguage('en');
    const client = new SmartSiteManagementClient('http://api.test');
    vi.spyOn(client, 'getSafetyAlert').mockResolvedValue(
      makeAlertDetail({
        id: 'vest-alert',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'CONFIRMED',
        detectionsTotal: 0,
        detections: [],
      }),
    );

    renderEvidence(makeEpisode(), client);

    const group = screen.getByRole('group', { name: 'Saved evidence' });
    const vestButton = within(group).getByRole('button', {
      name: 'Possible missing safety vest',
    });
    expect(vestButton.getAttribute('title')).toBe('Possible missing safety vest');

    fireEvent.click(vestButton);
    const status = await screen.findByText(
      'No authorized evidence is available for this observation.',
    );
    expect(status.textContent).toBe('No authorized evidence is available for this observation.');
    expect(evidencePanelSpy).not.toHaveBeenCalled();
  });
});
