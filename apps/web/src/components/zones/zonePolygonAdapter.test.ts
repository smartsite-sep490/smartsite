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
  isMutationScopeActive,
  planMutationCompletion,
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

    it('saves and loads draft with baseConfigurationVersion for matching camera version', () => {
      const points: [number, number][] = [
        [0.2, 0.3],
        [0.7, 0.3],
        [0.7, 0.8],
      ];
      saveLocalDraft('site-A', 'cam-1', 'reg-1', 4, points);

      const loaded = loadLocalDraft('site-A', 'cam-1', 'reg-1', 4);
      expect(loaded.status).toBe('valid');
      expect(loaded.points).toEqual(points);
      expect(loaded.baseConfigurationVersion).toBe(4);

      // Different region
      expect(loadLocalDraft('site-A', 'cam-1', 'reg-2', 4).status).toBe('none');
      // Different camera
      expect(loadLocalDraft('site-A', 'cam-2', 'reg-1', 4).status).toBe('none');
      // Different site
      expect(loadLocalDraft('site-B', 'cam-1', 'reg-1', 4).status).toBe('none');
    });

    it('detects remote version change: flags draft as stale and does not return points as valid', () => {
      const points: [number, number][] = [
        [0.2, 0.3],
        [0.7, 0.3],
        [0.7, 0.8],
      ];
      // Saved against camera version 4
      saveLocalDraft('site-A', 'cam-1', 'reg-1', 4, points);

      // Server updated camera to version 5
      const loaded = loadLocalDraft('site-A', 'cam-1', 'reg-1', 5);
      expect(loaded.status).toBe('stale');
      expect(loaded.staleVersion).toBe(4);
      expect(loaded.points).toBeNull();
    });

    it('migration-safe parsing: rejects and cleans up legacy raw array records', () => {
      // Legacy unversioned draft format: raw point array
      fakeStorage.set(
        'smartsite.restricted-zone.draft:site-A:cam-1:reg-1',
        JSON.stringify([
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.9],
        ]),
      );

      const loaded = loadLocalDraft('site-A', 'cam-1', 'reg-1', 1);
      expect(loaded.status).toBe('none');
      expect(loaded.points).toBeNull();
      // Verifies storage was cleaned up
      expect(fakeStorage.has('smartsite.restricted-zone.draft:site-A:cam-1:reg-1')).toBe(false);
    });

    it('migration-safe parsing: rejects and cleans up malformed JSON or corrupted records', () => {
      fakeStorage.set('smartsite.restricted-zone.draft:site-A:cam-1:reg-1', 'invalid json{');
      const loaded = loadLocalDraft('site-A', 'cam-1', 'reg-1', 1);
      expect(loaded.status).toBe('none');
      expect(loaded.points).toBeNull();
      expect(fakeStorage.has('smartsite.restricted-zone.draft:site-A:cam-1:reg-1')).toBe(false);

      // Missing points or invalid version
      fakeStorage.set(
        'smartsite.restricted-zone.draft:site-A:cam-1:reg-1',
        JSON.stringify({ baseConfigurationVersion: 'invalid', points: [] }),
      );
      expect(loadLocalDraft('site-A', 'cam-1', 'reg-1', 1).status).toBe('none');
      expect(fakeStorage.has('smartsite.restricted-zone.draft:site-A:cam-1:reg-1')).toBe(false);
    });

    it('clears draft for a specific camera region', () => {
      const points: [number, number][] = [
        [0.2, 0.3],
        [0.7, 0.3],
        [0.7, 0.8],
      ];
      saveLocalDraft('site-A', 'cam-1', 'reg-1', 2, points);
      clearLocalDraft('site-A', 'cam-1', 'reg-1');
      expect(loadLocalDraft('site-A', 'cam-1', 'reg-1', 2).status).toBe('none');
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
      saveLocalDraft('site-A', 'cam-999', 'reg-999', 1, [
        [0.9, 0.9],
        [0.9, 0.95],
        [0.95, 0.95],
      ]);

      const state = resolveActivePolygon({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
        cameraConfigurationVersion: 1,
        backendPolygon,
      });

      expect(state.points).toEqual([
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
      ]);
      expect(state.isDraft).toBe(false);
      expect(state.isAuthoritative).toBe(true);
      expect(state.staleDraftVersion).toBeNull();
    });

    it('resolveActivePolygon loads draft when baseConfigurationVersion matches camera version', () => {
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
      saveLocalDraft('site-A', 'cam-1', 'reg-1', 3, draftPoints);

      const state = resolveActivePolygon({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
        cameraConfigurationVersion: 3,
        backendPolygon,
      });

      expect(state.points).toEqual(draftPoints);
      expect(state.isDraft).toBe(true);
      expect(state.isAuthoritative).toBe(false);
      expect(state.staleDraftVersion).toBeNull();
    });

    it('resolveActivePolygon surfaces stale draft on remote version change and never silently applies it', () => {
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
      // Saved on version 2
      saveLocalDraft('site-A', 'cam-1', 'reg-1', 2, draftPoints);

      // Server is now on version 3
      const state = resolveActivePolygon({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
        cameraConfigurationVersion: 3,
        backendPolygon,
      });

      // Must load server authoritative points, NOT draft points!
      expect(state.points).toEqual([
        [0.3, 0.3],
        [0.6, 0.3],
        [0.6, 0.6],
      ]);
      expect(state.isDraft).toBe(false);
      expect(state.isAuthoritative).toBe(true);
      // Surfaces stale draft version so UI can notify operator explicitly
      expect(state.staleDraftVersion).toBe(2);
    });
  });

  describe('concurrency and mutation scope race conditions', () => {
    const mutationVars = {
      userId: 'user-admin-1',
      siteId: 'site-A',
      cameraId: 'cam-1',
      regionId: 'reg-1',
      cameraLabel: 'CAM-01',
      expectedConfigurationVersion: 3,
      points: [
        [0.1, 0.1],
        [0.8, 0.1],
        [0.8, 0.8],
      ] as [number, number][],
    };

    it('isMutationScopeActive returns true when active scope matches mutation variables exactly', () => {
      const activeScope = {
        userId: 'user-admin-1',
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
      };
      expect(isMutationScopeActive(activeScope, mutationVars)).toBe(true);
    });

    it('isMutationScopeActive returns false when operator switched camera during save in flight', () => {
      const activeScope = {
        userId: 'user-admin-1',
        siteId: 'site-A',
        cameraId: 'cam-2', // switched to cam-2
        regionId: 'reg-1',
      };
      expect(isMutationScopeActive(activeScope, mutationVars)).toBe(false);
    });

    it('isMutationScopeActive returns false when operator switched region during save in flight', () => {
      const activeScope = {
        userId: 'user-admin-1',
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-2', // switched to reg-2
      };
      expect(isMutationScopeActive(activeScope, mutationVars)).toBe(false);
    });

    it('isMutationScopeActive returns false when operator switched site during save in flight', () => {
      const activeScope = {
        userId: 'user-admin-1',
        siteId: 'site-B', // switched to site-B
        cameraId: 'cam-1',
        regionId: 'reg-1',
      };
      expect(isMutationScopeActive(activeScope, mutationVars)).toBe(false);
    });

    it('isMutationScopeActive returns false when operator logged out during save in flight', () => {
      expect(isMutationScopeActive(null, mutationVars)).toBe(false);
      expect(
        isMutationScopeActive(
          { userId: null, siteId: 'site-A', cameraId: 'cam-1', regionId: 'reg-1' },
          mutationVars,
        ),
      ).toBe(false);
      expect(
        isMutationScopeActive(
          { userId: 'user-other', siteId: 'site-A', cameraId: 'cam-1', regionId: 'reg-1' },
          mutationVars,
        ),
      ).toBe(false);
    });

    it('planMutationCompletion always targets the saved scope for cache invalidation and draft clearing', () => {
      // Operator switched to cam-2 while cam-1 save was pending
      const plan = planMutationCompletion('http://localhost:3000', mutationVars);

      // Invalidation MUST target cam-1 (the scope of the mutation), not cam-2!
      expect(plan.invalidateSiteCamerasKey).toEqual([
        'zone-admin',
        'http://localhost:3000',
        'user-admin-1',
        'site-A',
        'cameras',
      ]);
      expect(plan.invalidateCameraRegionsKey).toEqual([
        'zone-admin',
        'http://localhost:3000',
        'user-admin-1',
        'site-A',
        'cam-1',
        'regions',
      ]);

      // Draft cleared MUST target cam-1, preserving cam-2's draft!
      expect(plan.draftScopeToClear).toEqual({
        siteId: 'site-A',
        cameraId: 'cam-1',
        regionId: 'reg-1',
      });

      // Visibility is intentionally absent from the cached plan. Callbacks must
      // recompute it from the latest scope after every awaited invalidation.
      expect(plan).not.toHaveProperty('shouldUpdateVisibleUi');
    });
  });
});
