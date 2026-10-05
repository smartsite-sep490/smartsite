import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PpeMonitoringView } from '../ppe/PpeMonitoringView';
import { RestrictedZoneView } from '../zones/RestrictedZoneView';
import type { DecodedPreview } from './useRealtimePreview';
import type { VideoTestDetection } from './videoTestFixture';

const state = vi.hoisted(() => ({ preview: null as DecodedPreview | null }));
vi.mock('./useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

function preview(withPerson: boolean): DecodedPreview {
  const detection: VideoTestDetection = {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.8,
    eventId: 'diagnostic-track-7',
    label: 'TRACK #7',
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'UNKNOWN' },
    timecode: '00:01',
    trackId: 7,
  };
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-TEST',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: withPerson ? [detection] : [],
      zoneDetections: withPerson ? [detection] : [],
    },
  };
}

afterEach(() => {
  state.preview = null;
});

describe.each([
  ['PPE', PpeMonitoringView],
  ['Restricted Zone', RestrictedZoneView],
] as const)('%s identity boundary', (_name, View) => {
  function render() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      return renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <View />
        </QueryClientProvider>,
      );
    } finally {
      client.clear();
    }
  }

  it('shows an unidentified person track without claiming Worker identity or recognition score', () => {
    state.preview = preview(true);
    const markup = render();
    expect(markup).toContain('Track #7');
    expect(markup).toContain('Track ID');
    expect(markup).toContain('Unknown — not identified');
    expect(markup).toContain('Detection Confidence');
    expect(markup).toContain('80%');
    expect(markup).not.toContain('Worker ID');
    expect(markup).not.toContain('Worker (Track');
    expect(markup).not.toContain('Recognition Confidence');
  });

  it('does not infer identity when the current frame contains no people', () => {
    state.preview = preview(false);
    const markup = render();
    expect(markup).toContain('No person detected');
    expect(markup).not.toContain('Track #7');
    expect(markup).not.toContain('Worker ID');
    expect(markup).not.toContain('Recognition Confidence');
  });

  it('retains the track identifier for a person outside the restricted zone', () => {
    state.preview = preview(true);
    state.preview.frame.detections[0]!.active = false;
    state.preview.frame.zoneDetections[0]!.active = false;
    const text = render().replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/Track ID\s+Track #7/);
    expect(text).toContain('Unknown — not identified');
  });
});

describe('PpeMonitoringView baseline copy boundaries', () => {
  it('displays Core PPE Observed and Helmet and vest detected instead of broad compliance claims', () => {
    state.preview = {
      image: {} as HTMLImageElement,
      frame: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        sequenceNumber: '1',
        cameraExternalId: 'CAM-TEST',
        capturedAt: '2026-09-30T00:00:00Z',
        width: 640,
        height: 480,
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        zonePolygons: [],
        detections: [
          {
            active: false,
            alertState: 'COMPLIANT',
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
            confidence: 0.9,
            eventId: 'evt-compliant',
            label: 'TRACK #1',
            ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
            timecode: '00:01',
            trackId: 1,
          },
        ],
        zoneDetections: [],
      },
    };

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );
    client.clear();

    expect(markup).toContain('CORE PPE OBSERVED');
    expect(markup).toContain('HELMET AND VEST DETECTED');
    expect(markup).toContain('Expanded items (gloves, boots, goggles) are not assessed');
    expect(markup).not.toContain('harness');
    expect(markup).not.toContain('ALL REQUIRED PPE PRESENT');
    expect(markup).not.toContain('PPE COMPLIANT');
  });

  it('displays compliance message for expanded reported items without claiming unassessed harness', () => {
    state.preview = {
      image: {} as HTMLImageElement,
      frame: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        sequenceNumber: '1',
        cameraExternalId: 'CAM-TEST',
        capturedAt: '2026-09-30T00:00:00Z',
        width: 640,
        height: 480,
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        zonePolygons: [],
        detections: [
          {
            active: false,
            alertState: 'COMPLIANT',
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
            confidence: 0.9,
            eventId: 'evt-compliant-expanded',
            label: 'TRACK #1',
            ppeStatus: {
              HARD_HAT: 'PRESENT',
              SAFETY_VEST: 'PRESENT',
              GLOVES: 'PRESENT',
              BOOTS: 'PRESENT',
              GOGGLES: 'PRESENT',
            },
            timecode: '00:01',
            trackId: 1,
          },
        ],
        zoneDetections: [],
      },
    };

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );
    client.clear();

    expect(markup).toContain('CORE PPE OBSERVED');
    expect(markup).toContain('CORE AND REPORTED PPE DETECTED');
    expect(markup).toContain('Helmet, safety vest, and reported expanded PPE items detected.');
    expect(markup).not.toContain('are not assessed');
    expect(markup).not.toContain('harness');
    expect(markup).not.toContain('ALL REQUIRED PPE PRESENT');
    expect(markup).not.toContain('PPE COMPLIANT');
  });
});
