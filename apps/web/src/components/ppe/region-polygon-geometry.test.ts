import { describe, expect, it } from 'vitest';
import {
  ZOOM_STEPS,
  calculatePolygonArea,
  clampViewportPan,
  extractRegionPolygonCoordinates,
  mapClientPointToNormalized,
  quantizeCoord,
  validatePolygonGeometry,
  validateVertexCandidate,
  type NormalizedPoint,
} from './region-polygon-geometry';

function buildRegularPolygon(vertexCount: number): NormalizedPoint[] {
  const points: NormalizedPoint[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    const x = quantizeCoord(0.5 + 0.35 * Math.cos(angle));
    const y = quantizeCoord(0.5 + 0.35 * Math.sin(angle));
    points.push([x, y]);
  }
  return points;
}

describe('region-polygon-geometry', () => {
  describe('quantizeCoord and ZOOM_STEPS', () => {
    it('quantizes coordinates to 4 decimal places and exposes zoom steps', () => {
      expect(ZOOM_STEPS).toEqual([1, 1.5, 2, 3, 4]);
      expect(quantizeCoord(0)).toBe(0);
      expect(quantizeCoord(1)).toBe(1);
      expect(quantizeCoord(0.12344)).toBe(0.1234);
      expect(quantizeCoord(0.12345)).toBe(0.1235);
    });
  });

  describe('calculatePolygonArea', () => {
    it('computes exact integer-shoelace area for clockwise, counterclockwise, collinear, and tiny 4-decimal polygons', () => {
      const rect: NormalizedPoint[] = [
        [0.1, 0.1],
        [0.6, 0.1],
        [0.6, 0.5],
        [0.1, 0.5],
      ];
      expect(calculatePolygonArea(rect)).toBeCloseTo(0.2, 8);
      expect(calculatePolygonArea([...rect].reverse())).toBeCloseTo(0.2, 8);

      const collinear: NormalizedPoint[] = [
        [0.1, 0.1],
        [0.3, 0.3],
        [0.5, 0.5],
      ];
      expect(calculatePolygonArea(collinear)).toBe(0);

      const tinyValidTriangle: NormalizedPoint[] = [
        [0.1, 0.1],
        [0.1001, 0.1],
        [0.1, 0.1001],
      ];
      expect(calculatePolygonArea(tinyValidTriangle)).toBe(5e-9);
    });
  });

  describe('validatePolygonGeometry', () => {
    it('enforces minimum 3 and maximum 32 vertices', () => {
      expect(validatePolygonGeometry([])).toBe('regionSetup.validation.minPoints');
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.5, 0.5],
        ]),
      ).toBe('regionSetup.validation.minPoints');

      const polygon32 = buildRegularPolygon(32);
      expect(validatePolygonGeometry(polygon32)).toBeNull();

      const polygon33 = buildRegularPolygon(33);
      expect(validatePolygonGeometry(polygon33)).toBe('regionSetup.validation.maxPoints');
    });

    it('rejects consecutive and non-consecutive duplicate vertices within 1e-6', () => {
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ]),
      ).toBe('regionSetup.validation.duplicateVertices');

      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
          [0.1000004, 0.1000004],
          [0.1, 0.5],
        ]),
      ).toBe('regionSetup.validation.duplicateVertices');
    });

    it('rejects collinear zero-area polygons and accepts a tiny valid 4-decimal triangle', () => {
      expect(
        validatePolygonGeometry([
          [0.2, 0.2],
          [0.4, 0.4],
          [0.6, 0.6],
        ]),
      ).toBe('regionSetup.validation.zeroArea');

      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.1001, 0.1],
          [0.1, 0.1001],
        ]),
      ).toBeNull();
    });

    it('rejects proper crossings, vertex-on-edge touches, and 180-degree adjacent fold-backs while allowing collinear forward edges', () => {
      // Symmetric bowtie cancels signed shoelace sum to 0 -> rejected by zeroArea before selfIntersect
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.6, 0.6],
          [0.6, 0.1],
          [0.1, 0.6],
        ]),
      ).toBe('regionSetup.validation.zeroArea');

      // Asymmetric bowtie has nonzero shoelace area and proper crossing -> rejected by selfIntersect
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.7, 0.8],
          [0.6, 0.1],
          [0.1, 0.6],
        ]),
      ).toBe('regionSetup.validation.selfIntersect');

      // Vertex touching a non-adjacent edge
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.7, 0.1],
          [0.7, 0.7],
          [0.4, 0.1],
          [0.1, 0.7],
        ]),
      ).toBe('regionSetup.validation.selfIntersect');

      // Adjacent edge folding back 180 degrees
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.6, 0.1],
          [0.3, 0.1],
          [0.3, 0.5],
        ]),
      ).toBe('regionSetup.validation.selfIntersect');

      // Closing edge pair (n - 1 -> 0 and 0 -> 1) folding back 180 degrees
      expect(
        validatePolygonGeometry([
          [0.6, 0.1],
          [0.3, 0.1],
          [0.3, 0.5],
          [0.1, 0.1],
        ]),
      ).toBe('regionSetup.validation.selfIntersect');

      // Collinear consecutive edges continuing forward with positive total area
      expect(
        validatePolygonGeometry([
          [0.1, 0.1],
          [0.3, 0.1],
          [0.6, 0.1],
          [0.3, 0.5],
        ]),
      ).toBeNull();
    });
  });

  describe('validateVertexCandidate', () => {
    const baseTriangle: NormalizedPoint[] = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.5, 0.8],
    ];

    it('strictly rejects out-of-bounds, NaN, and Infinity coordinates without clamping', () => {
      for (const [rawX, rawY] of [
        [-0.0001, 0.5],
        [1.0001, 0.5],
        [0.5, -0.0001],
        [0.5, 1.0001],
        [Number.NaN, 0.5],
        [0.5, Number.NaN],
        [Number.POSITIVE_INFINITY, 0.5],
        [0.5, Number.NEGATIVE_INFINITY],
      ] as const) {
        expect(validateVertexCandidate(baseTriangle, rawX, rawY)).toEqual({
          ok: false,
          errorKey: 'regionSetup.validation.outOfBounds',
        });
      }
    });

    it('enforces max 32 points when adding a new vertex but allows moving an existing vertex via ignoreIndex', () => {
      const polygon32 = buildRegularPolygon(32);
      expect(validateVertexCandidate(polygon32, 0.5, 0.5)).toEqual({
        ok: false,
        errorKey: 'regionSetup.validation.maxPointsClick',
      });

      expect(validateVertexCandidate(polygon32, 0.5, 0.5, 0)).toEqual({
        ok: true,
        point: [0.5, 0.5],
      });
    });

    it('quantizes valid candidates and rejects duplicates after quantization unless matching ignoreIndex', () => {
      expect(validateVertexCandidate(baseTriangle, 0.34567, 0.65432)).toEqual({
        ok: true,
        point: [0.3457, 0.6543],
      });

      // Quantizes to [0.2, 0.2], which collides with index 0
      expect(validateVertexCandidate(baseTriangle, 0.20004, 0.19996)).toEqual({
        ok: false,
        errorKey: 'regionSetup.validation.duplicateVertexClick',
      });

      // Allowed when dragging index 0 itself
      expect(validateVertexCandidate(baseTriangle, 0.20004, 0.19996, 0)).toEqual({
        ok: true,
        point: [0.2, 0.2],
      });
    });
  });

  describe('clampViewportPan and mapClientPointToNormalized', () => {
    it('clamps viewport pan to [0, 1 - 1/zoom] and guards non-finite inputs', () => {
      expect(clampViewportPan(0.4, 0.4, 1)).toEqual([0, 0]);
      expect(clampViewportPan(-0.2, 0.9, 2)).toEqual([0, 0.5]);
      expect(clampViewportPan(0.3, 0.7, 4)).toEqual([0.3, 0.7]);
      expect(clampViewportPan(Number.NaN, Number.POSITIVE_INFINITY, 2)).toEqual([0, 0]);
      expect(clampViewportPan(0.2, 0.2, Number.NaN)).toEqual([0, 0]);
    });

    it('returns null for non-positive rect, frame, or zoom dimensions', () => {
      const rect = { left: 0, top: 0, width: 800, height: 600 };
      const viewport = { zoom: 1, panX: 0, panY: 0 };
      expect(
        mapClientPointToNormalized(100, 100, { ...rect, width: 0 }, 1920, 1080, viewport),
      ).toBeNull();
      expect(
        mapClientPointToNormalized(100, 100, { ...rect, height: 0 }, 1920, 1080, viewport),
      ).toBeNull();
      expect(mapClientPointToNormalized(100, 100, rect, 0, 1080, viewport)).toBeNull();
      expect(mapClientPointToNormalized(100, 100, rect, 1920, -1, viewport)).toBeNull();
      expect(
        mapClientPointToNormalized(100, 100, rect, 1920, 1080, { zoom: 0, panX: 0, panY: 0 }),
      ).toBeNull();
    });

    it('maps client coordinates across pillarbox/letterbox offsets, zoom, and pan', () => {
      // Container 1000x500 at (100, 50) displaying 1600x1000 frame -> scale 0.5 -> content 800x500 at (200, 50)
      const rect = { left: 100, top: 50, width: 1000, height: 500 };

      const inLeftPillarbox = mapClientPointToNormalized(150, 300, rect, 1600, 1000, {
        zoom: 1,
        panX: 0,
        panY: 0,
      });
      expect(inLeftPillarbox).not.toBeNull();
      expect(inLeftPillarbox?.inContentBox).toBe(false);
      expect(inLeftPillarbox?.rawX).toBeLessThan(0);

      const centerAtZoom2 = mapClientPointToNormalized(600, 300, rect, 1600, 1000, {
        zoom: 2,
        panX: 0.25,
        panY: 0.1,
      });
      expect(centerAtZoom2).toEqual({
        rawX: 0.5,
        rawY: 0.35,
        inContentBox: true,
        contentWidth: 800,
        contentHeight: 500,
      });

      // Vertical letterbox: container 800x600 at (0, 0) displaying 1600x800 frame -> scale 0.5 -> content 800x400 at (0, 100)
      const verticalRect = { left: 0, top: 0, width: 800, height: 600 };
      const inTopBar = mapClientPointToNormalized(400, 50, verticalRect, 1600, 800, {
        zoom: 1,
        panX: 0,
        panY: 0,
      });
      expect(inTopBar?.inContentBox).toBe(false);
      expect(inTopBar?.rawY).toBeLessThan(0);
    });
  });

  describe('extractRegionPolygonCoordinates', () => {
    it('extracts and quantizes valid polygon coordinates and returns null for malformed or invalid geometry', () => {
      expect(
        extractRegionPolygonCoordinates({
          coordinates: [
            [0.123456, 0.1],
            [0.8, 0.1],
            [0.5, 0.876543],
          ],
        }),
      ).toEqual([
        [0.1235, 0.1],
        [0.8, 0.1],
        [0.5, 0.8765],
      ]);

      expect(extractRegionPolygonCoordinates(null)).toBeNull();
      expect(extractRegionPolygonCoordinates([])).toBeNull();
      expect(
        extractRegionPolygonCoordinates({
          coordinates: [
            [0.1, 0.1],
            [0.2, 0.2],
          ],
        }),
      ).toBeNull();
      expect(
        extractRegionPolygonCoordinates({
          coordinates: [
            [0.1, 0.1],
            [1.2, 0.1],
            [0.5, 0.5],
          ],
        }),
      ).toBeNull();
      expect(
        extractRegionPolygonCoordinates({
          coordinates: [
            [0.1, 0.1],
            [0.6, 0.6],
            [0.6, 0.1],
            [0.1, 0.6],
          ],
        }),
      ).toBeNull();
    });
  });
});
