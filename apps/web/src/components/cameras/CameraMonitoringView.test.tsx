// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as useRealtimePreviewModule from './useRealtimePreview';
import { CameraMonitoringView } from './CameraMonitoringView';

describe('CameraMonitoringView DOM Regression & Liveness Claim Prevention', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });

    // Browser API stubs for JSDOM environment
    class MockResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    // Scoped canvas 2d context stub (avoids external canvas npm installation)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((contextId: string) => {
      if (contextId === '2d') {
        return {
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          closePath: vi.fn(),
          stroke: vi.fn(),
          fill: vi.fn(),
          arc: vi.fn(),
          measureText: vi.fn(() => ({ width: 0 })),
          fillText: vi.fn(),
          strokeText: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          drawImage: vi.fn(),
          createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          scale: vi.fn(),
          rotate: vi.fn(),
          translate: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. Neutral Parent Badge: never claims Live AI Active even when stream is disconnected or erroring', () => {
    // Simulate stream in disconnected/error state
    vi.spyOn(useRealtimePreviewModule, 'useRealtimePreview').mockReturnValue({
      url: null,
      preview: null,
      connected: false,
      error: 'Connection refused: AI worker stream offline',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView />
      </QueryClientProvider>,
    );

    // Parent header must display neutral workspace label
    expect(screen.getByText('Camera Monitoring')).not.toBeNull();
    expect(screen.getByText('Vision Workspace')).not.toBeNull();

    // Parent must NEVER hardcode or claim Live AI Active
    expect(screen.queryByText(/live ai active/i)).toBeNull();

    // Child runtime error indicator must remain visible and honest
    expect(
      screen.getByText(/AI WebSocket: Connection refused: AI worker stream offline/i),
    ).not.toBeNull();
    expect(screen.getByText(/OFFLINE \(SOCKET ERROR\)/i)).not.toBeNull();
  });

  it('2. Sub-tab switching: preserves neutral parent header and switches to Restricted Zones view', async () => {
    const user = userEvent.setup();
    vi.spyOn(useRealtimePreviewModule, 'useRealtimePreview').mockReturnValue({
      url: null,
      preview: null,
      connected: false,
      error: 'AI backend unavailable',
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CameraMonitoringView />
      </QueryClientProvider>,
    );

    // Initial tab is PPE Monitoring (MF04)
    expect(screen.getByRole('button', { name: /PPE Monitoring.*MF04/i })).not.toBeNull();
    const zonesTabButton = screen.getByRole('button', { name: /Restricted Zones.*MF05/i });

    // Switch to Restricted Zones sub-tab
    await user.click(zonesTabButton);

    // Parent header remains strictly neutral
    expect(screen.getByText('Vision Workspace')).not.toBeNull();
    expect(screen.queryByText(/live ai active/i)).toBeNull();
  });
});
