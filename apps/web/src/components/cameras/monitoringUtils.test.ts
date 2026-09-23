import { describe, it, expect } from 'vitest';
import {
  buildAiWebSocketUrl,
  getEffectiveDetections,
  getPrimaryZoneDetection,
  getPpeEventRowKey,
  getZoneEventRowKey,
  mapContainerPointToVideoNormalized,
  mapVideoNormalizedToContainerNormalized,
  exportZoneBrowserDraft,
} from './monitoringUtils';
import type { VideoTestDetection } from './videoTestFixture';

describe('monitoringUtils', () => {
  describe('buildAiWebSocketUrl', () => {
    it('returns error when token is missing and not in URL', () => {
      const result = buildAiWebSocketUrl('ws://127.0.0.1:8000/ws/realtime', '');
      expect(result.url).toBeNull();
      expect(result.error).toMatch(/token/i);
    });

    it('returns error when token is only whitespace and not in URL', () => {
      const result = buildAiWebSocketUrl('ws://127.0.0.1:8000/ws/realtime', '   ');
      expect(result.url).toBeNull();
      expect(result.error).toMatch(/token/i);
    });

    it('attaches token query param to bare WebSocket URL', () => {
      const result = buildAiWebSocketUrl('ws://127.0.0.1:8000/ws/realtime', 'my-secret-token');
      expect(result.error).toBeNull();
      expect(result.url).toBe('ws://127.0.0.1:8000/ws/realtime?token=my-secret-token');
    });

    it('attaches token query param when URL already has query parameters', () => {
      const result = buildAiWebSocketUrl(
        'ws://127.0.0.1:8000/ws/realtime?camera=CAM-04',
        'my-secret-token',
      );
      expect(result.error).toBeNull();
      expect(result.url).toBe(
        'ws://127.0.0.1:8000/ws/realtime?camera=CAM-04&token=my-secret-token',
      );
    });

    it('uses existing token in URL if present', () => {
      const result = buildAiWebSocketUrl(
        'ws://127.0.0.1:8000/ws/realtime?token=embedded-token',
        '',
      );
      expect(result.error).toBeNull();
      expect(result.url).toBe('ws://127.0.0.1:8000/ws/realtime?token=embedded-token');
    });
  });

  describe('getEffectiveDetections', () => {
    const mockFixtureDetection: VideoTestDetection = {
      active: true,
      boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 },
      confidence: 0.85,
      eventId: 'FIXTURE-EVT-1',
      label: 'FIXTURE',
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
      timecode: '00:15',
      trackId: 1,
    };

    it('falls back to fixture when live detections is null (offline/disconnected)', () => {
      const result = getEffectiveDetections(null, [mockFixtureDetection]);
      expect(result.isLive).toBe(false);
      expect(result.detections).toEqual([mockFixtureDetection]);
    });

    it('does NOT fall back to fixture when live detections is empty array (live frame empty)', () => {
      const result = getEffectiveDetections([], [mockFixtureDetection]);
      expect(result.isLive).toBe(true);
      expect(result.detections).toEqual([]);
      expect(result.detections).not.toEqual([mockFixtureDetection]);
    });

    it('uses live detections when populated', () => {
      const liveItem: VideoTestDetection = {
        ...mockFixtureDetection,
        eventId: 'LIVE-EVT-1',
        timecode: 'LIVE',
      };
      const result = getEffectiveDetections([liveItem], [mockFixtureDetection]);
      expect(result.isLive).toBe(true);
      expect(result.detections).toEqual([liveItem]);
    });
  });

  describe('getPrimaryZoneDetection', () => {
    it('chooses the first active track even if preceded by inactive tracks', () => {
      const inactive: VideoTestDetection = {
        active: false,
        boundingBox: null,
        confidence: 0.9,
        eventId: 'EVT-1',
        label: 'OK',
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
        timecode: '00:01',
        trackId: 10,
      };
      const active: VideoTestDetection = {
        active: true,
        boundingBox: null,
        confidence: 0.95,
        eventId: 'EVT-2',
        label: 'VIOLATION',
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
        timecode: '00:01',
        trackId: 20,
      };

      const selected = getPrimaryZoneDetection([inactive, active]);
      expect(selected).toEqual(active);
    });

    it('falls back to index 0 when no track is active', () => {
      const inactive1: VideoTestDetection = {
        active: false,
        boundingBox: null,
        confidence: 0.9,
        eventId: 'EVT-1',
        label: 'OK 1',
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
        timecode: '00:01',
        trackId: 10,
      };
      const inactive2: VideoTestDetection = {
        active: false,
        boundingBox: null,
        confidence: 0.8,
        eventId: 'EVT-2',
        label: 'OK 2',
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
        timecode: '00:01',
        trackId: 20,
      };

      const selected = getPrimaryZoneDetection([inactive1, inactive2]);
      expect(selected).toEqual(inactive1);
    });

    it('returns null when detections list is empty', () => {
      expect(getPrimaryZoneDetection([])).toBeNull();
    });
  });

  describe('Event Row Keys', () => {
    it('generates unique PPE row keys for multiple missing items in the same event', () => {
      const key1 = getPpeEventRowKey('EVT-100', 1, 'HARD_HAT');
      const key2 = getPpeEventRowKey('EVT-100', 1, 'SAFETY_VEST');
      const key3 = getPpeEventRowKey('EVT-100', 2, 'HARD_HAT');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key1).toBe('EVT-100-1-HARD_HAT');
    });

    it('generates unique Zone row keys for different tracks in the same event', () => {
      const key1 = getZoneEventRowKey('EVT-200', 1);
      const key2 = getZoneEventRowKey('EVT-200', 2);

      expect(key1).not.toBe(key2);
      expect(key1).toBe('EVT-200-1');
    });
  });

  describe('Coordinate mapping for object-cover video', () => {
    it('maps 1:1 when aspect ratios match exactly', () => {
      const container = { width: 800, height: 450 };
      const video = { width: 1920, height: 1080 }; // 16:9

      const videoPt = mapContainerPointToVideoNormalized([0.5, 0.5], container, video);
      expect(videoPt[0]).toBeCloseTo(0.5, 3);
      expect(videoPt[1]).toBeCloseTo(0.5, 3);

      const contPt = mapVideoNormalizedToContainerNormalized([0.5, 0.5], container, video);
      expect(contPt[0]).toBeCloseTo(0.5, 3);
      expect(contPt[1]).toBeCloseTo(0.5, 3);
    });

    it('maps correctly when container is wider than video aspect ratio (vertical cropped)', () => {
      const container = { width: 1000, height: 400 }; // 2.5 aspect ratio
      const video = { width: 1600, height: 900 }; // 1.777 aspect ratio (16:9)

      // Center should still map to center
      const center = mapContainerPointToVideoNormalized([0.5, 0.5], container, video);
      expect(center[0]).toBeCloseTo(0.5, 2);
      expect(center[1]).toBeCloseTo(0.5, 2);

      // Roundtrip test
      const roundtrip = mapVideoNormalizedToContainerNormalized(center, container, video);
      expect(roundtrip[0]).toBeCloseTo(0.5, 2);
      expect(roundtrip[1]).toBeCloseTo(0.5, 2);
    });

    it('maps correctly when container is taller than video aspect ratio (horizontal cropped)', () => {
      const container = { width: 600, height: 600 }; // 1:1
      const video = { width: 1920, height: 1080 }; // 16:9

      // Center should still map to center
      const center = mapContainerPointToVideoNormalized([0.5, 0.5], container, video);
      expect(center[0]).toBeCloseTo(0.5, 2);
      expect(center[1]).toBeCloseTo(0.5, 2);

      const roundtrip = mapVideoNormalizedToContainerNormalized(center, container, video);
      expect(roundtrip[0]).toBeCloseTo(0.5, 2);
      expect(roundtrip[1]).toBeCloseTo(0.5, 2);
    });
  });

  describe('exportZoneBrowserDraft', () => {
    it('creates browser-draft payload with clear disclaimer and does not claim to be contract v1', () => {
      const polygon: [number, number][] = [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ];
      const draft = exportZoneBrowserDraft(polygon, 'CAM-04');

      expect(draft.filename).toBe('smartsite-restricted-zone-draft.camera-04.json');
      expect(draft.label).toMatch(/browser-local draft/i);

      const parsed = JSON.parse(draft.content);
      expect(parsed._disclaimer).toMatch(/browser-local/i);
      expect(parsed.cameraExternalId).toBe('CAM-04');
      expect(parsed.polygon).toEqual(polygon);
      expect(parsed.schemaVersion).toBeUndefined(); // Does NOT claim to be contract v1
    });
  });
});
