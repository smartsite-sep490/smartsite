export interface ValidationIssue {
  code: 'SCHEMA_VIOLATION' | 'INVALID_GEOMETRY';
  path: string;
  message: string;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface BoundingBoxCandidate {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coordinateSpace?: string;
}

/**
 * Validates cross-field semantic geometric invariants for a 2D bounding box:
 * - x1 must be strictly less than x2
 * - y1 must be strictly less than y2
 */
export function validateBoundingBox(box: unknown, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof box !== 'object' || box === null) {
    return issues;
  }

  const b = box as Record<string, unknown>;
  const x1 = typeof b.x1 === 'number' ? b.x1 : undefined;
  const y1 = typeof b.y1 === 'number' ? b.y1 : undefined;
  const x2 = typeof b.x2 === 'number' ? b.x2 : undefined;
  const y2 = typeof b.y2 === 'number' ? b.y2 : undefined;

  if (x1 !== undefined && x2 !== undefined && x1 >= x2) {
    issues.push({
      code: 'INVALID_GEOMETRY',
      path: `${basePath}/x1`,
      message: `Invalid bounding box horizontal geometry: x1 (${x1}) must be strictly less than x2 (${x2})`,
    });
  }

  if (y1 !== undefined && y2 !== undefined && y1 >= y2) {
    issues.push({
      code: 'INVALID_GEOMETRY',
      path: `${basePath}/y1`,
      message: `Invalid bounding box vertical geometry: y1 (${y1}) must be strictly less than y2 (${y2})`,
    });
  }

  return issues;
}

/**
 * Validates semantic geometric invariants for a 2D polygon:
 * - Must contain at least 3 vertices
 * - Each vertex coordinate must be normalized within [0.0, 1.0]
 */
export function validatePolygon(vertices: unknown, basePath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!Array.isArray(vertices)) {
    return issues;
  }

  if (vertices.length < 3) {
    issues.push({
      code: 'INVALID_GEOMETRY',
      path: basePath,
      message: `Polygon must contain at least 3 vertices (received ${vertices.length})`,
    });
  }

  vertices.forEach((vertex: unknown, index: number) => {
    if (typeof vertex === 'object' && vertex !== null) {
      const v = vertex as Record<string, unknown>;
      if (typeof v.x === 'number' && (v.x < 0.0 || v.x > 1.0)) {
        issues.push({
          code: 'INVALID_GEOMETRY',
          path: `${basePath}/${index}/x`,
          message: `Polygon vertex x coordinate must be between 0.0 and 1.0 (received ${v.x})`,
        });
      }
      if (typeof v.y === 'number' && (v.y < 0.0 || v.y > 1.0)) {
        issues.push({
          code: 'INVALID_GEOMETRY',
          path: `${basePath}/${index}/y`,
          message: `Polygon vertex y coordinate must be between 0.0 and 1.0 (received ${v.y})`,
        });
      }
    }
  });

  return issues;
}

/**
 * Scans an entire technical observation payload and validates all embedded bounding boxes and polygons.
 */
export function validateGeometry(payload: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return issues;
  }

  const p = payload as Record<string, unknown>;
  if (Array.isArray(p.observations)) {
    p.observations.forEach((obs: unknown, index: number) => {
      if (typeof obs === 'object' && obs !== null) {
        const o = obs as Record<string, unknown>;
        if (o.boundingBox !== undefined) {
          issues.push(...validateBoundingBox(o.boundingBox, `/observations/${index}/boundingBox`));
        }
      }
    });
  }

  return issues;
}
