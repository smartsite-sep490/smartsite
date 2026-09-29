import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import {
  backendPolygonToPoints,
  pointsToApiPolygon,
  preparePolygonSave,
  handleSaveSuccess,
  isConflictError,
  formatConflictMessage,
  resolveActivePolygon,
  saveLocalDraft,
  loadLocalDraft,
  clearLocalDraft,
  DEFAULT_ZONE_POLYGON,
} from './zonePolygonAdapter';

describe('zonePolygonAdapter', () => {
  describe('backendPolygonToPoints', () => {
    it('converts valid Backend polygon coordinates to editable normalized points', () => {
      const backendPolygon = {
        coordinates: [
          [0.1, 0.2],
          [0.8, 0.2],
          [0.8, 0.9],
          [0.1, 0.9],
        ],
      };
      const points = backendPolygonToPoints(backendPolygon);
      expect(points).toEqual([
        [0.1, 0.2],
        [0.8, 0.2],
        [0.8, 0.9],
        [0.1, 0.9],
      ]);
    });

    it('falls back to default polygon when backend polygon is null, undefined, or malformed', () => {
      expect(backendPolygonToPoints(null)).toEqual(DEFAULT_ZONE_POLYGON);
      expect(backendPolygonToPoints(undefined)).toEqual(DEFAULT_ZONE_POLYGON);
      expect(backendPolygonToPoints({})).toEqual(DEFAULT_ZONE_POLYGON);
      expect(backendPolygonToPoints({ coordinates: [] })).toEqual(DEFAULT_ZONE_POLYGON);
      expect(backendPolygonToPoints({ coordinates: [[0.1, 0.2]] })).toEqual(DEFAULT_ZONE_POLYGON);
      expect(
        backendPolygonToPoints({
          coordinates: [
            ['invalid', 0.2],
            [0.8, 0.2],
            [0.8, 0.9],
          ],
        }),
      ).toEqual(DEFAULT_ZONE_POLYGON);
    });

    it('supports custom fallback points if provided', () => {
      const customFallback: [number, number][] = [
        [0.2, 0.2],
        [0.7, 0.2],
        [0.7, 0.7],
      ];
      expect(backendPolygonToPoints(null, customFallback)).toEqual(customFallback);
    });
  });

  describe('pointsToApiPolygon', () => {
    it('formats edited normalized points into the exact API contract polygon shape', () => {
      const points: [number, number][] = [
        [0.15, 0.25],
        [0.85, 0.25],
        [0.85, 0.75],
        [0.15, 0.75],
      ];
      const apiPayload = pointsToApiPolygon(points);
      expect(apiPayload).toEqual({
        coordinates: [
          [0.15, 0.25],
          [0.85, 0.25],
          [0.85, 0.75],
          [0.15, 0.75],
        ],
      });
    });

    it('throws an error if polygon has fewer than 3 vertices', () => {
      expect(() =>
        pointsToApiPolygon([
          [0.1, 0.1],
          [0.2, 0.2],
        ]),
      ).toThrow('A polygon must have at least 3 vertices');
    });

    it('clamps coordinates to the normalized 0..1 interval', () => {
      const apiPayload = pointsToApiPolygon([
        [-0.1, 1.2],
        [0.5, 0.5],
        [1.1, -0.2],
      ]);
      expect(apiPayload.coordinates).toEqual([
        [0, 1],
        [0.5, 0.5],
        [1, 0],
      ]);
    });
  });

  describe('preparePolygonSave', () => {
    it('creates mutation payload with expectedConfigurationVersion and polygon', () => {
      const camera = { configurationVersion: 4 };
      const points: [number, number][] = [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ];
      const result = preparePolygonSave(camera, points);
      expect(result).toEqual({
        expectedConfigurationVersion: 4,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
          ],
        },
      });
    });
  });

  describe('handleSaveSuccess', () => {
    it('updates local revision and configuration version on successful mutation', () => {
      const currentCamera = {
        id: 'cam-1',
        siteId: 'site-1',
        externalId: 'CAM-04',
        code: 'CAM-04',
        name: 'Zone Camera 4',
        status: 'ACTIVE' as const,
        configurationVersion: 3,
        createdAt: '2026-09-29T00:00:00Z',
      };
      const mutationResult = {
        configurationVersion: 4,
        region: {
          id: 'reg-1',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: {
            coordinates: [
              [0.2, 0.2],
              [0.8, 0.2],
              [0.8, 0.8],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1' as const,
          version: 2,
          isActive: true,
          createdAt: '2026-09-29T00:00:00Z',
        },
      };

      const { updatedCamera, updatedRegion } = handleSaveSuccess(currentCamera, mutationResult);
      expect(updatedCamera.configurationVersion).toBe(4);
      expect(updatedRegion.version).toBe(2);
      expect(updatedRegion.polygon).toEqual(mutationResult.region.polygon);
    });
  });

  describe('409 conflict handling', () => {
    it('identifies HTTP 409 error as a conflict', () => {
      const conflictError = new ApiError('http', 'Conflict', 409);
      const otherError = new ApiError('http', 'Not Found', 404);
      const genericError = new Error('Network error');

      expect(isConflictError(conflictError)).toBe(true);
      expect(isConflictError(otherError)).toBe(false);
      expect(isConflictError(genericError)).toBe(false);
    });

    it('generates a clear conflict message with camera details', () => {
      const message = formatConflictMessage('CAM-04');
      expect(message).toContain('CAM-04');
      expect(message).toContain('modified by another operator');
      expect(message).toContain('latest server configuration has been reloaded');
    });
  });

  describe('switching Site/Camera and draft isolation', () => {
    const fakeStorage = new Map<string, string>();

    beforeEach(() => {
      fakeStorage.clear();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => fakeStorage.get(key) ?? null,
        setItem: (key: string, value: string) => fakeStorage.set(key, value),
        removeItem: (key: string) => fakeStorage.delete(key),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('saves and loads draft only for the exact siteId, cameraId, and regionId', () => {
      const points: [number, number][] = [
        [0.2, 0.3],
        [0.7, 0.3],
        [0.7, 0.8],
      ];
      saveLocalDraft('site-A', 'cam-1', 'reg-1', points);

      expect(loadLocalDraft('site-A', 'cam-1', 'reg-1')).toEqual(points);
      // Different region
      expect(loadLocalDraft('site-A', 'cam-1', 'reg-2')).toBeNull();
      // Different camera
      expect(loadLocalDraft('site-A', 'cam-2', 'reg-1')).toBeNull();
      // Different site
      expect(loadLocalDraft('site-B', 'cam-1', 'reg-1')).toBeNull();
    });

    it('clears draft for a specific camera region', () => {
      const points: [number, number][] = [
        [0.2, 0.3],
        [0.7, 0.3],
        [0.7, 0.8],
      ];
      saveLocalDraft('site-A', 'cam-1', 'reg-1', points);
      clearLocalDraft('site-A', 'cam-1', 'reg-1');
      expect(loadLocalDraft('site-A', 'cam-1', 'reg-1')).toBeNull();
    });

    it('resolveActivePolygon treats backend polygon as authoritative when no matching draft exists', () => {
      const backendPolygon = {
        coordinates: [
          [0.3, 0.3],
          [0.6, 0.3],
          [0.6, 0.6],
        ],
      };
      // Save draft for another camera
      saveLocalDraft('site-A', 'cam-999', 'reg-999', [
        [0.9, 0.9],
        [0.9, 0.95],
        [0.95, 0.95],
      ]);

      const state = resolveActivePolygon({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
        backendPolygon,
      });

      expect(state.points).toEqual([
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
      ]);
      expect(state.isDraft).toBe(false);
      expect(state.isAuthoritative).toBe(true);
    });

    it('resolveActivePolygon detects matching local draft and flags it as unsaved draft', () => {
      const backendPolygon = {
        coordinates: [
          [0.3, 0.3],
          [0.6, 0.3],
          [0.6, 0.6],
        ],
      };
      const draftPoints: [number, number][] = [
        [0.4, 0.4],
        [0.7, 0.4],
        [0.7, 0.7],
      ];
      saveLocalDraft('site-A', 'cam-1', 'reg-1', draftPoints);

      const state = resolveActivePolygon({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
        backendPolygon,
      });

      expect(state.points).toEqual(draftPoints);
      expect(state.isDraft).toBe(true);
      expect(state.isAuthoritative).toBe(false);
    });
  });
});
