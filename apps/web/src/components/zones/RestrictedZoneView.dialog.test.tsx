// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const previewState = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'DISCONNECTED' as 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'REPLAY' | 'UNAVAILABLE',
  error: null as string | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: previewState.preview,
    status: previewState.status,
    sourceKind:
      previewState.status === 'REPLAY' ? 'REPLAY' : previewState.status === 'LIVE' ? 'LIVE' : null,
    error: previewState.error,
    capturedAt: previewState.preview?.frame.capturedAt ?? null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: previewState.preview, connected: true, error: null }),
}));

function mockZoneDetection(trackId = 7): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    boundingBox: { x1: 0.25, y1: 0.25, x2: 0.55, y2: 0.75 },
    confidence: 0.94,
    eventId: '00000000-0000-4000-8000-000000000007',
    label: 'Technical Zone Entry',
    ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
    timecode: '01:23',
    trackId,
    regionId: 'zone-exclusion-7',
    cameraExternalId: 'CAM-07',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000007',
      sequenceNumber: '7',
      cameraExternalId: 'CAM-07',
      capturedAt: '2026-10-10T10:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [],
      zoneDetections: detection ? [detection] : [],
    },
  };
}

describe('RestrictedZoneView - Incident Review Dialog Accessibility & Evidence Boundaries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    previewState.preview = mockPreview(mockZoneDetection(7));
    previewState.status = 'LIVE';
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    previewState.preview = null;
    previewState.status = 'DISCONNECTED';
    previewState.error = null;
  });

  it('1. provides accessible dialog role, aria-modal, and accessible name upon opening', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);

    // Dialog container must have role="dialog", aria-modal="true", and accessible name from title
    const dialog = screen.getByRole('dialog', { name: /Review & Action/i });
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('2. dismisses the modal when user presses the Escape key', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);

    expect(screen.getByText(/Review & Action/i)).not.toBeNull();

    // Escape must close the dialog
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Review & Action/i)).toBeNull();
  });

  it('3. traps keyboard focus inside dialog controls when pressing Tab and Shift+Tab', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);

    const dialog = screen.getByRole('dialog');
    const dismissBtn = screen.getByRole('button', { name: /Dismiss Preview/i });
    const closeBtn = screen.getByRole('button', { name: /Close (review )?dialog/i });

    // Focus starts inside dialog or move to dismiss button
    dismissBtn.focus();
    expect(document.activeElement).toBe(dismissBtn);

    // Tabbing from the last focusable element must wrap back to the first focusable element inside dialog
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab from the first element must wrap back to the last element
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(dismissBtn);
  });

  it('4. returns focus to the trigger button when dialog is dismissed', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    await user.click(triggerBtn);
    expect(screen.getByText(/Review & Action/i)).not.toBeNull();

    const dismissBtn = screen.getByRole('button', { name: /Dismiss Preview/i });
    await user.click(dismissBtn);

    expect(screen.queryByText(/Review & Action/i)).toBeNull();
    // Focus must return to the original trigger element
    expect(document.activeElement).toBe(triggerBtn);
  });

  it('5. uses objective technical observation wording without confirming worker identity or intrusion violation', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);

    // Spec & AGENTS.md requirement:
    // AI emits technical observations, not verified business violations or worker identity.
    // It must NOT state "AI detected worker" or declare a "restricted zone intrusion".
    expect(screen.queryByText(/AI detected worker/i)).toBeNull();
    expect(screen.queryByText(/restricted zone intrusion/i)).toBeNull();

    // It must use objective technical observation language: Person / Track ID and technical entry observation
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/Track #7|Person Track|Technical Observation/i);
  });

  it('6. clears and dismisses active review modal when site scope changes or credentials are reset', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        { id: 'site-alpha', code: 'SITE-A', name: 'Site Alpha', createdAt: '2026-10-01T00:00:00Z' },
        { id: 'site-beta', code: 'SITE-B', name: 'Site Beta', createdAt: '2026-10-01T00:00:00Z' },
      ],
      total: 2,
    });

    const initialSession: SharedSession = {
      accessToken: 'token-site-alpha',
      sessionScope: 'scope-site-alpha',
      user: {
        id: 'user-1',
        displayName: 'Safety Officer',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={initialSession} />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);
    expect(screen.getByText(/Review & Action/i)).not.toBeNull();

    // When session or scope changes (e.g. credential clear / logout or scope shift)
    const switchedSession: SharedSession = {
      accessToken: 'token-site-beta',
      sessionScope: 'scope-site-beta',
      user: {
        id: 'user-1',
        displayName: 'Safety Officer',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };

    rerender(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={switchedSession} />
      </QueryClientProvider>,
    );

    // Modal must be automatically dismissed to avoid showing stale or cross-site evidence
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Review & Action/i)).toBeNull();
  });

  it('closes the old observation when the producer session changes without a stream gap', async () => {
    const user = userEvent.setup();
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    await user.click(screen.getByRole('button', { name: /Review Incident/i }));
    expect(screen.getByRole('dialog', { name: /Review & Action/i })).not.toBeNull();
    previewState.preview = mockPreview(mockZoneDetection(8));
    previewState.preview.frame.sessionId = '00000000-0000-4000-8000-000000000008';
    rerender(view());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves keyboard review while another frame arrives in the same producer session', async () => {
    const user = userEvent.setup();
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>
    );
    const { rerender } = render(view());
    await user.click(screen.getByRole('button', { name: /Review Incident/i }));
    previewState.preview = mockPreview(mockZoneDetection(8));
    previewState.preview.frame.sequenceNumber = '8';
    rerender(view());
    const dialog = screen.getByRole('dialog', { name: /Review & Action/i });
    expect(dialog.textContent).toContain('Track #7');
    expect(dialog.textContent).not.toContain('Track #8');
  });

  it('7. clears and dismisses active review modal when scoped preview is lost or stream drops', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    const triggerBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(triggerBtn);
    expect(screen.getByRole('dialog', { name: /Review & Action/i })).not.toBeNull();

    // When scoped camera preview stream is lost or 5s TTL expires without new frame
    previewState.preview = null;
    previewState.status = 'DISCONNECTED';

    rerender(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Modal must be automatically dismissed to avoid showing frozen/stale observation evidence
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Review & Action/i)).toBeNull();
  });
});
