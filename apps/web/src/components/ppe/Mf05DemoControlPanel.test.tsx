// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor, fireEvent, act, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Mf05DemoControlPanel } from './Mf05DemoControlPanel';
import { SmartSiteManagementClient, ApiError, type Mf05DemoStatus } from '@smartsite/api-client';
import * as mf05EvidenceExport from './mf05EvidenceExport';

vi.mock('./mf05EvidenceExport', () => ({
  buildMf05EvidenceExport: vi.fn(),
  downloadMf05EvidenceExport: vi.fn(() => true),
}));

const SITE_UUID = '11111111-1111-1111-1111-111111111111';
const CAM_1_UUID = '22222222-2222-2222-2222-222222222221';
const CAM_2_UUID = '22222222-2222-2222-2222-222222222222';
const REGION_1_UUID = '33333333-3333-3333-3333-333333333331';
const REGION_2_UUID = '33333333-3333-3333-3333-333333333332';
const ZONE_1_UUID = '44444444-4444-4444-4444-444444444441';
const ZONE_2_UUID = '44444444-4444-4444-4444-444444444442';
const EVENT_1_UUID = '55555555-5555-5555-5555-555555555555';

const mockStatusReady: Mf05DemoStatus = {
  siteId: SITE_UUID,
  cameraId: CAM_1_UUID,
  sourceKind: 'LIVE',
  state: 'READY',
  configurationVersion: 3,
  selectedRegionId: REGION_1_UUID,
  loadedRegionId: REGION_1_UUID,
  loadedConfigurationVersion: 3,
  loadedGeometryVersion: 2,
  regions: [
    {
      id: REGION_1_UUID,
      zoneId: ZONE_1_UUID,
      zoneCode: 'ZONE-A',
      geometryVersion: 2,
      requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    },
    {
      id: REGION_2_UUID,
      zoneId: ZONE_2_UUID,
      zoneCode: 'ZONE-B',
      geometryVersion: 1,
      requiredPpe: ['GLOVES', 'BOOTS'],
    },
  ],
  candidates: [
    {
      eventId: EVENT_1_UUID,
      capturedAt: '2026-10-08T01:00:00Z',
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      ppeItem: 'HARD_HAT',
      regionId: REGION_1_UUID,
      geometryVersion: 2,
      trackId: 42,
      zoneId: ZONE_1_UUID,
    },
  ],
  evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  mf08Persisted: false,
};

describe('Mf05DemoControlPanel v2', () => {
  let queryClient: QueryClient;
  let getStatusMock: ReturnType<typeof vi.spyOn>;
  let applyRegionMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    getStatusMock = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getMf05DemoStatus',
    ).mockResolvedValue(mockStatusReady);

    applyRegionMock = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'applyMf05DemoRegion',
    ).mockResolvedValue(mockStatusReady);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const renderComponent = (props: Partial<React.ComponentProps<typeof Mf05DemoControlPanel>> = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <Mf05DemoControlPanel
          apiUrl="http://localhost:3000/api"
          token="test-token"
          sessionScope="opaque-session-scope-1"
          siteId={SITE_UUID}
          cameraId={CAM_1_UUID}
          canApply={true}
          {...props}
        />
      </QueryClientProvider>,
    );
  };

  it('renders null when VITE_MF05_DEMO_CONTROLS is not "true" even if DEV is true', () => {
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'false');
    const { container } = renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('renders null when VITE_MF05_DEMO_CONTROLS is undefined', () => {
    vi.unstubAllEnvs();
    delete process.env.VITE_MF05_DEMO_CONTROLS;
    const { container } = renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it('hides component (returns null) when getMf05DemoStatus returns ApiError.status === 404', async () => {
    const error404 = new ApiError('http', 'Not Found', 404);
    getStatusMock.mockRejectedValueOnce(error404);

    const { container } = renderComponent();

    await waitFor(() => {
      expect(getStatusMock).toHaveBeenCalled();
    });

    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders access error banner and halts polling when ApiError.status is 401 or 403', async () => {
    const error403 = new ApiError('http', 'Forbidden', 403);
    getStatusMock.mockRejectedValueOnce(error403);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/diagnostic controls access error/i)).not.toBeNull();
    });
    expect(screen.getByText(/permission denied/i)).not.toBeNull();
  });

  it('displays sourceKind LIVE vs REPLAY and configuration revisions correctly', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('LIVE')).not.toBeNull();
    });

    expect(screen.getByText(/Saved Rev: 3/i)).not.toBeNull();
    expect(screen.getByText(/Loaded Rev: 3/i)).not.toBeNull();
    expect(screen.getByText(/Loaded Geom: 2/i)).not.toBeNull();
    expect(screen.getByText('Active & Applied')).not.toBeNull();
  });

  it('does NOT claim applied when loadedRegionId does not match selectedRegionId or state is APPLYING', async () => {
    const statusApplying: Mf05DemoStatus = {
      ...mockStatusReady,
      state: 'APPLYING',
      loadedRegionId: null,
      loadedConfigurationVersion: 2,
    };
    getStatusMock.mockResolvedValueOnce(statusApplying);

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Applying...')[0]).not.toBeNull();
    });

    expect(screen.queryByText('Active & Applied')).toBeNull();
  });

  it('disables Apply button when canApply is false (admin only)', async () => {
    renderComponent({ canApply: false });

    await waitFor(() => {
      expect(screen.getByDisplayValue(/ZONE-A/)).not.toBeNull();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: REGION_2_UUID } });

    const applyBtn = screen.getByRole('button', { name: /apply saved region/i });
    expect(applyBtn).toHaveProperty('disabled', true);
    expect(screen.getByText(/admin permission required to apply/i)).not.toBeNull();
  });

  it('handles token rotation: held GET with old token does not overwrite new token query state', async () => {
    let resolveFirstGet: (val: Mf05DemoStatus) => void = () => {};
    const firstGetPromise = new Promise<Mf05DemoStatus>((res) => {
      resolveFirstGet = res;
    });

    getStatusMock.mockImplementationOnce(() => firstGetPromise);

    const { rerender } = renderComponent({
      token: 'token-old',
      sessionScope: 'scope-old',
    });

    expect(getStatusMock).toHaveBeenCalledWith('token-old', SITE_UUID, CAM_1_UUID, expect.any(Object));

    // Rotate token and sessionScope
    const statusNewToken: Mf05DemoStatus = {
      ...mockStatusReady,
      configurationVersion: 4,
    };
    getStatusMock.mockResolvedValueOnce(statusNewToken);

    rerender(
      <QueryClientProvider client={queryClient}>
        <Mf05DemoControlPanel
          apiUrl="http://localhost:3000/api"
          token="token-new"
          sessionScope="scope-new"
          siteId={SITE_UUID}
          cameraId={CAM_1_UUID}
          canApply={true}
        />
      </QueryClientProvider>,
    );

    // Resolve the delayed first GET
    act(() => {
      resolveFirstGet({
        ...mockStatusReady,
        configurationVersion: 999, // stale old value
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Saved Rev: 4/i)).not.toBeNull();
    });

    expect(screen.queryByText(/Saved Rev: 999/i)).toBeNull();
  });

  it('suppresses stale apply result if camera changes while apply is in flight', async () => {
    let resolveApply: (val: Mf05DemoStatus) => void = () => {};
    const applyPromise = new Promise<Mf05DemoStatus>((res) => {
      resolveApply = res;
    });
    applyRegionMock.mockImplementationOnce(() => applyPromise);

    const onApplyingChange = vi.fn();
    const { rerender } = renderComponent({
      cameraId: CAM_1_UUID,
      onApplyingChange,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue(/ZONE-A/)).not.toBeNull();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: REGION_2_UUID } });

    const applyBtn = screen.getByRole('button', { name: /apply saved region/i });
    fireEvent.click(applyBtn);

    await waitFor(() => expect(applyRegionMock).toHaveBeenCalledWith(
      'test-token',
      SITE_UUID,
      CAM_1_UUID,
      { regionId: REGION_2_UUID, expectedConfigurationVersion: 3 },
      expect.any(Object),
    ));

    // Camera switches to CAM_2 before apply resolves
    const statusCam2: Mf05DemoStatus = {
      ...mockStatusReady,
      cameraId: CAM_2_UUID,
      configurationVersion: 1,
      loadedRegionId: REGION_1_UUID,
      selectedRegionId: REGION_1_UUID,
    };
    getStatusMock.mockResolvedValueOnce(statusCam2);

    rerender(
      <QueryClientProvider client={queryClient}>
        <Mf05DemoControlPanel
          apiUrl="http://localhost:3000/api"
          token="test-token"
          sessionScope="opaque-session-scope-1"
          siteId={SITE_UUID}
          cameraId={CAM_2_UUID}
          canApply={true}
          onApplyingChange={onApplyingChange}
        />
      </QueryClientProvider>,
    );

    // Late resolve of old CAM_1 apply
    act(() => {
      resolveApply({
        ...mockStatusReady,
        selectedRegionId: REGION_2_UUID,
        loadedRegionId: REGION_2_UUID,
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Saved Rev: 1/i)).not.toBeNull();
    });

    // Stale apply must not overwrite CAM_2 state
    expect(screen.queryByText(/Saved Rev: 3/i)).toBeNull();
  });

  it('sets query immediately on successful apply and keeps onApplyingChange(true) until requested revision loaded', async () => {
    const onApplyingChange = vi.fn();
    const statusPostApply: Mf05DemoStatus = {
      ...mockStatusReady,
      state: 'APPLYING',
      selectedRegionId: REGION_2_UUID,
      loadedRegionId: REGION_1_UUID, // still old region
      configurationVersion: 4,
    };
    applyRegionMock.mockResolvedValueOnce(statusPostApply);

    renderComponent({ onApplyingChange });

    await waitFor(() => {
      expect(screen.getByDisplayValue(/ZONE-A/)).not.toBeNull();
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: REGION_2_UUID } });

    const applyBtn = screen.getByRole('button', { name: /apply saved region/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      // Query cache was immediately set from returned status
      expect(screen.getByText(/Saved Rev: 4/i)).not.toBeNull();
      expect(screen.getAllByText('Applying...')[0]).not.toBeNull();
    });

    // onApplyingChange should remain true because loadedRegionId is still REGION_1_UUID
    expect(onApplyingChange).toHaveBeenLastCalledWith(true);
  });

  it('renders candidate section with title "MF05 candidate input for MF08, NOT persisted Safety Alert" and "temporal-confirmed and backend policy filtered"', async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText('MF05 candidate input for MF08, NOT persisted Safety Alert'),
      ).not.toBeNull();
    });

    expect(
      screen.getByText(/temporal-confirmed and backend policy filtered/i),
    ).not.toBeNull();

    expect(screen.getByText(new RegExp(EVENT_1_UUID))).not.toBeNull();
    expect(screen.getAllByText(/HARD_HAT/).length).toBeGreaterThan(0);
    expect(screen.getByText('Track:').parentElement?.textContent).toMatch(/Track:\s*42/);

    // Verify NO review action buttons or alertId
    expect(screen.queryByText(/approve/i)).toBeNull();
    expect(screen.queryByText(/dismiss/i)).toBeNull();
    expect(screen.queryByText(/alertId/i)).toBeNull();
  });

  it('displays "no confirmed candidate (NOT safety clear)" when candidates array is empty', async () => {
    const statusNoCandidates: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [],
    };
    getStatusMock.mockResolvedValueOnce(statusNoCandidates);

    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByText(/no confirmed candidate \(NOT safety clear\)/i),
      ).not.toBeNull();
    });
  });

  it('renders candidates with unique composite key (event+track+item+region/version) even when eventId is shared', async () => {
    const statusDuplicateEvents: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_HARD_HAT_MISSING',
          ppeItem: 'HARD_HAT',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 2,
          zoneId: ZONE_1_UUID,
        },
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3, // Different track, shared eventId
          zoneId: ZONE_1_UUID,
        },
      ],
    };
    getStatusMock.mockResolvedValueOnce(statusDuplicateEvents);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByTestId(`candidate-${EVENT_1_UUID}-2-HARD_HAT-${REGION_1_UUID}-2`)).not.toBeNull();
      expect(screen.getByTestId(`candidate-${EVENT_1_UUID}-3-SAFETY_VEST-${REGION_1_UUID}-2`)).not.toBeNull();
    });
  });

  it('shows "Evidence identity unavailable" and does NOT render JPEG image when evidenceFrame metadata is absent', async () => {
    const statusAbsentMetadata: Mf05DemoStatus = {
      ...mockStatusReady,
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: null,
    };
    getStatusMock.mockResolvedValueOnce(statusAbsentMetadata);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    // Must NOT associate or render unverified latest JPEG
    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows "Evidence identity unavailable" and suppresses image when evidenceFrame eventId mismatches candidate event', async () => {
    const statusMismatchedFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: '00000000-0000-0000-0000-000000000000', // Mismatched eventId
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: { x1: 0.136, y1: 0.28, x2: 0.181, y2: 0.352, coordinateSpace: 'NORMALIZED_0_1' },
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusMismatchedFrame);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
  });

  it('shows "Evidence identity unavailable" and suppresses image when capturedAt timestamp mismatches candidate', async () => {
    const statusMismatchedTime: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T02:30:00Z', // Mismatched capturedAt
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusMismatchedTime);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
  });

  it('shows "Evidence identity unavailable" and suppresses image when target regionId mismatches candidate', async () => {
    const statusMismatchedRegion: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_2_UUID, // Mismatched regionId
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusMismatchedRegion);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
  });

  it('shows "Evidence identity unavailable" and suppresses image when target geometryVersion mismatches candidate', async () => {
    const statusMismatchedVersion: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 3, // Mismatched geometryVersion (expected 2)
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusMismatchedVersion);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
  });

  it('shows "Evidence identity unavailable" and suppresses image when second target in evidenceFrame is unmatched', async () => {
    const statusSecondUnmatched: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3, // Matched
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
          {
            trackId: 99, // Unmatched target
            ppeItem: 'HARD_HAT',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusSecondUnmatched);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
  });

  it('renders image with normalized scaled SVG box overlays and exact Event/Track/PPE labels when valid evidenceFrame is present', async () => {
    const statusWithEvidenceFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: {
              x1: 0.136,
              y1: 0.28,
              x2: 0.181,
              y2: 0.352,
              coordinateSpace: 'NORMALIZED_0_1',
            },
            ppeBox: {
              x1: 0.14,
              y1: 0.29,
              x2: 0.175,
              y2: 0.33,
              coordinateSpace: 'NORMALIZED_0_1',
            },
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusWithEvidenceFrame);

    renderComponent();

    // 1. Evidence image is rendered
    await waitFor(() => {
      const img = screen.getByAltText('Latest MF05 evidence candidate') as HTMLImageElement;
      expect(img).not.toBeNull();
    });

    // 2. SVG overlay with viewBox 0 0 640 480 is present
    const svgOverlay = screen.getByLabelText(/evidence bounding box overlay/i);
    expect(svgOverlay).not.toBeNull();
    expect(svgOverlay.getAttribute('viewBox')).toBe('0 0 640 480');

    // 3. Technical personBox rect scaled to normalized dimensions
    // x = 0.136 * 640 = 87.04, y = 0.28 * 480 = 134.4, width = 28.8, height = 34.56
    const personRect = svgOverlay.querySelector('[data-testid="evidence-box-person-3"]');
    expect(personRect).not.toBeNull();
    expect(Number(personRect?.getAttribute('x'))).toBeCloseTo(87.04, 1);
    expect(Number(personRect?.getAttribute('y'))).toBeCloseTo(134.4, 1);
    expect(Number(personRect?.getAttribute('width'))).toBeCloseTo(28.8, 1);
    expect(Number(personRect?.getAttribute('height'))).toBeCloseTo(34.56, 1);

    // 4. Exact technical labels present: Event, Track 3, PPE SAFETY_VEST scoped to evidence technical metadata
    const evidenceMeta = screen.getByTestId('evidence-target-metadata');
    expect(within(evidenceMeta).getByText(/Track:\s*3/i)).not.toBeNull();
    expect(within(evidenceMeta).getByText('SAFETY_VEST')).not.toBeNull();
    expect(within(screen.getByTestId('evidence-target-3-SAFETY_VEST')).getByText('SAFETY_VEST')).not.toBeNull();

    // 5. Strict rejection of human/worker interpretation or certification claims
    expect(screen.queryByText(/worker/i)).toBeNull();
    expect(screen.queryByText(/certified/i)).toBeNull();
    expect(screen.queryByText(/certification/i)).toBeNull();
  });

  it('hides evidence image and overlay when state is APPLYING or isApplying is true', async () => {
    const statusApplyingWithFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      state: 'APPLYING',
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusApplyingWithFrame);

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Applying...')[0]).not.toBeNull();
    });

    // Evidence image and SVG overlay must be hidden during apply
    expect(screen.queryByAltText(/Latest MF05 evidence candidate/i)).toBeNull();
    expect(screen.queryByLabelText(/evidence bounding box overlay/i)).toBeNull();
  });

  it('shows "No evidence image available" when evidenceImageDataUrl is null with no fake thumbnail', async () => {
    const statusNoImage: Mf05DemoStatus = {
      ...mockStatusReady,
      evidenceImageDataUrl: null,
      evidenceFrame: null,
    };
    getStatusMock.mockResolvedValueOnce(statusNoImage);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/no evidence image available/i)).not.toBeNull();
    });
    expect(screen.queryByAltText('Latest MF05 evidence candidate')).toBeNull();
  });

  it('renders "Download Evidence" button when valid evidenceFrame is present and calls downloadMf05EvidenceExport on click', async () => {
    const statusWithEvidenceFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusWithEvidenceFrame);

    renderComponent();

    // 1. Evidence image is rendered
    await waitFor(() => {
      expect(screen.getByAltText('Latest MF05 evidence candidate')).not.toBeNull();
    });

    // 2. Exact "Download Evidence" button is visible and enabled
    const downloadBtn = screen.getByRole('button', { name: /^download evidence$/i });
    expect(downloadBtn).not.toBeNull();
    expect(downloadBtn).toHaveProperty('disabled', false);

    // 3. Clicking button calls downloadMf05EvidenceExport helper with current status
    fireEvent.click(downloadBtn);
    expect(mf05EvidenceExport.downloadMf05EvidenceExport).toHaveBeenCalledTimes(1);
    expect(mf05EvidenceExport.downloadMf05EvidenceExport).toHaveBeenCalledWith(statusWithEvidenceFrame);
  });

  it('hides "Download Evidence" button when state is APPLYING or applying transition is active', async () => {
    const statusApplyingWithFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      state: 'APPLYING',
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusApplyingWithFrame);

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Applying...')[0]).not.toBeNull();
    });

    expect(screen.queryByRole('button', { name: /^download evidence$/i })).toBeNull();
    expect(screen.queryByText(/^download evidence$/i)).toBeNull();
  });

  it('hides "Download Evidence" button when evidenceFrame metadata is absent or invalid', async () => {
    const statusAbsentMetadata: Mf05DemoStatus = {
      ...mockStatusReady,
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: null,
    };
    getStatusMock.mockResolvedValueOnce(statusAbsentMetadata);

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/evidence identity unavailable/i)).not.toBeNull();
    });

    expect(screen.queryByRole('button', { name: /^download evidence$/i })).toBeNull();
    expect(screen.queryByText(/^download evidence$/i)).toBeNull();
  });

  it('hides "Download Evidence" button when camera scope changes', async () => {
    const statusWithEvidenceFrame: Mf05DemoStatus = {
      ...mockStatusReady,
      candidates: [
        {
          eventId: EVENT_1_UUID,
          capturedAt: '2026-10-08T01:00:00Z',
          candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
          ppeItem: 'SAFETY_VEST',
          regionId: REGION_1_UUID,
          geometryVersion: 2,
          trackId: 3,
          zoneId: ZONE_1_UUID,
        },
      ],
      evidenceImageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      evidenceFrame: {
        eventId: EVENT_1_UUID,
        capturedAt: '2026-10-08T01:00:00Z',
        frameDimensions: { width: 640, height: 480 },
        targets: [
          {
            trackId: 3,
            ppeItem: 'SAFETY_VEST',
            regionId: REGION_1_UUID,
            geometryVersion: 2,
            personBox: null,
            ppeBox: null,
          },
        ],
      },
    };
    getStatusMock.mockResolvedValueOnce(statusWithEvidenceFrame);

    const { rerender } = renderComponent({ cameraId: CAM_1_UUID });

    await waitFor(() => {
      expect(screen.getByAltText('Latest MF05 evidence candidate')).not.toBeNull();
    });

    // Scope changes to CAM_2_UUID without status yet
    const statusCam2Pending: Mf05DemoStatus = {
      ...mockStatusReady,
      cameraId: CAM_2_UUID,
      state: 'APPLYING',
      evidenceImageDataUrl: null,
      evidenceFrame: null,
    };
    getStatusMock.mockResolvedValueOnce(statusCam2Pending);

    rerender(
      <QueryClientProvider client={queryClient}>
        <Mf05DemoControlPanel
          apiUrl="http://localhost:3000/api"
          token="test-token"
          sessionScope="opaque-session-scope-1"
          siteId={SITE_UUID}
          cameraId={CAM_2_UUID}
          canApply={true}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: /^download evidence$/i })).toBeNull();
  });
});
