// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PpeMonitoringView } from './PpeMonitoringView';
import { formatPpeItemLabel } from '../cameras/monitoringUtils';
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

function mockDetection(trackId = 7): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.88,
    eventId: '00000000-0000-4000-8000-000000000001',
    label: 'Missing Hard Hat',
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    timecode: '01:23',
    trackId,
    cameraExternalId: 'CAM-01',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: detection ? [detection] : [],
      zoneDetections: [],
    },
  };
}

describe('PpeMonitoringView Navigation & Bounded Review Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockDetection(7));
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
  });

  it('renders "View in Safety Alerts" action and navigates to incidents with PPE_VIOLATION context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const alertsNavButton = screen.getByRole('button', { name: /View in Safety Alerts/i });
    expect(alertsNavButton).not.toBeNull();

    await user.click(alertsNavButton);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', { alertType: 'PPE_VIOLATION' });
  });

  it('navigates from Violation Review modal to Safety Alerts when user clicks "Review in Safety Alerts"', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    // Mở modal review từ detection bằng nút "Review Alert"
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);

    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    const reviewInAlertsBtn = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(reviewInAlertsBtn);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', { alertType: 'PPE_VIOLATION' });

    // Modal phải được đóng sau khi điều hướng
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
  });

  it('allows dismissing review preview modal without navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);

    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    const dismissBtn = screen.getByRole('button', { name: /Dismiss Preview/i });
    await user.click(dismissBtn);

    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('hides replay table and shows concise technical-live status when live streaming is active', () => {
    // state.preview is set to mockPreview, so isLive is true
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    // Bảng replay và tiêu đề PPE Replay Observations phải bị ẩn
    expect(screen.queryByText('PPE Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    // Thay vào đó hiển thị thông điệp kỹ thuật live
    expect(screen.getByText('Live AI Observations Active')).not.toBeNull();
    expect(
      screen.getByText(/Technical PPE detections are rendered directly on the live camera feed/i),
    ).not.toBeNull();
  });

  it('shows replay table when live streaming is not active', () => {
    state.preview = null; // isLive is false

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    // Replay table và tiêu đề phải hiển thị khi không có luồng trực tiếp
    expect(screen.getByText('PPE Replay Observations')).not.toBeNull();
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
  });

  it('renders legacy checklist with only mandatory Helmet and Safety Vest and omits unrecorded expanded items', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
      confirmedMissingItems: ['HARD_HAT'],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('PPE CHECK')).not.toBeNull();
    expect(
      screen.getByText(
        'Core observations: Helmet & Safety Vest. Expanded items are evaluated when reported.',
      ),
    ).not.toBeNull();
    expect(screen.getByText('Helmet · Missing · confirmed')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    expect(screen.queryByText(/Gloves ·/i)).toBeNull();
    expect(screen.queryByText(/Boots ·/i)).toBeNull();
    expect(screen.queryByText(/Goggles ·/i)).toBeNull();
    expect(screen.queryByText(/harness/i)).toBeNull();
  });

  it('renders expanded checklist dynamically when GLOVES, BOOTS, and GOGGLES are reported', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'PRESENT',
        BOOTS: 'MISSING',
        GOGGLES: 'UNKNOWN',
      },
      confirmedMissingItems: [],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Helmet · Detected')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    expect(screen.getByText('Gloves · Detected')).not.toBeNull();
    expect(screen.getByText('Boots · Missing · checking')).not.toBeNull();
    expect(screen.getByText('Goggles · Unknown')).not.toBeNull();
    expect(screen.queryByText(/harness/i)).toBeNull();
  });

  it('correctly displays confirmed missing state for expanded items and unknown state for unverified items', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: {
        HARD_HAT: 'UNKNOWN',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'MISSING',
      },
      confirmedMissingItems: ['GLOVES'],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Helmet · Unknown')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    // Reported expanded GLOVES is confirmed missing
    expect(screen.getByText('Gloves · Missing · confirmed')).not.toBeNull();
    // BOOTS and GOGGLES were not reported, so they must not be in the checklist
    expect(screen.queryByText(/Boots ·/i)).toBeNull();
    expect(screen.queryByText(/Goggles ·/i)).toBeNull();
  });
});

describe('formatPpeItemLabel', () => {
  it('formats HARD_HAT and SAFETY_VEST accurately', () => {
    expect(formatPpeItemLabel('HARD_HAT')).toBe('Hard Hat');
    expect(formatPpeItemLabel('SAFETY_VEST')).toBe('Safety Vest');
  });

  it('formats extended PPE items (GLOVES, BOOTS, GOGGLES) without mapping to vest', () => {
    expect(formatPpeItemLabel('GLOVES')).toBe('Gloves');
    expect(formatPpeItemLabel('BOOTS')).toBe('Boots');
    expect(formatPpeItemLabel('GOGGLES')).toBe('Goggles');
  });

  it('falls back to PPE for undefined or unrecognised item', () => {
    expect(formatPpeItemLabel(undefined)).toBe('PPE');
  });
});
