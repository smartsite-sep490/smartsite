// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type SafetyAlertDetailResponse,
  type SafetyEpisode,
} from '@smartsite/api-client';
import { EpisodeEvidence } from './EpisodeEvidence';
import i18n from '../../i18n';

interface EvidencePanelCapturedProps {
  client: SmartSiteManagementClient;
  apiUrl: string;
  sessionScope: string;
  token: string;
  siteId: string;
  alertId: string;
  detection: {
    eventId: string;
    evidence: { index: number; kind: string; available: boolean }[];
  };
}

const evidencePanelSpy = vi.hoisted(() => vi.fn<(props: EvidencePanelCapturedProps) => void>());

vi.mock('../alerts/SafetyAlertEvidencePanel', () => ({
  SafetyAlertEvidencePanel: (props: EvidencePanelCapturedProps) => {
    evidencePanelSpy(props);
    return (
      <div data-testid="mock-evidence-panel">
        Authorized evidence:{props.alertId}:{props.detection.eventId}
      </div>
    );
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const siteId = '11111111-1111-4111-8111-111111111111';
const eventIdA = '44444444-4444-4444-8444-444444444444';
const eventIdB = '55555555-5555-4555-8555-555555555555';

function makeEpisode(overrides?: Partial<SafetyEpisode>): SafetyEpisode {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    siteId,
    cameraId: '33333333-3333-4333-8333-333333333333',
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: eventIdA,
      personObservationIndex: 0,
    },
    configurationBundleId: null,
    firstObservedAt: '2026-10-31T10:00:00Z',
    lastObservedAt: '2026-10-31T10:00:00Z',
    contentRevision: 7,
    collectionState: 'COLLECTING',
    findingCount: 1,
    identityDecision: null,
    findings: [
      {
        alertId: 'alert-a-hat',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'PENDING_REVIEW',
        alertRevision: 0,
        zoneId: null,
        evidenceRefs: [
          {
            eventId: eventIdA,
            personObservationIndex: 0,
            evidenceIndex: 1,
            sha256: 'a'.repeat(64),
            available: true,
          },
        ],
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
    id: 'alert-a-hat',
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

describe('EpisodeEvidence selection and session scope isolation', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('vi');
  });

  afterEach(() => {
    cleanup();
  });

  it('isolates a pending request for episode A when rerendered with episode B, ignores late A resolution, and renders authorized evidence on legitimate B selection', async () => {
    const client = new SmartSiteManagementClient('http://api.test');
    const deferredA = createDeferred<SafetyAlertDetailResponse>();
    const deferredB = createDeferred<SafetyAlertDetailResponse>();

    const getSafetyAlertSpy = vi
      .spyOn(client, 'getSafetyAlert')
      .mockImplementation((_token, _site, alertId) => {
        if (alertId === 'alert-a-hat') return deferredA.promise;
        if (alertId === 'alert-b-vest') return deferredB.promise;
        throw new Error(`Unexpected alertId: ${alertId}`);
      });

    const episodeA = makeEpisode({
      id: 'episode-a',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: eventIdA,
        personObservationIndex: 0,
      },
      findings: [
        {
          alertId: 'alert-a-hat',
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          status: 'PENDING_REVIEW',
          alertRevision: 0,
          zoneId: null,
          evidenceRefs: [
            {
              eventId: eventIdA,
              personObservationIndex: 0,
              evidenceIndex: 1,
              sha256: 'a'.repeat(64),
              available: true,
            },
          ],
        },
      ],
    });

    const episodeB = makeEpisode({
      id: 'episode-b',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: eventIdB,
        personObservationIndex: 1,
      },
      findings: [
        {
          alertId: 'alert-b-vest',
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          status: 'CONFIRMED',
          alertRevision: 2,
          zoneId: null,
          evidenceRefs: [
            {
              eventId: eventIdB,
              personObservationIndex: 1,
              evidenceIndex: 2,
              sha256: 'b'.repeat(64),
              available: true,
            },
          ],
        },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episodeA}
          client={client}
          token="token-scope-1"
          scope="scope-1"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dấu hiệu thiếu mũ bảo hộ' }));
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Đang tải hồ sơ…');

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episodeB}
          client={client}
          token="token-scope-1"
          scope="scope-1"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const vestButtonB = screen.getByRole('button', { name: 'Dấu hiệu thiếu áo phản quang' });
    expect(vestButtonB.getAttribute('aria-pressed')).toBe('false');
    expect(vestButtonB.getAttribute('data-state')).toBe('unselected');
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();

    await act(async () => {
      deferredA.resolve(
        makeAlertDetail({
          id: 'alert-a-hat',
          detections: [
            {
              eventId: eventIdA,
              cameraExternalId: 'CAM-01',
              capturedAt: '2026-10-31T10:00:00Z',
              processingStatus: 'PROCESSED',
              evidence: [{ index: 1, kind: 'CROP', available: true }],
            },
          ],
        }),
      );
    });

    expect(evidencePanelSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(vestButtonB);
    expect(vestButtonB.getAttribute('aria-pressed')).toBe('true');
    expect(vestButtonB.getAttribute('data-state')).toBe('selected');
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      deferredB.resolve(
        makeAlertDetail({
          id: 'alert-b-vest',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          status: 'CONFIRMED',
          detectionsTotal: 2,
          detections: [
            {
              eventId: eventIdA,
              cameraExternalId: 'CAM-01',
              capturedAt: '2026-10-31T10:00:00Z',
              processingStatus: 'PROCESSED',
              evidence: [{ index: 1, kind: 'CROP', available: true }],
            },
            {
              eventId: eventIdB,
              cameraExternalId: 'CAM-01',
              capturedAt: '2026-10-31T10:01:00Z',
              processingStatus: 'PROCESSED',
              evidence: [
                { index: 0, kind: 'FRAME', available: true },
                { index: 2, kind: 'CROP', available: true },
              ],
            },
          ],
        }),
      );
    });

    expect(await screen.findByTestId('mock-evidence-panel')).toBeTruthy();
    expect(evidencePanelSpy).toHaveBeenCalledTimes(1);
    const passedProps = evidencePanelSpy.mock.calls.at(-1)?.[0];
    expect(passedProps?.alertId).toBe('alert-b-vest');
    expect(passedProps?.detection.eventId).toBe(eventIdB);
    expect(passedProps?.detection.evidence.map((item) => item.index)).toEqual([2]);
  });

  it('clears finding selection and blocks late evidence when rerendered with a different session scope or shared alertId across episodes', async () => {
    const client = new SmartSiteManagementClient('http://api.test');
    const deferredScopeA = createDeferred<SafetyAlertDetailResponse>();
    const deferredScopeB = createDeferred<SafetyAlertDetailResponse>();

    const getSafetyAlertSpy = vi.spyOn(client, 'getSafetyAlert').mockImplementation((token) => {
      if (token === 'token-scope-a') return deferredScopeA.promise;
      if (token === 'token-scope-b') return deferredScopeB.promise;
      throw new Error(`Unexpected token: ${token}`);
    });

    const episode = makeEpisode();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episode}
          client={client}
          token="token-scope-a"
          scope="scope-a"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const hatButton = screen.getByRole('button', { name: 'Dấu hiệu thiếu mũ bảo hộ' });
    fireEvent.click(hatButton);
    expect(hatButton.getAttribute('aria-pressed')).toBe('true');
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episode}
          client={client}
          token="token-scope-b"
          scope="scope-b"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const hatButtonAfterScopeChange = screen.getByRole('button', {
      name: 'Dấu hiệu thiếu mũ bảo hộ',
    });
    expect(hatButtonAfterScopeChange.getAttribute('aria-pressed')).toBe('false');
    expect(hatButtonAfterScopeChange.getAttribute('data-state')).toBe('unselected');
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();

    await act(async () => {
      deferredScopeA.resolve(
        makeAlertDetail({
          id: 'alert-a-hat',
          detections: [
            {
              eventId: eventIdA,
              cameraExternalId: 'CAM-01',
              capturedAt: '2026-10-31T10:00:00Z',
              processingStatus: 'PROCESSED',
              evidence: [{ index: 1, kind: 'CROP', available: true }],
            },
          ],
        }),
      );
    });

    expect(evidencePanelSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
  });

  it('never displays previous evidence when the current technical subject lacks a matching eventId or personObservationIndex reference', async () => {
    const client = new SmartSiteManagementClient('http://api.test');
    const sharedAlertDetail = makeAlertDetail({
      id: 'alert-a-hat',
      detections: [
        {
          eventId: eventIdA,
          cameraExternalId: 'CAM-01',
          capturedAt: '2026-10-31T10:00:00Z',
          processingStatus: 'PROCESSED',
          evidence: [
            { index: 0, kind: 'FRAME', available: true },
            { index: 1, kind: 'CROP', available: true },
          ],
        },
      ],
    });
    vi.spyOn(client, 'getSafetyAlert').mockResolvedValue(sharedAlertDetail);

    const episodeA = makeEpisode({
      id: 'episode-subject-0',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: eventIdA,
        personObservationIndex: 0,
      },
    });

    const episodeUnmatchedSubject = makeEpisode({
      id: 'episode-subject-2',
      subject: {
        kind: 'EVENT_LOCAL',
        eventId: eventIdA,
        personObservationIndex: 2,
      },
      findings: [
        {
          alertId: 'alert-a-hat',
          alertType: 'PPE_VIOLATION',
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          status: 'PENDING_REVIEW',
          alertRevision: 0,
          zoneId: null,
          evidenceRefs: [
            {
              eventId: eventIdA,
              personObservationIndex: 0,
              evidenceIndex: 1,
              sha256: 'a'.repeat(64),
              available: true,
            },
          ],
        },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episodeA}
          client={client}
          token="token-scope-1"
          scope="scope-1"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const groupA = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    fireEvent.click(within(groupA).getByRole('button', { name: 'Dấu hiệu thiếu mũ bảo hộ' }));
    expect(await screen.findByTestId('mock-evidence-panel')).toBeTruthy();
    expect(evidencePanelSpy).toHaveBeenCalledTimes(1);

    evidencePanelSpy.mockClear();

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episodeUnmatchedSubject}
          client={client}
          token="token-scope-1"
          scope="scope-1"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
    expect(evidencePanelSpy).not.toHaveBeenCalled();

    const groupB = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    const buttonB = within(groupB).getByRole('button', { name: 'Dấu hiệu thiếu mũ bảo hộ' });
    expect(buttonB.getAttribute('aria-pressed')).toBe('false');
    expect(buttonB.getAttribute('data-state')).toBe('unselected');
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();

    fireEvent.click(buttonB);
    expect(buttonB.getAttribute('aria-pressed')).toBe('true');
    expect(buttonB.getAttribute('data-state')).toBe('selected');

    const unavailableStatus = await screen.findByText(
      'Chưa có bằng chứng được phép xem cho quan sát này.',
    );
    expect(unavailableStatus.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
    expect(evidencePanelSpy).not.toHaveBeenCalled();
  });

  it.each<{
    dimension: 'token' | 'apiUrl' | 'siteId' | 'episode.id' | 'subject.eventId';
    mutate: (base: { episode: SafetyEpisode; token: string; scope: string; apiUrl: string }) => {
      episode: SafetyEpisode;
      token: string;
      scope: string;
      apiUrl: string;
    };
  }>([
    {
      dimension: 'token',
      mutate: (base) => ({ ...base, token: 'raw-token-secret-rotated' }),
    },
    {
      dimension: 'apiUrl',
      mutate: (base) => ({ ...base, apiUrl: 'http://api-next.test' }),
    },
    {
      dimension: 'siteId',
      mutate: (base) => ({
        ...base,
        episode: makeEpisode({ siteId: '99999999-9999-4999-8999-999999999999' }),
      }),
    },
    {
      dimension: 'episode.id',
      mutate: (base) => ({
        ...base,
        episode: makeEpisode({ id: '88888888-8888-4888-8888-888888888888' }),
      }),
    },
    {
      dimension: 'subject.eventId',
      mutate: (base) => ({
        ...base,
        episode: makeEpisode({
          subject: {
            kind: 'EVENT_LOCAL',
            eventId: eventIdB,
            personObservationIndex: 0,
          },
        }),
      }),
    },
  ])(
    'synchronously clears selected evidence without an automatic getSafetyAlert request on same-instance $dimension change and keeps raw tokens out of DOM and query keys',
    async ({ mutate }) => {
      const initialToken = 'raw-token-secret-initial';
      const rotatedToken = 'raw-token-secret-rotated';
      const baseContext = {
        episode: makeEpisode(),
        token: initialToken,
        scope: 'scope-1',
        apiUrl: 'http://api.test',
      };
      const client = new SmartSiteManagementClient('http://api.test');
      const getSafetyAlertSpy = vi.spyOn(client, 'getSafetyAlert').mockResolvedValue(
        makeAlertDetail({
          id: 'alert-a-hat',
          detections: [
            {
              eventId: eventIdA,
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
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });

      const rendered = render(
        <QueryClientProvider client={queryClient}>
          <EpisodeEvidence {...baseContext} client={client} />
        </QueryClientProvider>,
      );

      const initialGroup = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
      const initialButton = within(initialGroup).getByRole('button', {
        name: 'Dấu hiệu thiếu mũ bảo hộ',
      });
      fireEvent.click(initialButton);

      expect(await screen.findByTestId('mock-evidence-panel')).toBeTruthy();
      expect(initialButton.getAttribute('aria-pressed')).toBe('true');
      expect(initialButton.getAttribute('data-state')).toBe('selected');
      expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);

      const assertNoRawTokenLeak = () => {
        expect(rendered.container.innerHTML).not.toContain(initialToken);
        expect(rendered.container.innerHTML).not.toContain(rotatedToken);
        const serializedQueryKeys = JSON.stringify(
          queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey),
        );
        expect(serializedQueryKeys).not.toContain(initialToken);
        expect(serializedQueryKeys).not.toContain(rotatedToken);
      };

      assertNoRawTokenLeak();
      evidencePanelSpy.mockClear();

      const nextContext = mutate(baseContext);
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <EpisodeEvidence {...nextContext} client={client} />
        </QueryClientProvider>,
      );

      const nextGroup = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
      const nextButton = within(nextGroup).getByRole('button', {
        name: 'Dấu hiệu thiếu mũ bảo hộ',
      });
      expect(nextButton.getAttribute('aria-pressed')).toBe('false');
      expect(nextButton.getAttribute('data-state')).toBe('unselected');
      expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
      expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();
      expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
      expect(evidencePanelSpy).not.toHaveBeenCalled();
      assertNoRawTokenLeak();
    },
  );

  it('does not resurrect settled scope-a selection or trigger an automatic request when rerendered from scope-a to scope-b and back to scope-a', async () => {
    const episode = makeEpisode();
    const client = new SmartSiteManagementClient('http://api.test');
    const getSafetyAlertSpy = vi.spyOn(client, 'getSafetyAlert').mockResolvedValue(
      makeAlertDetail({
        id: 'alert-a-hat',
        detections: [
          {
            eventId: eventIdA,
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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episode}
          client={client}
          token="token-scope-a"
          scope="scope-a"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const groupScopeA = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    const buttonScopeA = within(groupScopeA).getByRole('button', {
      name: 'Dấu hiệu thiếu mũ bảo hộ',
    });
    fireEvent.click(buttonScopeA);

    expect(await screen.findByTestId('mock-evidence-panel')).toBeTruthy();
    expect(buttonScopeA.getAttribute('aria-pressed')).toBe('true');
    expect(buttonScopeA.getAttribute('data-state')).toBe('selected');
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);

    evidencePanelSpy.mockClear();

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episode}
          client={client}
          token="token-scope-b"
          scope="scope-b"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const groupScopeB = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    const buttonScopeB = within(groupScopeB).getByRole('button', {
      name: 'Dấu hiệu thiếu mũ bảo hộ',
    });
    expect(buttonScopeB.getAttribute('aria-pressed')).toBe('false');
    expect(buttonScopeB.getAttribute('data-state')).toBe('unselected');
    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
    expect(evidencePanelSpy).not.toHaveBeenCalled();

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <EpisodeEvidence
          episode={episode}
          client={client}
          token="token-scope-a"
          scope="scope-a"
          apiUrl="http://api.test"
        />
      </QueryClientProvider>,
    );

    const groupReturnedScopeA = screen.getByRole('group', { name: 'Ảnh bằng chứng đã lưu' });
    const buttonReturnedScopeA = within(groupReturnedScopeA).getByRole('button', {
      name: 'Dấu hiệu thiếu mũ bảo hộ',
    });
    expect(buttonReturnedScopeA.getAttribute('aria-pressed')).toBe('false');
    expect(buttonReturnedScopeA.getAttribute('data-state')).toBe('unselected');
    expect(screen.queryByTestId('mock-evidence-panel')).toBeNull();
    expect(screen.getByText('Chọn phát hiện để tải bằng chứng đã lưu.')).toBeTruthy();
    expect(getSafetyAlertSpy).toHaveBeenCalledTimes(1);
    expect(evidencePanelSpy).not.toHaveBeenCalled();
  });
});
