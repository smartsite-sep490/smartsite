// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({ preview: null as DecodedPreview | null }));
vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

function mockZoneDetection(trackId = 5): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    boundingBox: { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.8 },
    confidence: 0.92,
    eventId: '00000000-0000-4000-8000-000000000002',
    label: 'Intrusion Alert',
    ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
    timecode: '02:45',
    trackId,
    regionId: 'zone-exclusion-1',
    cameraExternalId: 'CAM-02',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000002',
      sequenceNumber: '2',
      cameraExternalId: 'CAM-02',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [],
      zoneDetections: detection ? [detection] : [],
    },
  };
}

describe('RestrictedZoneView Navigation & Bounded Review Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockZoneDetection(5));
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
  });

  it('renders "View in Safety Alerts" action and navigates to incidents with RESTRICTED_ZONE_INTRUSION context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const alertsNavButton = screen.getByRole('button', { name: /View in Safety Alerts/i });
    expect(alertsNavButton).not.toBeNull();

    await user.click(alertsNavButton);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
    });
  });

  it('navigates from Zone Incident Review modal to Safety Alerts when user clicks "Review in Safety Alerts"', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    // Mở modal review từ detection bằng nút "Review Incident"
    const reviewIncidentBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(reviewIncidentBtn);

    expect(screen.getByRole('heading', { name: 'Review & Action' })).not.toBeNull();

    const reviewInAlertsBtn = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(reviewInAlertsBtn);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
    });

    // Modal phải được đóng sau khi điều hướng
    expect(screen.queryByRole('heading', { name: 'Review & Action' })).toBeNull();
  });

  it('hides replay table and shows concise technical-live status when live streaming is active', () => {
    // state.preview is set to mockPreview, so isLive is true
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Bảng replay và tiêu đề Zone Replay Observations phải bị ẩn
    expect(screen.queryByText('Zone Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    // Thay vào đó hiển thị thông điệp kỹ thuật live
    expect(screen.getByText('Live Zone Observations Active')).not.toBeNull();
    expect(
      screen.getByText(
        /Technical zone-entry detections are rendered directly on the live camera feed/i,
      ),
    ).not.toBeNull();
  });

  it('shows replay table when live streaming is not active', () => {
    state.preview = null; // isLive is false

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Replay table và tiêu đề phải hiển thị khi không có luồng trực tiếp
    expect(screen.getByText('Zone Replay Observations')).not.toBeNull();
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.queryByText('Live Zone Observations Active')).toBeNull();
  });
});
